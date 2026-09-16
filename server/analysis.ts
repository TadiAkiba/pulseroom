import type { AnalysisRecord, InteractionRecord, ResponseRecord } from './db.ts'

const stopWords = new Set([
  'a',
  'about',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'for',
  'from',
  'had',
  'has',
  'have',
  'how',
  'i',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'more',
  'my',
  'not',
  'of',
  'on',
  'or',
  'our',
  'so',
  'still',
  'that',
  'the',
  'their',
  'them',
  'there',
  'they',
  'this',
  'to',
  'us',
  'very',
  'was',
  'we',
  'what',
  'which',
  'with',
  'would',
  'yet',
  'you',
  'your',
])

const positiveWords = new Set([
  'adopt',
  'amazing',
  'clear',
  'easy',
  'effective',
  'engaging',
  'excellent',
  'excited',
  'great',
  'helpful',
  'impressive',
  'love',
  'practical',
  'promising',
  'strong',
  'useful',
  'valuable',
])

const negativeWords = new Set([
  'bad',
  'blocked',
  'complex',
  'concern',
  'confused',
  'difficult',
  'friction',
  'hard',
  'issue',
  'poor',
  'problem',
  'risk',
  'slow',
  'unclear',
  'worried',
])

const themeKeywords: Record<string, string[]> = {
  Pricing: ['price', 'pricing', 'cost', 'budget', 'expensive'],
  Implementation: ['implement', 'implementation', 'rollout', 'timeline', 'migration', 'setup', 'deployment'],
  Training: ['training', 'enablement', 'education', 'learn'],
  Support: ['support', 'help', 'success', 'service'],
  Usability: ['easy', 'ux', 'ui', 'adopt', 'workflow', 'usability'],
  Governance: ['governance', 'policy', 'compliance', 'security'],
  Onboarding: ['onboarding', 'onboard', 'adoption'],
}

export type TextAnalysis = Pick<AnalysisRecord, 'sentiment' | 'keywords' | 'themes' | 'summary'>

export function analyseText(text: string): TextAnalysis {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !stopWords.has(token))

  const keywordCounts = new Map<string, number>()
  let score = 0

  for (const token of tokens) {
    keywordCounts.set(token, (keywordCounts.get(token) ?? 0) + 1)
    if (positiveWords.has(token)) {
      score += 1
    }
    if (negativeWords.has(token)) {
      score -= 1
    }
  }

  const keywords = [...keywordCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([token]) => token)

  const themes = Object.entries(themeKeywords)
    .filter(([, patterns]) => patterns.some((pattern) => tokens.some((token) => token.includes(pattern))))
    .map(([theme]) => theme)

  const sentiment = score >= 2 ? 'positive' : score <= -1 ? 'negative' : 'neutral'

  const summary =
    themes.length > 0
      ? `Touches on ${themes.slice(0, 2).join(' and ')}.`
      : keywords.length > 0
        ? `Highlights ${keywords.slice(0, 3).join(', ')}.`
        : 'Not enough signal for a meaningful summary.'

  return { sentiment, keywords, themes, summary }
}

type AggregateInput = {
  responses: ResponseRecord[]
  analyses: AnalysisRecord[]
  interactions: InteractionRecord[]
  includeHidden: boolean
}

function isPubliclyVisible(response: ResponseRecord) {
  return response.moderationState === 'visible' || response.moderationState === 'answered'
}

export function buildAnalytics(input: AggregateInput) {
  const interactionById = new Map(input.interactions.map((interaction) => [interaction.id, interaction]))
  const eligibleTextResponses = input.responses.filter((response) => {
    if (response.responseType !== 'question' && response.responseType !== 'feedback') {
      return false
    }

    if (response.moderationState === 'deleted') {
      return false
    }

    if (input.includeHidden) {
      return true
    }

    const interaction = interactionById.get(response.interactionId)
    if (!interaction) {
      return false
    }

    if (interaction.type === 'question') {
      return isPubliclyVisible(response)
    }

    return response.moderationState !== 'hidden'
  })

  const analysisByResponseId = new Map(input.analyses.map((analysis) => [analysis.responseId, analysis]))
  const joined = eligibleTextResponses
    .map((response) => ({
      response,
      analysis: analysisByResponseId.get(response.id),
    }))
    .filter((item): item is { response: ResponseRecord; analysis: AnalysisRecord } => Boolean(item.analysis))

  const pendingAnalyses = eligibleTextResponses.length - joined.length

  const sentimentCounts = { positive: 0, neutral: 0, negative: 0 }
  const themeCounts = new Map<string, number>()
  const keywordCounts = new Map<string, number>()
  const timeline = new Map<string, number>()

  for (const item of joined) {
    sentimentCounts[item.analysis.sentiment] += 1

    for (const theme of item.analysis.themes) {
      themeCounts.set(theme, (themeCounts.get(theme) ?? 0) + 1)
    }

    for (const keyword of item.analysis.keywords) {
      keywordCounts.set(keyword, (keywordCounts.get(keyword) ?? 0) + 1)
    }

    const bucket = item.response.createdAt.slice(11, 16)
    timeline.set(bucket, (timeline.get(bucket) ?? 0) + 1)
  }

  const total = joined.length || 1
  const sentiment = {
    positive: Math.round((sentimentCounts.positive / total) * 100),
    neutral: Math.round((sentimentCounts.neutral / total) * 100),
    negative: Math.round((sentimentCounts.negative / total) * 100),
  }

  const themes = [...themeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([theme, count]) => ({ theme, count }))

  const keywords = [...keywordCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 18)
    .map(([word, count]) => ({ word, count }))

  const wordCloud = keywords.map((entry, index) => ({
    ...entry,
    weight: Math.max(1, 1.2 + entry.count * 0.7 - index * 0.04),
  }))

  const ordered = [...joined].sort((a, b) => a.response.createdAt.localeCompare(b.response.createdAt))
  let emergingConcerns: string[] = []

  if (ordered.length >= 5) {
    const halfway = Math.floor(ordered.length / 2)
    const earlyThemeCounts = new Map<string, number>()
    const recentThemeCounts = new Map<string, number>()

    for (const item of ordered.slice(0, halfway)) {
      for (const theme of item.analysis.themes) {
        earlyThemeCounts.set(theme, (earlyThemeCounts.get(theme) ?? 0) + 1)
      }
    }

    for (const item of ordered.slice(halfway)) {
      for (const theme of item.analysis.themes) {
        recentThemeCounts.set(theme, (recentThemeCounts.get(theme) ?? 0) + 1)
      }
    }

    emergingConcerns = [...recentThemeCounts.entries()]
      .filter(([theme, count]) => count >= 2 && count > (earlyThemeCounts.get(theme) ?? 0))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([theme]) => `Questions around ${theme.toLowerCase()} are increasing.`)
  }

  return {
    sentiment,
    themes,
    keywords,
    wordCloud,
    timeline: [...timeline.entries()].map(([time, value]) => ({ time, value })),
    emergingConcerns:
      ordered.length >= 5
        ? emergingConcerns.length > 0
          ? emergingConcerns
          : ['Response volume is building, but no clear emerging concern stands out yet.']
        : ['Not enough responses yet to identify emerging themes.'],
    pendingAnalyses,
    totalTextResponses: eligibleTextResponses.length,
  }
}
