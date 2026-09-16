import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { io, type Socket } from 'socket.io-client'
import {
  Bar,
  BarChart,
  CartesianGrid,
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
import type { EventSnapshot } from '../types.ts'

const views = ['questions', 'word-cloud', 'sentiment', 'polls', 'ratings', 'engagement', 'insights'] as const
type PresenterView = (typeof views)[number]

export function PresenterPage() {
  const { code = '' } = useParams()
  const [snapshot, setSnapshot] = useState<EventSnapshot | null>(null)
  const [view, setView] = useState<PresenterView>('questions')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let socket: Socket | undefined

    api
      .getPresenterEvent(code)
      .then((response) => {
        setSnapshot(response)
        setLoading(false)
        socket = io({
          transports: ['websocket'],
        })
        socket.emit('event:join-public', response.event.id)
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
    if (!snapshot) {
      return []
    }

    return [
      { label: 'Positive', value: snapshot.analytics.sentiment.positive },
      { label: 'Neutral', value: snapshot.analytics.sentiment.neutral },
      { label: 'Negative', value: snapshot.analytics.sentiment.negative },
    ]
  }, [snapshot])

  if (loading) {
    return (
      <main className="presenter-shell">
        <div className="presenter-center">
          <h1>Loading presenter mode...</h1>
        </div>
      </main>
    )
  }

  if (error || !snapshot) {
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
    <main className="presenter-shell">
      <header className="presenter-header">
        <div>
          <Badge variant="info">{snapshot.event.name}</Badge>
          <h1>{snapshot.event.code}</h1>
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

      <section className="presenter-stage">
        {view === 'questions' ? (
          <div className="presenter-question-grid">
            {snapshot.presenterQuestions.slice(0, 6).map((question) => (
              <article key={question.id} className={`presenter-card ${question.highlighted ? 'highlighted' : ''}`}>
                <span>{question.timeLabel}</span>
                <strong>{question.text}</strong>
              </article>
            ))}
            {snapshot.presenterQuestions.length === 0 ? (
              <div className="presenter-center">Approved audience questions will appear here.</div>
            ) : null}
          </div>
        ) : null}

        {view === 'word-cloud' ? (
          <div className="presenter-word-cloud">
            {snapshot.analytics.wordCloud.length > 0 ? (
              snapshot.analytics.wordCloud.map((entry) => (
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
            <h2>Audience sentiment</h2>
            <ResponsiveContainer width="100%" height={420}>
              <BarChart data={sentimentData}>
                <CartesianGrid stroke="#263449" strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke="#e2e8f0" />
                <YAxis stroke="#e2e8f0" />
                <Tooltip />
                <Bar dataKey="value" fill="#34d399" radius={[14, 14, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : null}

        {view === 'polls' ? (
          <div className="presenter-chart">
            <h2>Live poll results</h2>
            {snapshot.pollResults[0] ? (
              <ResponsiveContainer width="100%" height={420}>
                <BarChart data={snapshot.pollResults[0].options}>
                  <CartesianGrid stroke="#263449" strokeDasharray="3 3" />
                  <XAxis dataKey="label" stroke="#e2e8f0" interval={0} angle={-6} height={60} textAnchor="end" />
                  <YAxis stroke="#e2e8f0" allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#38bdf8" radius={[14, 14, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="presenter-center">No polls configured yet.</div>
            )}
          </div>
        ) : null}

        {view === 'ratings' ? (
          <div className="presenter-metric-grid">
            {snapshot.ratingResults.map((rating) => (
              <article key={rating.id} className="presenter-card">
                <span>{rating.prompt}</span>
                <strong>
                  {rating.average}/{rating.scale}
                </strong>
                <p>{rating.responses} responses</p>
              </article>
            ))}
            {snapshot.reactionTotals.map((reaction) => (
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
            <h2>Participation volume</h2>
            <ResponsiveContainer width="100%" height={420}>
              <LineChart data={snapshot.metrics.timeline}>
                <CartesianGrid stroke="#263449" strokeDasharray="3 3" />
                <XAxis dataKey="time" stroke="#e2e8f0" />
                <YAxis stroke="#e2e8f0" />
                <Tooltip />
                <Line type="monotone" dataKey="value" stroke="#fbbf24" strokeWidth={4} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : null}

        {view === 'insights' ? (
          <div className="presenter-insights">
            <article className="presenter-card">
              <span>Top themes</span>
              <strong>{snapshot.analytics.themes.map((theme) => theme.theme).join(', ') || 'Waiting for more responses'}</strong>
            </article>
            <article className="presenter-card">
              <span>Frequent words</span>
              <strong>{snapshot.analytics.keywords.slice(0, 6).map((word) => word.word).join(', ') || 'Not enough data yet'}</strong>
            </article>
            <article className="presenter-card wide">
              <span>Emerging concerns</span>
              <strong>{snapshot.analytics.emergingConcerns.join(' ')}</strong>
            </article>
          </div>
        ) : null}
      </section>
    </main>
  )
}
