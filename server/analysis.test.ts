import test from 'node:test'
import assert from 'node:assert/strict'
import { analyseText, buildAnalytics } from './analysis.ts'
import type { AnalysisRecord, InteractionRecord, ResponseRecord } from './db.ts'

test('analyseText: clearly positive sentence yields positive sentiment', () => {
  const result = analyseText(
    'The session is engaging, practical, and genuinely useful for what our team needs to adopt next.',
  )
  assert.equal(result.sentiment, 'positive')
  assert.ok(result.keywords.length > 0)
  assert.ok(result.summary.length > 0)
})

test('analyseText: negative word set yields negative sentiment', () => {
  const result = analyseText('The setup is difficult, unclear, and we are worried about slow adoption and bad support.')
  assert.equal(result.sentiment, 'negative')
})

test('analyseText: neutral short sentence yields neutral', () => {
  const result = analyseText('The meeting began at nine o’clock yesterday morning.')
  assert.equal(result.sentiment, 'neutral')
})

test('analyseText: stopWords are stripped and not counted as keywords', () => {
  const result = analyseText('The the and the our of excellent great content.')
  assert.equal(result.sentiment, 'positive')
  assert.ok(!result.keywords.includes('the'))
  assert.ok(!result.keywords.includes('and'))
  assert.ok(!result.keywords.includes('our'))
})

test('analyseText: themes are detected from keyword families', () => {
  const result = analyseText('Pricing is expensive and our onboarding budget does not cover multi-year rollout deployment timeline setup.')
  assert.ok(result.themes.includes('Pricing'))
  assert.ok(result.themes.includes('Onboarding') || result.themes.includes('Implementation'))
})

test('analyseText: empty or whitespace input returns neutral, no keywords', () => {
  const result = analyseText('    ')
  assert.equal(result.sentiment, 'neutral')
  assert.deepEqual(result.keywords, [])
  assert.deepEqual(result.themes, [])
})

test('analyseText: sentiment thresholds — score >= 2 is positive, <= -1 is negative', () => {
  const justPositive = analyseText('great helpful content here')
  assert.equal(justPositive.sentiment, 'positive')

  const justNegative = analyseText('bad slow problem unclear')
  assert.equal(justNegative.sentiment, 'negative')

  const borderline = analyseText('good great bad') // +2 -1 = +1 → neutral by (>=2, <=-1 rule)
  assert.equal(borderline.sentiment, 'neutral')
})

function stubResponsesAndAnalyses(pairs: Array<{ text: string; sentiment: 'positive' | 'neutral' | 'negative'; type: 'question' | 'feedback'; createdAt: string; state?: ResponseRecord['moderationState'] }>) {
  const interactions: InteractionRecord[] = [
    {
      id: 'inter-1',
      eventId: 'ev-1',
      type: 'question',
      prompt: 'How are we doing?',
      options: [],
      settings: {},
      status: 'active',
      ordering: 1,
      createdAt: '2026-09-22T10:00:00.000Z',
    },
    {
      id: 'inter-2',
      eventId: 'ev-1',
      type: 'feedback',
      prompt: 'Thoughts?',
      options: [],
      settings: {},
      status: 'active',
      ordering: 2,
      createdAt: '2026-09-22T10:00:00.000Z',
    },
  ]
  const responses: ResponseRecord[] = pairs.map((pair, idx) => ({
    id: `resp-${idx + 1}`,
    eventId: 'ev-1',
    interactionId: pair.type === 'question' ? 'inter-1' : 'inter-2',
    responseType: pair.type,
    content: { text: pair.text },
    moderationState: pair.state ?? 'visible',
    highlighted: false,
    createdAt: pair.createdAt,
  }))
  const analyses: AnalysisRecord[] = responses.map((r) => ({
    id: `an-${r.id}`,
    eventId: r.eventId,
    responseId: r.id,
    ...analyseText(String(r.content.text ?? '')),
    createdAt: r.createdAt,
  }))
  return { interactions, responses, analyses }
}

test('buildAnalytics: sentiment percentages sum to 100', () => {
  const pairs = [
    { text: 'excellent engaging great useful practical', sentiment: 'positive' as const, type: 'question' as const, createdAt: '2026-09-22T10:05:00.000Z' },
    { text: 'bad slow unclear blocked problem', sentiment: 'negative' as const, type: 'feedback' as const, createdAt: '2026-09-22T10:05:00.000Z' },
    { text: 'ok moving on thanks', sentiment: 'neutral' as const, type: 'question' as const, createdAt: '2026-09-22T10:05:00.000Z' },
  ]
  const { interactions, responses, analyses } = stubResponsesAndAnalyses(pairs)
  const analytics = buildAnalytics({ interactions, responses, analyses, includeHidden: true })
  const sum = analytics.sentiment.positive + analytics.sentiment.neutral + analytics.sentiment.negative
  assert.ok(
    sum >= 99 && sum <= 101,
    `expected percentages to round to ~100; got ${sum} with ${JSON.stringify(analytics.sentiment)}`,
  )
  assert.ok(analytics.sentiment.positive > 20)
  assert.ok(analytics.sentiment.negative > 20)
})

test('buildAnalytics: includeHidden=false drops question responses in pending/hidden state', () => {
  const pairs = [
    { text: 'excellent useful practical', sentiment: 'positive' as const, type: 'question' as const, createdAt: '2026-09-22T10:05:00.000Z', state: 'visible' as const },
    { text: 'hidden moderator note', sentiment: 'negative' as const, type: 'question' as const, createdAt: '2026-09-22T10:05:00.000Z', state: 'hidden' as const },
    { text: 'not yet approved', sentiment: 'positive' as const, type: 'question' as const, createdAt: '2026-09-22T10:05:00.000Z', state: 'pending' as const },
  ]
  const { interactions, responses, analyses } = stubResponsesAndAnalyses(pairs)
  const publicAnalytics = buildAnalytics({ interactions, responses, analyses, includeHidden: false })
  const adminAnalytics = buildAnalytics({ interactions, responses, analyses, includeHidden: true })
  assert.equal(adminAnalytics.totalTextResponses, 3)
  assert.equal(publicAnalytics.totalTextResponses, 1)
  assert.equal(publicAnalytics.sentiment.positive, 100)
})

test('buildAnalytics: emerging themes trigger when count in recent half exceeds early', () => {
  const pairs: Array<{ text: string; sentiment: 'positive' | 'neutral' | 'negative'; type: 'question' | 'feedback'; createdAt: string }> = [
    { text: 'general talk topic about the launch', sentiment: 'neutral', type: 'question', createdAt: '2026-09-22T10:01:00.000Z' },
    { text: 'general talk topic about the launch', sentiment: 'neutral', type: 'question', createdAt: '2026-09-22T10:02:00.000Z' },
    { text: 'easy ux workflow adopt', sentiment: 'positive', type: 'question', createdAt: '2026-09-22T10:03:00.000Z' },
    { text: 'the deployment rollout setup timeline migration', sentiment: 'neutral', type: 'question', createdAt: '2026-09-22T10:07:00.000Z' },
    { text: 'the deployment rollout setup timeline migration', sentiment: 'neutral', type: 'question', createdAt: '2026-09-22T10:08:00.000Z' },
    { text: 'training enablement education', sentiment: 'neutral', type: 'question', createdAt: '2026-09-22T10:09:00.000Z' },
  ]
  const { interactions, responses, analyses } = stubResponsesAndAnalyses(pairs)
  const analytics = buildAnalytics({ interactions, responses, analyses, includeHidden: true })
  assert.ok(
    analytics.emergingConcerns.some((s) => s.toLowerCase().includes('implementation')),
    `expected Implementation to emerge; got: ${JSON.stringify(analytics.emergingConcerns)}`,
  )
})

test('buildAnalytics: pendingAnalyses count equals responses missing analysis rows', () => {
  const pairs = [
    { text: 'great helpful practical', sentiment: 'positive' as const, type: 'question' as const, createdAt: '2026-09-22T10:05:00.000Z' },
    { text: 'worried slow blocked unclear', sentiment: 'negative' as const, type: 'feedback' as const, createdAt: '2026-09-22T10:05:00.000Z' },
    { text: 'just asking a question', sentiment: 'neutral' as const, type: 'question' as const, createdAt: '2026-09-22T10:05:00.000Z' },
  ]
  const { interactions, responses, analyses } = stubResponsesAndAnalyses(pairs)
  const missingOne = analyses.slice(0, 2)
  const analytics = buildAnalytics({ interactions, responses, analyses: missingOne, includeHidden: true })
  assert.equal(analytics.pendingAnalyses, 1)
})
