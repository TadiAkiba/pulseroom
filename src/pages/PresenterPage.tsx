import { useEffect, useMemo, useState } from 'react'
import { ConvexProvider, useQuery } from 'convex/react'
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
import { convexQueries, getConvexClient, setConvexRuntimeConfig } from '../lib/convex.ts'
import { socketUrl } from '../lib/realtime.ts'
import type { EventSnapshot } from '../types.ts'

const views = ['questions', 'ideas', 'leaderboard', 'word-cloud', 'sentiment', 'polls', 'ratings', 'engagement', 'insights'] as const
type PresenterView = (typeof views)[number]
const presenterMilestones = [10, 25, 50, 100, 200]

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
      { label: 'Positive', value: liveSnapshot.analytics.sentiment.positive },
      { label: 'Neutral', value: liveSnapshot.analytics.sentiment.neutral },
      { label: 'Negative', value: liveSnapshot.analytics.sentiment.negative },
    ]
  }, [liveSnapshot])

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
            {liveSnapshot.presenterQuestions.slice(0, 6).map((question) => (
              <article key={question.id} className={`presenter-card ${question.highlighted ? 'highlighted' : ''}`}>
                <span>
                  {question.timeLabel} • ▲ {question.votes.up}
                </span>
                <strong>{question.text}</strong>
              </article>
            ))}
            {liveSnapshot.presenterQuestions.length === 0 ? (
              <div className="presenter-center">Approved audience questions will appear here.</div>
            ) : null}
          </div>
        ) : null}

        {view === 'ideas' ? (
          <div className="presenter-question-grid">
            {liveSnapshot.ideaFeed.slice(0, 6).map((idea) => (
              <article key={idea.id} className="presenter-card presenter-card--gamified">
                <span>
                  {idea.team} • {idea.nickname}
                </span>
                <strong>{idea.text}</strong>
                <p>
                  Score {idea.votes.score} • {idea.sentiment}
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
            <h2>{liveSnapshot.activePoll ? 'Live poll results' : 'Facilitator poll queue'}</h2>
            {liveSnapshot.activePoll ? (
              <>
                <p className="presenter-support-copy">{liveSnapshot.activePoll.prompt}</p>
              <ResponsiveContainer width="100%" height={420}>
                  <BarChart data={liveSnapshot.activePoll.options}>
                  <CartesianGrid stroke="#263449" strokeDasharray="3 3" />
                  <XAxis dataKey="label" stroke="#e2e8f0" interval={0} angle={-6} height={60} textAnchor="end" />
                  <YAxis stroke="#e2e8f0" allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#38bdf8" radius={[14, 14, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              </>
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
            <h2>Participation volume</h2>
            <p className="presenter-support-copy">
              Total room activity: <strong>{totalEngagement}</strong> • next milestone:{' '}
              <strong>{nextMilestone ?? 'complete'}</strong>
            </p>
            <ResponsiveContainer width="100%" height={420}>
              <LineChart data={liveSnapshot.metrics.timeline}>
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
