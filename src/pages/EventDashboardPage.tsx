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
import { api } from '../lib/api.ts'
import type { EventSnapshot } from '../types.ts'

const sentimentColors = ['#34d399', '#a78bfa', '#fb7185']

export function EventDashboardPage() {
  const { eventId = '' } = useParams()
  const [snapshot, setSnapshot] = useState<EventSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
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
        socket = io({
          transports: ['websocket'],
        })
        socket.emit('event:join', response.event.id)
        socket.on('event:update', (payload: { admin: EventSnapshot }) => {
          setSnapshot(payload.admin)
        })
      })
      .catch((pageError) => {
        setError(pageError instanceof Error ? pageError.message : 'Unable to load event dashboard.')
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
      await api.updateEvent(snapshot.event.id, {
        status: snapshot.event.status === 'active' ? 'inactive' : 'active',
      })
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Unable to update event.')
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
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Unable to create interaction.')
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
        <div className="panel">
          <h1>Loading event dashboard...</h1>
          <p>Bringing in the latest audience activity.</p>
        </div>
      </main>
    )
  }

  if (error || !snapshot) {
    return (
      <main className="page center-state">
        <div className="panel">
          <h1>Unable to open this event.</h1>
          <p>{error || 'Please check your organizer session and try again.'}</p>
        </div>
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
          <Link className="ghost-button" to={`/event/${snapshot.event.code}`}>
            Attendee view
          </Link>
          <Link className="ghost-button" to={`/present/${snapshot.event.code}`}>
            Presenter mode
          </Link>
          <button type="button" onClick={toggleEventStatus} disabled={saving}>
            {snapshot.event.status === 'active' ? 'Deactivate' : 'Activate'}
          </button>
        </div>
      </section>

      {snapshot.analytics.pendingAnalyses > 0 ? (
        <div className="flash">
          AI analysis is catching up on {snapshot.analytics.pendingAnalyses} recent text responses.
        </div>
      ) : null}

      <section className="metric-grid">
        <MetricCard label="Total responses" value={snapshot.metrics.totalResponses} />
        <MetricCard label="Questions submitted" value={snapshot.metrics.questionCount} />
        <MetricCard label="Poll participation" value={`${snapshot.metrics.pollParticipation}%`} />
        <MetricCard label="Average rating" value={`${snapshot.metrics.averageRating}/5`} />
        <MetricCard label="Reactions" value={snapshot.metrics.reactionCount} />
        <MetricCard label="Positive sentiment" value={`${snapshot.analytics.sentiment.positive}%`} accent />
      </section>

      <section className="dashboard-two-col">
        <article className="panel chart-panel">
          <div className="panel-heading">
            <h2>Engagement over time</h2>
            <p>Automatic live updates with no refresh required.</p>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={snapshot.metrics.timeline}>
              <CartesianGrid stroke="#243147" strokeDasharray="3 3" />
              <XAxis dataKey="time" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" allowDecimals={false} />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke="#7c3aed" strokeWidth={3} />
            </LineChart>
          </ResponsiveContainer>
        </article>

        <article className="panel chart-panel">
          <div className="panel-heading">
            <h2>Sentiment distribution</h2>
            <p>Automated text analysis, presented as directional signal.</p>
          </div>
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
        </article>
      </section>

      <section className="dashboard-three-col">
        <article className="panel">
          <div className="panel-heading">
            <h2>Live question stream</h2>
            <p>Moderator controls apply to presenter mode immediately.</p>
          </div>
          <div className="question-list">
            {snapshot.questionStream.map((question) => (
              <div key={question.id} className={`question-item ${question.highlighted ? 'highlighted' : ''}`}>
                <div>
                  <strong>{question.text}</strong>
                  <p>
                    {question.timeLabel} • {question.moderationState}
                  </p>
                </div>
                <div className="question-actions">
                  <button type="button" onClick={() => moderate(question.id, 'visible', question.highlighted)}>
                    Show
                  </button>
                  <button type="button" onClick={() => moderate(question.id, 'hidden', false)}>
                    Hide
                  </button>
                  <button type="button" onClick={() => moderate(question.id, 'answered', false)}>
                    Answered
                  </button>
                  <button type="button" onClick={() => moderate(question.id, question.moderationState, !question.highlighted)}>
                    {question.highlighted ? 'Unhighlight' : 'Highlight'}
                  </button>
                  <button type="button" onClick={() => moderate(question.id, 'deleted', false)}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
            {snapshot.questionStream.length === 0 ? <p className="muted">Questions will appear here as they arrive.</p> : null}
          </div>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <h2>Word cloud</h2>
            <p>Meaningful terms only, scaled by frequency.</p>
          </div>
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
        </article>

        <article className="panel">
          <div className="panel-heading">
            <h2>Create interaction</h2>
            <p>Add new audience prompts without leaving the dashboard.</p>
          </div>
          <form className="stack-form" onSubmit={createInteraction}>
            <select
              value={interactionForm.type}
              onChange={(event) => setInteractionForm((current) => ({ ...current, type: event.target.value }))}
            >
              <option value="question">Question</option>
              <option value="feedback">Feedback</option>
              <option value="rating">Rating</option>
              <option value="poll">Poll</option>
              <option value="reaction">Reaction</option>
            </select>
            <textarea
              rows={3}
              value={interactionForm.prompt}
              onChange={(event) => setInteractionForm((current) => ({ ...current, prompt: event.target.value }))}
              placeholder="Ask your audience something useful"
            />
            {interactionForm.type === 'poll' || interactionForm.type === 'reaction' ? (
              <textarea
                rows={3}
                value={interactionForm.options}
                onChange={(event) => setInteractionForm((current) => ({ ...current, options: event.target.value }))}
                placeholder="Comma-separated options"
              />
            ) : null}
            <button type="submit" disabled={saving}>
              Add interaction
            </button>
          </form>
        </article>
      </section>

      <section className="dashboard-two-col">
        <article className="panel chart-panel">
          <div className="panel-heading">
            <h2>Poll results</h2>
            <p>Live vote totals update as attendees submit.</p>
          </div>
          {snapshot.pollResults.map((poll) => (
            <div key={poll.id} className="poll-block">
              <strong>{poll.prompt}</strong>
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
        </article>

        <article className="panel">
          <div className="panel-heading">
            <h2>Ratings and reactions</h2>
            <p>Quick pulse checks from the audience.</p>
          </div>
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
                snapshot.analytics.themes.map((theme) => <span key={theme.theme} className="chip">{theme.theme}</span>)
              ) : (
                <p className="muted">Not enough text responses yet to identify dominant themes.</p>
              )}
            </div>
          </div>
        </article>
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
