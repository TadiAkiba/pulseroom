import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ConvexProvider, useQuery } from 'convex/react'
import { useParams } from 'react-router-dom'
import { io, type Socket } from 'socket.io-client'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Badge } from '../components/ui/Badge.tsx'
import { Tabs, TabsList, TabsTrigger } from '../components/ui/Tabs.tsx'
import { api } from '../lib/api.ts'
import { convexQueries, getConvexClient, setConvexRuntimeConfig } from '../lib/convex.ts'
import { socketUrl } from '../lib/realtime.ts'
import type { EventSnapshot } from '../types.ts'

const views = ['questions', 'ideas', 'leaderboard', 'word-cloud', 'sentiment', 'polls', 'ratings', 'engagement', 'insights'] as const
type PresenterView = (typeof views)[number]
const presenterMilestones = [10, 25, 50, 100, 200]

type PollOption = { label: string; value: number }

type AnyTooltipEntry = {
  name?: unknown
  dataKey?: unknown
  value?: unknown
  color?: unknown
}

function presenterCssVar(name: string, fallback: string) {
  if (typeof window === 'undefined') return fallback
  const match = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return match || fallback
}

function ChartTooltip({
  active,
  payload,
  label,
  labelPrefix,
}: {
  active?: boolean
  payload?: readonly AnyTooltipEntry[]
  label?: unknown
  labelPrefix?: string
}) {
  if (!active || !payload || payload.length === 0) return null
  const first = payload[0]
  const seriesColor = typeof first?.color === 'string' ? first.color : 'var(--chart-primary)'
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip__label">
        {labelPrefix ? `${labelPrefix} ${String(label ?? '')}` : String(label ?? '')}
      </div>
      {payload.map((entry, index) => (
        <div key={`${String(entry.dataKey)}-${index}`} className="chart-tooltip__item">
          <span className="chart-tooltip__dot" style={{ background: seriesColor }} />
          <span style={{ color: 'var(--text-soft)', flex: '0 0 auto' }}>
            {String(entry.name ?? entry.dataKey)}:
          </span>
          <strong
            style={{
              marginLeft: 'auto',
              color: 'var(--text)',
              fontVariantNumeric: 'tabular-nums',
              fontWeight: 600,
            }}
          >
            {typeof entry.value === 'number' && Number.isInteger(entry.value)
              ? entry.value
              : typeof entry.value === 'number'
                ? entry.value.toFixed(1)
                : String(entry.value)}
          </strong>
        </div>
      ))}
    </div>
  )
}

function PresenterChartHeader({
  eyebrow,
  title,
  meta,
}: {
  eyebrow?: string
  title: string
  meta?: ReactNode
}) {
  return (
    <div style={{ marginBottom: '1rem' }}>
      {eyebrow ? (
        <div
          style={{
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            fontSize: '0.72rem',
            fontWeight: 600,
            color: '#cf6227',
            lineHeight: 1,
            marginBottom: '0.35rem',
          }}
        >
          {eyebrow}
        </div>
      ) : null}
      <h2>{title}</h2>
      {meta ? (
        <p
          className="presenter-support-copy"
          style={{ marginTop: '0.35rem' }}
        >
          {meta}
        </p>
      ) : null}
    </div>
  )
}

function PollBars({ options }: { options: PollOption[] }) {
  const total = options.reduce((acc, o) => acc + Math.max(0, o.value), 0)
  const max = options.reduce((acc, o) => Math.max(acc, o.value), 0)
  return (
    <div className="poll-bars">
      {options.map((option) => {
        const pct = total > 0 ? Math.round((option.value / total) * 100) : 0
        const fillPct = max > 0 ? Math.max(4, (option.value / max) * 100) : 0
        return (
          <div key={option.label} className="poll-bar" title={option.label}>
            <div style={{ minWidth: 0 }}>
              <div className="poll-bar__label" title={option.label}>
                {option.label}
              </div>
              <div className="poll-bar__track">
                <div className="poll-bar__fill" style={{ width: `${fillPct}%` }} />
              </div>
            </div>
            <div className="poll-bar__value">
              <span className="poll-bar__count">{option.value}</span>
              <span className="poll-bar__pct">{pct}%</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function getPresenterMomentum(totalResponses: number, reactionCount: number) {
  const score = totalResponses + reactionCount * 2
  if (score >= 200) {
    return { label: 'On fire', variant: 'warning' as const }
  }
  if (score >= 100) {
    return { label: 'Electric', variant: 'success' as const }
  }
  if (score >= 40) {
    return { label: 'Buzzing', variant: 'info' as const }
  }
  return { label: 'Warming up', variant: 'outline' as const }
}

function ConvexSnapshotSubscriber({
  code,
  onUpdate,
}: {
  code: string
  onUpdate: (next: EventSnapshot | null | undefined) => void
}) {
  const next = useQuery(convexQueries.getPublicByCode, code ? { code } : 'skip')
  useEffect(() => {
    onUpdate(next as EventSnapshot | null | undefined)
  }, [next, onUpdate])
  return null
}

export function PresenterPage() {
  const { code = '' } = useParams()
  const [convexOverride, setConvexOverride] = useState<EventSnapshot | null | undefined>(undefined)
  const [convexEnabled, setConvexEnabled] = useState(false)
  const [snapshot, setSnapshot] = useState<EventSnapshot | null>(null)
  const [view, setView] = useState<PresenterView>('questions')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const convexLoaded = convexOverride !== undefined
  const liveSnapshot = convexLoaded && convexOverride !== null
    ? convexOverride
    : snapshot

  useEffect(() => {
    let socket: Socket | undefined

    api
      .getPresenterEvent(code)
      .then((response) => {
        if (response.convex) {
          setConvexRuntimeConfig(response.convex)
          setConvexEnabled(Boolean(response.convex.enabled))
          setConvexOverride(undefined)
        }
        setSnapshot(response.snapshot)
        setLoading(false)
        socket = io(socketUrl, {
          transports: ['websocket'],
          withCredentials: true,
        })
        socket.emit('event:join-public', response.snapshot.event.id)
        socket.on('event:update-public', (nextSnapshot: EventSnapshot) => {
          setSnapshot(nextSnapshot)
        })
      })
      .catch((pageError) => {
        setError(pageError instanceof Error ? pageError.message : 'Unable to load presenter mode.')
        setLoading(false)
      })

    return () => {
      socket?.disconnect()
    }
  }, [code])

  const sentimentData = useMemo(() => {
    if (!liveSnapshot) {
      return []
    }

    return [
      { name: 'Positive', label: 'Positive', value: liveSnapshot.analytics.sentiment.positive },
      { name: 'Neutral', label: 'Neutral', value: liveSnapshot.analytics.sentiment.neutral },
      { name: 'Negative', label: 'Negative', value: liveSnapshot.analytics.sentiment.negative },
    ]
  }, [liveSnapshot])

  const paletteHook = useMemo(
    () => ({
      positive: presenterCssVar('--chart-positive', '#5ed4ad'),
      neutral: presenterCssVar('--chart-neutral', '#c9bfa8'),
      negative: presenterCssVar('--chart-negative', '#e28a8a'),
      primary: presenterCssVar('--chart-primary', '#cf6227'),
      secondary: presenterCssVar('--chart-secondary', '#b1ad3b'),
      tertiary: presenterCssVar('--chart-tertiary', '#5ed4ad'),
      grid: presenterCssVar('--chart-grid', 'rgba(207,165,121,0.16)'),
      axis: presenterCssVar('--chart-axis', 'rgba(207,165,121,0.32)'),
      tick: presenterCssVar('--chart-tick', '#c8bca6'),
    }),
    [liveSnapshot?.event.id],
  )

  const totalEngagement = useMemo(
    () => (liveSnapshot?.metrics.totalResponses ?? 0) + (liveSnapshot?.metrics.reactionCount ?? 0),
    [liveSnapshot?.metrics.reactionCount, liveSnapshot?.metrics.totalResponses],
  )

  const momentum = useMemo(
    () => getPresenterMomentum(liveSnapshot?.metrics.totalResponses ?? 0, liveSnapshot?.metrics.reactionCount ?? 0),
    [liveSnapshot?.metrics.reactionCount, liveSnapshot?.metrics.totalResponses],
  )

  const nextMilestone = useMemo(
    () => presenterMilestones.find((milestone) => milestone > totalEngagement) ?? null,
    [totalEngagement],
  )

  const unlockedMilestones = useMemo(
    () => presenterMilestones.filter((milestone) => milestone <= totalEngagement),
    [totalEngagement],
  )

  if (loading) {
    return (
      <main className="presenter-shell">
        <div className="presenter-center">
          <h1>Loading presenter mode...</h1>
        </div>
      </main>
    )
  }

  if (error || !liveSnapshot) {
    return (
      <main className="presenter-shell">
        <div className="presenter-center">
          <h1>Presenter mode unavailable</h1>
          <p>{error}</p>
        </div>
      </main>
    )
  }

  return (
    <>
      {convexEnabled
        ? (() => {
            const client = getConvexClient()
            if (!client) return null
            return (
              <ConvexProvider client={client}>
                <ConvexSnapshotSubscriber code={code} onUpdate={setConvexOverride} />
              </ConvexProvider>
            )
          })()
        : null}
      <main className="presenter-shell">
        <header className="presenter-header">
        <div>
          <div className="achievement-row">
            <Badge variant="info">{liveSnapshot.event.name}</Badge>
            <Badge variant={momentum.variant}>{momentum.label}</Badge>
          </div>
          <h1>{liveSnapshot.event.code}</h1>
        </div>
        <Tabs className="presenter-tabs">
          <TabsList>
            {views.map((item) => (
              <TabsTrigger key={item} active={view === item} onClick={() => setView(item)}>
                {item.replace('-', ' ')}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </header>

      <section className="presenter-marquee">
        <article className="presenter-card presenter-card--gamified">
          <span>Crowd momentum</span>
          <strong>{momentum.label}</strong>
          <p>
            {liveSnapshot.metrics.totalResponses} responses, {liveSnapshot.metrics.reactionCount} reactions, and {liveSnapshot.metrics.uniqueParticipants} anonymous participants are driving the room.
          </p>
        </article>
        <article className="presenter-card presenter-card--gamified">
          <span>Next room unlock</span>
          <strong>{nextMilestone ? `${nextMilestone} interactions` : 'All milestones cleared'}</strong>
          <p>
            {nextMilestone
              ? `${nextMilestone - totalEngagement} more audience actions to hit the next presenter milestone.`
              : 'The audience has unlocked every current milestone.'}
          </p>
        </article>
        <article className="presenter-card presenter-card--gamified">
          <span>Presenter prompt</span>
          <strong>{view === 'questions' ? 'Keep the Q&A moving' : 'Show the room their impact'}</strong>
          <p>
            Use this view to reinforce participation and let attendees see the room respond in real time.
          </p>
        </article>
      </section>

      {unlockedMilestones.length > 0 ? (
        <section className="presenter-achievements">
          {unlockedMilestones.map((milestone) => (
            <Badge key={milestone} variant="outline">
              {milestone} room unlock
            </Badge>
          ))}
        </section>
      ) : null}

      <section className={`presenter-stage ${totalEngagement >= 100 ? 'presenter-stage--charged' : ''}`}>
        {view === 'questions' ? (
          <div className="presenter-question-grid">
            {liveSnapshot.presenterQuestions.map((question) => (
              <article key={question.id} className={`presenter-card ${question.highlighted ? 'highlighted' : ''}`}>
                <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--muted)', fontSize: '0.82rem', letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 600 }}>
                    {question.interactionPrompt}
                  </span>
                  <Badge variant={question.moderationState === 'answered' ? 'success' : 'outline'}>
                    {question.moderationState === 'answered' ? 'Answered' : question.highlighted ? 'Highlighted' : 'Live'}
                  </Badge>
                </span>
                <strong style={{ marginTop: '0.6rem', display: 'block' }}>{question.text}</strong>
                <p style={{ marginTop: '0.7rem' }}>
                  {question.timeLabel} • ▲ {question.votes.up} upvotes • score {question.votes.score}
                </p>
              </article>
            ))}
            {liveSnapshot.presenterQuestions.length === 0 ? (
              <div className="presenter-center">Approved audience questions will appear here. Moderate from the dashboard to surface them on stage.</div>
            ) : null}
          </div>
        ) : null}

        {view === 'ideas' ? (
          <div className="presenter-question-grid">
            {liveSnapshot.ideaFeed.map((idea) => (
              <article key={idea.id} className="presenter-card presenter-card--gamified">
                <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--muted)', fontSize: '0.82rem', letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 600 }}>
                    {idea.interactionPrompt}
                  </span>
                  <Badge variant={idea.sentiment === 'positive' ? 'success' : idea.sentiment === 'negative' ? 'danger' : 'outline'}>
                    {idea.sentiment}
                  </Badge>
                </span>
                <strong style={{ marginTop: '0.6rem', display: 'block' }}>{idea.text}</strong>
                <p style={{ marginTop: '0.5rem' }}>
                  {idea.team} • {idea.nickname}
                </p>
                <p>
                  Score {idea.votes.score} • ▲ {idea.votes.up} upvotes • {idea.timeLabel}
                </p>
              </article>
            ))}
            {liveSnapshot.ideaFeed.length === 0 ? (
              <div className="presenter-center">Ideas and opportunities will appear here as attendees share them.</div>
            ) : null}
          </div>
        ) : null}

        {view === 'leaderboard' ? (
          <div className="presenter-metric-grid">
            {liveSnapshot.teamLeaderboard.map((entry, index) => (
              <article key={entry.team} className="presenter-card presenter-card--gamified">
                <span>#{index + 1}</span>
                <strong>{entry.team}</strong>
                <p>
                  {entry.points} pts • {entry.contributors} contributors
                </p>
                <p>
                  {entry.contributions} actions • {entry.votesReceived} upvotes earned
                </p>
              </article>
            ))}
          </div>
        ) : null}

        {view === 'word-cloud' ? (
          <div className="presenter-word-cloud">
            {liveSnapshot.analytics.wordCloud.length > 0 ? (
              liveSnapshot.analytics.wordCloud.map((entry) => (
                <span key={entry.word} style={{ fontSize: `${entry.weight + 0.5}rem` }}>
                  {entry.word}
                </span>
              ))
            ) : (
              <div className="presenter-center">Not enough text responses yet for a word cloud.</div>
            )}
          </div>
        ) : null}

        {view === 'sentiment' ? (
          <div className="presenter-chart">
            <PresenterChartHeader eyebrow="Sentiment" title="Audience sentiment" meta="Automated text analysis scaled as directional audience signal." />
            <ResponsiveContainer width="100%" height={420}>
              <BarChart data={sentimentData} margin={{ top: 8, right: 24, left: 0, bottom: 4 }}>
                <CartesianGrid stroke={paletteHook.grid} vertical={false} />
                <XAxis
                  dataKey="label"
                  stroke={paletteHook.tick}
                  tickLine={false}
                  axisLine={{ stroke: paletteHook.axis }}
                  fontSize={13}
                  tick={{ fill: paletteHook.tick, fontWeight: 500 }}
                />
                <YAxis
                  stroke={paletteHook.tick}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                  fontSize={13}
                  tick={{ fill: paletteHook.tick }}
                  width={42}
                />
                <Tooltip
                  cursor={{ stroke: paletteHook.axis, strokeDasharray: '4 4' }}
                  content={(props) => (
                    <ChartTooltip
                      active={props.active}
                      payload={props.payload as unknown as AnyTooltipEntry[]}
                      label={props.label}
                    />
                  )}
                />
                <Bar
                  dataKey="value"
                  name="Score"
                  radius={[14, 14, 0, 0]}
                  barSize={72}
                >
                  {sentimentData.map((entry) => (
                    <Cell
                      key={entry.name}
                      fill={
                        entry.name === 'Positive'
                          ? paletteHook.positive
                          : entry.name === 'Neutral'
                            ? paletteHook.neutral
                            : paletteHook.negative
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : null}

        {view === 'polls' ? (
          <div className="presenter-chart">
            <PresenterChartHeader
              eyebrow="Polls"
              title={liveSnapshot.activePoll ? 'Live poll results' : 'Facilitator poll queue'}
              meta={
                liveSnapshot.activePoll
                  ? liveSnapshot.activePoll.prompt
                  : 'Select Launch poll in the dashboard to project results live here.'
              }
            />
            {liveSnapshot.activePoll ? (
              <PollBars options={liveSnapshot.activePoll.options} />
            ) : liveSnapshot.pollResults[0] ? (
              <div className="presenter-insights">
                {liveSnapshot.pollResults.slice(0, 6).map((poll) => (
                  <article key={poll.id} className="presenter-card">
                    <span>{poll.active ? 'Live now' : 'Ready to launch'}</span>
                    <strong>{poll.prompt}</strong>
                    <p>{poll.totalVotes} responses so far</p>
                  </article>
                ))}
              </div>
            ) : (
              <div className="presenter-center">No polls configured yet.</div>
            )}
          </div>
        ) : null}

        {view === 'ratings' ? (
          <div className="presenter-metric-grid">
            {liveSnapshot.ratingResults.map((rating) => (
              <article key={rating.id} className="presenter-card">
                <span>{rating.prompt}</span>
                <strong>
                  {rating.average}/{rating.scale}
                </strong>
                <p>{rating.responses} responses</p>
              </article>
            ))}
            {liveSnapshot.reactionTotals.map((reaction) => (
              <article key={reaction.label} className="presenter-card">
                <span>{reaction.label}</span>
                <strong>{reaction.value}</strong>
                <p>Live reactions</p>
              </article>
            ))}
          </div>
        ) : null}

        {view === 'engagement' ? (
          <div className="presenter-chart">
            <PresenterChartHeader
              eyebrow="Timeline"
              title="Participation volume"
              meta={
                <>
                  Total room activity: <strong>{totalEngagement}</strong> • next milestone:{' '}
                  <strong>{nextMilestone ?? 'complete'}</strong>
                </>
              }
            />
            <ResponsiveContainer width="100%" height={420}>
              <LineChart
                data={liveSnapshot.metrics.timeline}
                margin={{ top: 8, right: 24, left: 0, bottom: 4 }}
              >
                <defs>
                  <linearGradient id="presenter-engagement-cursor" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={paletteHook.primary} stopOpacity={0.32} />
                    <stop offset="100%" stopColor={paletteHook.primary} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={paletteHook.grid} vertical={false} />
                <XAxis
                  dataKey="time"
                  stroke={paletteHook.tick}
                  tickLine={false}
                  axisLine={{ stroke: paletteHook.axis }}
                  fontSize={13}
                  tick={{ fill: paletteHook.tick }}
                  interval={liveSnapshot.metrics.timeline.length > 10 ? 'preserveStartEnd' : 0}
                />
                <YAxis
                  stroke={paletteHook.tick}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                  fontSize={13}
                  tick={{ fill: paletteHook.tick }}
                  width={42}
                />
                <Tooltip
                  cursor={{ stroke: paletteHook.primary, strokeDasharray: '4 4' }}
                  content={(props) => (
                    <ChartTooltip
                      active={props.active}
                      payload={props.payload as unknown as AnyTooltipEntry[]}
                      label={props.label}
                      labelPrefix="Window"
                    />
                  )}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  name="Actions"
                  stroke={paletteHook.primary}
                  strokeWidth={4}
                  dot={false}
                  activeDot={{ r: 5, stroke: paletteHook.primary, strokeWidth: 2, fill: '#fff7f1' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : null}

        {view === 'insights' ? (
          <div className="presenter-insights">
            <article className="presenter-card">
              <span>Top themes</span>
              <strong>{liveSnapshot.analytics.themes.map((theme) => theme.theme).join(', ') || 'Waiting for more responses'}</strong>
            </article>
            <article className="presenter-card">
              <span>Frequent words</span>
              <strong>{liveSnapshot.analytics.keywords.slice(0, 6).map((word) => word.word).join(', ') || 'Not enough data yet'}</strong>
            </article>
            <article className="presenter-card wide">
              <span>Emerging concerns</span>
              <strong>{liveSnapshot.analytics.emergingConcerns.join(' ')}</strong>
            </article>
          </div>
        ) : null}
      </section>
    </main>
    </>
  )
}
