import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { io, type Socket } from 'socket.io-client'
import {
  Bar,
  BarChart,
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
import { api } from '../lib/api.ts'
import { parseInteractionFile } from '../lib/interactionImport.ts'
import { socketUrl } from '../lib/realtime.ts'
import type { EventSnapshot } from '../types.ts'

const sentimentColors = ['#34d399', '#a78bfa', '#fb7185']

export function EventDashboardPage() {
  const { eventId = '' } = useParams()
  const [snapshot, setSnapshot] = useState<EventSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [interactionForm, setInteractionForm] = useState({
    type: 'question',
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
    await api.updateResponse(responseId, { moderationState, highlighted })
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
      { name: 'Positive', value: snapshot.analytics.sentiment.positive },
      { name: 'Neutral', value: snapshot.analytics.sentiment.neutral },
      { name: 'Negative', value: snapshot.analytics.sentiment.negative },
    ]
  }, [snapshot])

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

      <section className="metric-grid">
        <MetricCard label="Total responses" value={snapshot.metrics.totalResponses} />
        <MetricCard label="Questions submitted" value={snapshot.metrics.questionCount} />
        <MetricCard label="Poll participation" value={`${snapshot.metrics.pollParticipation}%`} />
        <MetricCard label="Average rating" value={`${snapshot.metrics.averageRating}/5`} />
        <MetricCard label="Reactions" value={snapshot.metrics.reactionCount} />
        <MetricCard label="Positive sentiment" value={`${snapshot.analytics.sentiment.positive}%`} accent />
      </section>

      <section className="dashboard-two-col">
        <Card className="chart-panel">
          <CardHeader className="panel-heading">
            <CardTitle>Engagement over time</CardTitle>
            <CardDescription>Automatic live updates with no refresh required.</CardDescription>
          </CardHeader>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={snapshot.metrics.timeline}>
              <CartesianGrid stroke="#243147" strokeDasharray="3 3" />
              <XAxis dataKey="time" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" allowDecimals={false} />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke="#7c3aed" strokeWidth={3} />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card className="chart-panel">
          <CardHeader className="panel-heading">
            <CardTitle>Sentiment distribution</CardTitle>
            <CardDescription>Automated text analysis, presented as directional signal.</CardDescription>
          </CardHeader>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={sentimentData} dataKey="value" innerRadius={65} outerRadius={95}>
                {sentimentData.map((entry, index) => (
                  <Cell key={entry.name} fill={sentimentColors[index]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      </section>

      <section className="dashboard-three-col">
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
            <CardTitle>Create interaction</CardTitle>
            <CardDescription>Add new audience prompts or upload a file of interactions without leaving the dashboard.</CardDescription>
          </CardHeader>
          <form className="stack-form" onSubmit={createInteraction}>
            <Field label="Type">
              <Select
                value={interactionForm.type}
                onChange={(event) => setInteractionForm((current) => ({ ...current, type: event.target.value }))}
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

      <section className="dashboard-two-col">
        <Card className="chart-panel">
          <CardHeader className="panel-heading">
            <CardTitle>Poll results</CardTitle>
            <CardDescription>Launch a poll from here and its results will appear instantly on attendee and presenter screens.</CardDescription>
          </CardHeader>
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
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={poll.options}>
                  <CartesianGrid stroke="#243147" strokeDasharray="3 3" />
                  <XAxis dataKey="label" stroke="#94a3b8" interval={0} angle={-8} height={60} textAnchor="end" />
                  <YAxis stroke="#94a3b8" allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#22d3ee" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ))}
          {snapshot.pollResults.length === 0 ? <p className="muted">No polls configured yet.</p> : null}
        </Card>

        <Card>
          <CardHeader className="panel-heading">
            <CardTitle>Ratings and reactions</CardTitle>
            <CardDescription>Quick pulse checks from the audience.</CardDescription>
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

          <div className="insight-block">
            <h3>Top themes</h3>
            <div className="chip-row">
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
          </div>
        </Card>
      </section>
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
