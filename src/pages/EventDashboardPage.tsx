import { useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { io, type Socket } from 'socket.io-client'
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Alert } from '../components/ui/Alert.tsx'
import { Badge } from '../components/ui/Badge.tsx'
import { Button } from '../components/ui/Button.tsx'
import { buttonClasses } from '../components/ui/buttonClasses.ts'
import { Card, CardHeader, CardTitle, CardDescription } from '../components/ui/Card.tsx'
import { Field, Input, Select, Textarea } from '../components/ui/Field.tsx'
import { Tabs, TabsList, TabsTrigger } from '../components/ui/Tabs.tsx'
import { api } from '../lib/api.ts'
import { parseInteractionFile } from '../lib/interactionImport.ts'
import { socketUrl } from '../lib/realtime.ts'
import type { EventSnapshot, InteractionRecord, InteractionType } from '../types.ts'

type PollOption = { label: string; value: number }

const dashboardTabs = ['overview', 'analytics', 'questions', 'polls', 'compose'] as const
type DashboardTab = (typeof dashboardTabs)[number]

const TAB_LABEL: Record<DashboardTab, string> = {
  overview: 'Overview',
  analytics: 'Analytics',
  questions: 'Questions',
  polls: 'Polls',
  compose: 'Compose',
}

type AnyTooltipEntry = {
  name?: unknown
  dataKey?: unknown
  value?: unknown
  color?: unknown
}

function cssVar(name: string) {
  const match = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return match || '#8a8070'
}

function resolvePaletteCssVar(token: string, fallback: string) {
  if (typeof window === 'undefined') return fallback
  return cssVar(token) || fallback
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

function ChartShell({
  eyebrow,
  title,
  meta,
  children,
  className = '',
}: {
  eyebrow?: string
  title: string
  meta?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`chart-shell ${className}`}>
      <div className="chart-shell__header">
        <div style={{ minWidth: 0 }}>
          {eyebrow ? <div className="chart-shell__eyebrow">{eyebrow}</div> : null}
          <div className="chart-shell__title">{title}</div>
          {meta ? <div className="chart-shell__meta">{meta}</div> : null}
        </div>
      </div>
      {children}
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

export function EventDashboardPage() {
  const { eventId = '' } = useParams()
  const [snapshot, setSnapshot] = useState<EventSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<DashboardTab>('overview')
  const [interactionForm, setInteractionForm] = useState({
    type: 'question' as InteractionRecord['type'],
    prompt: '',
    options: 'Option A, Option B',
  })

  useEffect(() => {
    let socket: Socket | undefined

    api
      .getAdminEvent(eventId)
      .then((response) => {
        setSnapshot(response)
        setLoading(false)
        socket = io(socketUrl, {
          transports: ['websocket'],
          withCredentials: true,
        })
        socket.emit('event:join-admin', response.event.id)
        socket.on('event:update-admin', (nextSnapshot: EventSnapshot) => {
          setSnapshot(nextSnapshot)
        })
      })
      .catch((pageError) => {
        setLoadError(pageError instanceof Error ? pageError.message : 'Unable to load event dashboard.')
        setLoading(false)
      })

    return () => {
      socket?.disconnect()
    }
  }, [eventId])

  async function moderate(
    responseId: string,
    moderationState: 'pending' | 'visible' | 'hidden' | 'answered' | 'deleted',
    highlighted?: boolean,
  ) {
    try {
      setError('')
      setNotice('')
      await api.updateResponse(responseId, { moderationState, highlighted })
      const label =
        moderationState === 'visible'
          ? 'Question is now visible on the dashboard and stage.'
          : moderationState === 'hidden'
            ? 'Question removed from all public views.'
            : moderationState === 'answered'
              ? 'Question marked as answered.'
              : moderationState === 'deleted'
                ? 'Question permanently deleted.'
                : 'Question returned to pending review.'
      setNotice(label)
    } catch (moderateError) {
      const fallback =
        moderationState === 'deleted'
          ? 'Unable to delete question. Refresh and try again.'
          : 'Unable to update question state. Refresh and try again.'
      setError(moderateError instanceof Error ? moderateError.message : fallback)
      setNotice('')
    }
  }

  async function toggleEventStatus() {
    if (!snapshot) {
      return
    }
    setSaving(true)
    try {
      setError('')
      setNotice('')
      await api.updateEvent(snapshot.event.id, {
        status: snapshot.event.status === 'active' ? 'inactive' : 'active',
      })
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Unable to update event.')
    } finally {
      setSaving(false)
    }
  }

  async function setActivePoll(interactionId: string | null) {
    if (!snapshot) {
      return
    }

    setSaving(true)
    try {
      setError('')
      setNotice('')
      await api.updateEvent(snapshot.event.id, {
        config: {
          ...snapshot.event.config,
          activePollInteractionId: interactionId,
        },
      })
      setNotice(interactionId ? 'Live poll launched on the public dashboard.' : 'Live poll cleared.')
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Unable to update live poll.')
    } finally {
      setSaving(false)
    }
  }

  async function createInteraction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!snapshot) {
      return
    }

    const options = interactionForm.options
      .split(',')
      .map((option) => option.trim())
      .filter(Boolean)

    setSaving(true)
    try {
      setError('')
      await api.createInteraction(snapshot.event.id, {
        type: interactionForm.type as 'question' | 'feedback' | 'rating' | 'poll' | 'reaction',
        prompt: interactionForm.prompt,
        options: interactionForm.type === 'poll' || interactionForm.type === 'reaction' ? options : [],
        settings:
          interactionForm.type === 'rating'
            ? { scale: 5 }
            : interactionForm.type === 'poll'
              ? { allowMultiple: false }
              : {},
      })
      setInteractionForm({ type: 'question', prompt: '', options: 'Option A, Option B' })
      setNotice('Interaction created.')
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Unable to create interaction.')
    } finally {
      setSaving(false)
    }
  }

  async function uploadInteractions(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!snapshot) {
      return
    }

    const formData = new FormData(event.currentTarget)
    const file = formData.get('interaction-file')

    if (!(file instanceof File) || file.size === 0) {
      setError('Choose a .json or .csv file to import interactions.')
      setNotice('')
      return
    }

    setSaving(true)
    try {
      setError('')
      const interactions = await parseInteractionFile(file)
      const response = await api.importInteractions(snapshot.event.id, { interactions })
      setNotice(`Imported ${response.importedCount} interaction${response.importedCount === 1 ? '' : 's'} from ${file.name}.`)
      event.currentTarget.reset()
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Unable to import interactions.')
      setNotice('')
    } finally {
      setSaving(false)
    }
  }

  const sentimentData = useMemo(() => {
    if (!snapshot) {
      return []
    }

    return [
      { name: 'Positive', label: 'Positive', value: snapshot.analytics.sentiment.positive },
      { name: 'Neutral', label: 'Neutral', value: snapshot.analytics.sentiment.neutral },
      { name: 'Negative', label: 'Negative', value: snapshot.analytics.sentiment.negative },
    ]
  }, [snapshot])

  const paletteHook = useMemo(
    () => ({
      positive: resolvePaletteCssVar('--chart-positive', '#5ed4ad'),
      neutral: resolvePaletteCssVar('--chart-neutral', '#c9bfa8'),
      negative: resolvePaletteCssVar('--chart-negative', '#e28a8a'),
      primary: resolvePaletteCssVar('--chart-primary', '#cf6227'),
      secondary: resolvePaletteCssVar('--chart-secondary', '#6e6a0d'),
      grid: resolvePaletteCssVar('--chart-grid', '#f0ead9'),
      axis: resolvePaletteCssVar('--chart-axis', '#a29883'),
      tick: resolvePaletteCssVar('--chart-tick', '#7d7466'),
    }),
    [snapshot?.event.id],
  )

  if (loading) {
    return (
      <main className="page center-state">
        <Card className="ui-state-card">
          <h1>Loading event dashboard...</h1>
          <p>Bringing in the latest audience activity.</p>
        </Card>
      </main>
    )
  }

  if (loadError || !snapshot) {
    return (
      <main className="page center-state">
        <Card className="ui-state-card">
          <h1>Unable to open this event.</h1>
          <p>{loadError || 'Please check your organizer session and try again.'}</p>
        </Card>
      </main>
    )
  }

  return (
    <main className="page event-dashboard">
      <section className="section-header">
        <div>
          <span className="eyebrow">{snapshot.event.isDemo ? 'Demo event' : 'Live event'}</span>
          <h1>{snapshot.event.name}</h1>
          <p>
            Code <strong>{snapshot.event.code}</strong> • {snapshot.event.description}
          </p>
        </div>
        <div className="header-actions">
          <Link className={buttonClasses({ variant: 'outline' })} to={`/event/${snapshot.event.code}`}>
            Attendee view
          </Link>
          <Link className={buttonClasses({ variant: 'outline' })} to={`/present/${snapshot.event.code}`}>
            Presenter mode
          </Link>
          <Button type="button" onClick={toggleEventStatus} disabled={saving}>
            {snapshot.event.status === 'active' ? 'Deactivate' : 'Activate'}
          </Button>
        </div>
      </section>

      {snapshot.analytics.pendingAnalyses > 0 ? (
        <Alert variant="info">
          AI analysis is catching up on {snapshot.analytics.pendingAnalyses} recent text responses.
        </Alert>
      ) : null}
      {notice ? <Alert variant="success">{notice}</Alert> : null}
      {error ? <Alert variant="danger">{error}</Alert> : null}

      <Tabs className="dashboard-tabs">
        <TabsList>
          {dashboardTabs.map((tab) => (
            <TabsTrigger key={tab} active={activeTab === tab} onClick={() => setActiveTab(tab)}>
              {TAB_LABEL[tab]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {activeTab === 'overview' ? (
        <>
          <section className="metric-grid">
            <MetricCard label="Total responses" value={snapshot.metrics.totalResponses} />
            <MetricCard label="Questions submitted" value={snapshot.metrics.questionCount} />
            <MetricCard label="Poll participation" value={`${snapshot.metrics.pollParticipation}%`} />
            <MetricCard label="Average rating" value={`${snapshot.metrics.averageRating}/5`} />
            <MetricCard label="Reactions" value={snapshot.metrics.reactionCount} />
            <MetricCard label="Positive sentiment" value={`${snapshot.analytics.sentiment.positive}%`} accent />
          </section>

          {snapshot.ratingResults.length ? (
            <Card>
              <CardHeader className="panel-heading">
                <CardTitle>Pulse check · Sentiment gauge</CardTitle>
                <CardDescription>
                  A rolling summary of how the audience is feeling about the session right now.
                </CardDescription>
              </CardHeader>
              <div style={{ padding: '1.25rem 1.5rem 1.5rem' }}>
                {snapshot.ratingResults.map((rating) => {
                  const ratio = Math.max(0, Math.min(1, Number.isFinite(rating.average) ? rating.average / rating.scale : 0))
                  const circumference = 2 * Math.PI * 46
                  const strokeDashoffset = circumference * (1 - ratio)
                  const chartPositive = resolvePaletteCssVar('--chart-positive', '#5ed4ad')
                  const chartNeutral = resolvePaletteCssVar('--chart-neutral', '#c9bfa8')
                  const chartNegative = resolvePaletteCssVar('--chart-negative', '#e28a8a')
                  const chartPrimary = resolvePaletteCssVar('--chart-primary', '#cf6227')
                  const sentimentLabel =
                    rating.average >= 4.2
                      ? 'Strongly positive'
                      : rating.average >= 3.5
                        ? 'Positive'
                        : rating.average >= 2.5
                          ? 'Neutral'
                          : rating.average >= 1.5
                            ? 'Cooler room'
                            : 'Concern flagged'
                  const pulseColor =
                    rating.average >= 4.2
                      ? chartPositive
                      : rating.average >= 3.5
                        ? chartPrimary
                        : rating.average >= 2.5
                          ? chartNeutral
                          : chartNegative
                  return (
                    <article key={rating.id} className="pulse-card">
                      <div className="pulse-card__gauge" aria-hidden>
                        <svg viewBox="0 0 120 120">
                          <circle className="gauge-track" cx="60" cy="60" r="46" />
                          <circle
                            className="gauge-fill"
                            cx="60"
                            cy="60"
                            r="46"
                            stroke={pulseColor}
                            strokeDasharray={circumference}
                            strokeDashoffset={strokeDashoffset}
                          />
                        </svg>
                        <div className="pulse-card__gauge-center">
                          <div>
                            <div className="pulse-card__avg">{rating.responses ? rating.average : '—'}</div>
                            <div className="pulse-card__scale">/ {rating.scale}</div>
                          </div>
                        </div>
                      </div>
                      <div>
                        <h3 className="pulse-card__headline">{rating.prompt}</h3>
                        <p className="pulse-card__sub">
                          {rating.responses
                            ? `This pulse reading aggregates ${rating.responses} anonymous attendee ratings in real time.`
                            : 'No one has voted on this pulse yet — ratings will populate here as the room responds.'}
                        </p>
                        <div className="pulse-card__summary">
                          <span className="pulse-card__badge">{sentimentLabel}</span>
                          <span className="pulse-card__badge">{rating.responses.toLocaleString()} responses</span>
                          <span className="pulse-card__badge">1–{rating.scale} scale</span>
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            </Card>
          ) : null}
        </>
      ) : null}

      {activeTab === 'analytics' ? (
        <>
          <section className="dashboard-two-col">
            <Card className="chart-panel">
              <ChartShell
                eyebrow="Engagement"
                title="Audience activity over time"
                meta="Automatic live updates with no refresh required."
              >
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={snapshot.metrics.timeline} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                    <defs>
                      <linearGradient id="engagementFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={paletteHook.primary} stopOpacity={0.22} />
                        <stop offset="100%" stopColor={paletteHook.primary} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke={paletteHook.grid} vertical={false} />
                    <XAxis
                      dataKey="time"
                      stroke={paletteHook.tick}
                      tickLine={false}
                      axisLine={{ stroke: paletteHook.axis }}
                      interval="preserveStartEnd"
                      fontSize={11}
                      tick={{ fill: paletteHook.tick }}
                    />
                    <YAxis
                      stroke={paletteHook.tick}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                      fontSize={11}
                      tick={{ fill: paletteHook.tick }}
                      width={34}
                    />
                    <Tooltip
                      cursor={{ stroke: paletteHook.axis, strokeDasharray: '4 4' }}
                      labelClassName="chart-tooltip__label"
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
                      name="Responses"
                      stroke={paletteHook.primary}
                      strokeWidth={2.5}
                      dot={false}
                      activeDot={{ r: 5, strokeWidth: 0, fill: paletteHook.primary }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </ChartShell>
            </Card>

            <Card className="chart-panel">
              <ChartShell
                eyebrow="Sentiment"
                title="Audience sentiment"
                meta="Automated text analysis, presented as directional signal."
              >
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 200px', gap: '1rem', alignItems: 'center' }}>
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie
                        data={sentimentData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={64}
                        outerRadius={104}
                        paddingAngle={4}
                        strokeWidth={0}
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
                      </Pie>
                      <Tooltip
                        content={(props) => (
                          <ChartTooltip
                            active={props.active}
                            payload={props.payload as unknown as AnyTooltipEntry[]}
                            label={props.label}
                          />
                        )}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ display: 'grid', gap: '0.55rem' }}>
                    {sentimentData.map((entry) => (
                      <div key={entry.name} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <span
                          aria-hidden
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: 999,
                            background:
                              entry.name === 'Positive'
                                ? paletteHook.positive
                                : entry.name === 'Neutral'
                                  ? paletteHook.neutral
                                  : paletteHook.negative,
                            flex: '0 0 auto',
                          }}
                        />
                        <span style={{ color: 'var(--text-soft)', fontSize: '0.9rem', flex: '1 1 auto' }}>{entry.name}</span>
                        <strong
                          style={{
                            color: 'var(--text)',
                            fontVariantNumeric: 'tabular-nums',
                            fontWeight: 600,
                            fontSize: '0.98rem',
                          }}
                        >
                          {entry.value}%
                        </strong>
                      </div>
                    ))}
                  </div>
                </div>
              </ChartShell>
            </Card>
          </section>

          <section className="dashboard-three-col">
            <Card>
              <CardHeader className="panel-heading">
                <CardTitle>Word cloud</CardTitle>
                <CardDescription>Meaningful terms only, scaled by frequency.</CardDescription>
              </CardHeader>
              <div className="word-cloud">
                {snapshot.analytics.wordCloud.length > 0 ? (
                  snapshot.analytics.wordCloud.map((entry) => (
                    <span key={entry.word} style={{ fontSize: `${entry.weight}rem` }}>
                      {entry.word}
                    </span>
                  ))
                ) : (
                  <p className="muted">Not enough text responses yet for a word cloud.</p>
                )}
              </div>

              <div className="insight-block">
                <h3>Emerging concerns</h3>
                {snapshot.analytics.emergingConcerns.map((concern) => (
                  <p key={concern}>{concern}</p>
                ))}
              </div>
            </Card>

            <Card>
              <CardHeader className="panel-heading">
                <CardTitle>Top themes</CardTitle>
                <CardDescription>Topic clusters pulled from text responses.</CardDescription>
              </CardHeader>
              <div className="chip-row" style={{ padding: '0 1.25rem 1.25rem' }}>
                {snapshot.analytics.themes.length > 0 ? (
                  snapshot.analytics.themes.map((theme) => (
                    <Badge key={theme.theme} variant="outline">
                      {theme.theme}
                    </Badge>
                  ))
                ) : (
                  <p className="muted">Not enough text responses yet to identify dominant themes.</p>
                )}
              </div>
            </Card>

            <Card>
              <CardHeader className="panel-heading">
                <CardTitle>Pulse check · Sentiment + reactions</CardTitle>
                <CardDescription>Audience pulse ratings paired with live reaction taps from the session.</CardDescription>
              </CardHeader>
              <div className="stack-list">
                {snapshot.ratingResults.map((rating) => (
                  <div key={rating.id} className="stat-row">
                    <div>
                      <strong>{rating.prompt}</strong>
                      <p>{rating.responses} responses</p>
                    </div>
                    <span>
                      {rating.average}/{rating.scale}
                    </span>
                  </div>
                ))}
                {snapshot.reactionTotals.map((reaction) => (
                  <div key={reaction.label} className="stat-row">
                    <div>
                      <strong>{reaction.label}</strong>
                      <p>Live reaction taps</p>
                    </div>
                    <span>{reaction.value}</span>
                  </div>
                ))}
              </div>
            </Card>
          </section>
        </>
      ) : null}

      {activeTab === 'questions' ? (
        <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: '1.25rem' }}>
          <Card>
            <CardHeader className="panel-heading">
              <CardTitle>Ask the Room</CardTitle>
              <CardDescription>Questions and votes update live as the room responds.</CardDescription>
            </CardHeader>
            <div className="question-table question-table--header">
              <span>Question</span>
              <span>Votes</span>
            </div>
            <div className="question-list">
              {snapshot.questionStream.map((question) => (
                <div key={question.id} className={`question-item ${question.highlighted ? 'highlighted' : ''}`}>
                  <div className="question-item__body">
                    <strong>{question.text}</strong>
                    <p>
                      {question.timeLabel} • {question.moderationState}
                    </p>
                  </div>
                  <div className="question-vote-pill">▲ {question.votes.up}</div>
                  <div className="question-actions">
                    <Button type="button" size="sm" variant="secondary" onClick={() => moderate(question.id, 'visible', question.highlighted)}>
                      Show
                    </Button>
                    <Button type="button" size="sm" variant="secondary" onClick={() => moderate(question.id, 'hidden', false)}>
                      Hide
                    </Button>
                    <Button type="button" size="sm" variant="secondary" onClick={() => moderate(question.id, 'answered', false)}>
                      Answered
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => moderate(question.id, question.moderationState, !question.highlighted)}>
                      {question.highlighted ? 'Unhighlight' : 'Highlight'}
                    </Button>
                    <Button type="button" size="sm" variant="danger" onClick={() => moderate(question.id, 'deleted', false)}>
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
              {snapshot.questionStream.length === 0 ? <p className="muted">Questions will appear here as they arrive.</p> : null}
            </div>
          </Card>
        </section>
      ) : null}

      {activeTab === 'polls' ? (
        <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: '1.25rem' }}>
          <Card className="chart-panel">
            <ChartShell
              eyebrow="Polls"
              title="Poll results"
              meta="Launch a poll from here and its results will appear instantly on attendee and presenter screens."
            >
              {snapshot.pollResults.map((poll) => (
                <div key={poll.id} className="poll-block">
                  <div className="poll-block__header">
                    <div>
                      <strong>{poll.prompt}</strong>
                      <p>{poll.totalVotes} responses</p>
                    </div>
                    <div className="achievement-row">
                      {poll.active ? <Badge variant="success">Live now</Badge> : null}
                      <Button
                        type="button"
                        size="sm"
                        variant={poll.active ? 'outline' : 'secondary'}
                        disabled={saving}
                        onClick={() => setActivePoll(poll.active ? null : poll.id)}
                      >
                        {poll.active ? 'Clear poll' : 'Launch poll'}
                      </Button>
                    </div>
                  </div>
                  <PollBars options={poll.options} />
                </div>
              ))}
              {snapshot.pollResults.length === 0 ? (
                <p className="muted" style={{ marginTop: '0.5rem' }}>
                  No polls configured yet. Switch to the Compose tab to create one.
                </p>
              ) : null}
            </ChartShell>
          </Card>
        </section>
      ) : null}

      {activeTab === 'compose' ? (
        <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: '1.25rem' }}>
          <Card>
            <CardHeader className="panel-heading">
              <CardTitle>Create interaction</CardTitle>
              <CardDescription>Add new audience prompts or upload a file of interactions without leaving the dashboard.</CardDescription>
            </CardHeader>
            <form className="stack-form" onSubmit={createInteraction}>
              <Field label="Type">
                <Select
                  value={interactionForm.type}
                  onChange={(event) => setInteractionForm((current) => ({ ...current, type: event.target.value as InteractionType }))}
                >
                  <option value="question">Question</option>
                  <option value="feedback">Feedback</option>
                  <option value="rating">Rating</option>
                  <option value="poll">Poll</option>
                  <option value="reaction">Reaction</option>
                </Select>
              </Field>
              <Field label="Prompt">
                <Textarea
                  rows={3}
                  value={interactionForm.prompt}
                  onChange={(event) => setInteractionForm((current) => ({ ...current, prompt: event.target.value }))}
                  placeholder="Ask your audience something useful"
                />
              </Field>
              {interactionForm.type === 'poll' || interactionForm.type === 'reaction' ? (
                <Field label="Options">
                  <Textarea
                    rows={3}
                    value={interactionForm.options}
                    onChange={(event) => setInteractionForm((current) => ({ ...current, options: event.target.value }))}
                    placeholder="Comma-separated options"
                  />
                </Field>
              ) : null}
              <Button type="submit" disabled={saving}>
                Add interaction
              </Button>
            </form>
            <form className="stack-form import-form" onSubmit={uploadInteractions}>
              <Field
                label="Import from file"
                description="Upload a .json or .csv file with interactions. CSV columns: type, prompt, options, scale, allowMultiple, status, ordering. Use | between options."
              >
                <Input name="interaction-file" type="file" accept=".json,.csv,application/json,text/csv" />
              </Field>
              <div className="import-actions">
                <a
                  className={buttonClasses({ variant: 'ghost' })}
                  href="/interaction-import-template.csv"
                  download="interaction-import-template.csv"
                >
                  Download CSV template
                </a>
                <Button type="submit" variant="outline" disabled={saving}>
                  Upload interactions
                </Button>
              </div>
            </form>
          </Card>
        </section>
      ) : null}
    </main>
  )
}

function MetricCard({ label, value, accent = false }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <article className={`metric-card ${accent ? 'accent' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  )
}
