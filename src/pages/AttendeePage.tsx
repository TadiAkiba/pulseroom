import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { ConvexProvider, useQuery } from 'convex/react'
import { Alert } from '../components/ui/Alert.tsx'
import { Badge } from '../components/ui/Badge.tsx'
import { Button } from '../components/ui/Button.tsx'
import { Card } from '../components/ui/Card.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/Dialog.tsx'
import { Textarea } from '../components/ui/Field.tsx'
import { Progress } from '../components/ui/Progress.tsx'
import { Tabs, TabsList, TabsTrigger } from '../components/ui/Tabs.tsx'
import { ProfileSetupCard } from '../components/attendee/ProfileSetupCard.tsx'
import { connectPublicSocket } from '../lib/socketHelpers.ts'
import { api } from '../lib/api.ts'
import { convexQueries, getConvexClient, setConvexRuntimeConfig } from '../lib/convex.ts'
import type { AnonymousAttendeeProfile, EventPageData, EventSnapshot, InteractionRecord, InteractionType } from '../types.ts'

type SubmissionState = Record<string, string>
type SubmittedState = Record<string, boolean>

const milestoneSteps = [1, 3, 5, 8, 12]
const nicknameAdjectives = ['Bright', 'Curious', 'Swift', 'Bold', 'Sharp', 'Calm', 'Clever', 'Signal']
const nicknameNouns = ['Nova', 'Spark', 'Orbit', 'Pulse', 'Beacon', 'Echo', 'Vector', 'Wave']

function getLevel(progress: number) {
  if (progress >= 8) {
    return 'Front-row energy'
  }
  if (progress >= 5) {
    return 'Momentum maker'
  }
  if (progress >= 3) {
    return 'Spark starter'
  }
  if (progress >= 1) {
    return 'Contributor'
  }
  return 'Quiet observer'
}

function getMomentumLabel(totalResponses: number, reactionCount: number) {
  const score = totalResponses + reactionCount * 2
  if (score >= 70) {
    return 'Electric'
  }
  if (score >= 35) {
    return 'Buzzing'
  }
  if (score >= 15) {
    return 'Building'
  }
  return 'Warming up'
}

function getStoredProgress(code: string) {
  const key = `pulse-room-progress:${code}`
  const raw = localStorage.getItem(key)
  return raw ? Number(raw) || 0 : 0
}

function setStoredProgress(code: string, value: number) {
  localStorage.setItem(`pulse-room-progress:${code}`, String(value))
}

function getProfileStorageKey(code: string) {
  return `pulse-room-profile:${code}`
}

function getStoredProfile(code: string) {
  const raw = localStorage.getItem(getProfileStorageKey(code))
  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as AnonymousAttendeeProfile
  } catch {
    return null
  }
}

function setStoredProfile(code: string, profile: AnonymousAttendeeProfile) {
  localStorage.setItem(getProfileStorageKey(code), JSON.stringify(profile))
}

function createAttendeeKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `attendee-${crypto.randomUUID().replaceAll('-', '')}`
  }
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  }
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `attendee-${hex}`
}

function generateNickname() {
  const adjective = nicknameAdjectives[Math.floor(Math.random() * nicknameAdjectives.length)]
  const noun = nicknameNouns[Math.floor(Math.random() * nicknameNouns.length)]
  const suffix = Math.floor(10 + Math.random() * 90)
  return `${adjective}${noun}${suffix}`
}

function getEventTeams(snapshot: EventSnapshot | null) {
  const rawTeams = Array.isArray(snapshot?.event.config.teams) ? snapshot?.event.config.teams : []
  const teams = rawTeams.map(String).map((team) => team.trim()).filter(Boolean)
  return teams.length > 0 ? teams : ['Catalysts', 'Builders', 'Navigators', 'Trailblazers']
}

function getInteractionFormKey(interaction: InteractionRecord) {
  return typeof interaction.settings.formKey === 'string' ? interaction.settings.formKey : interaction.type
}

const QUICK_ACTION_FORM_KEYS: Record<string, string[]> = {
  idea: ['idea', 'feedback'],
  opportunity: ['opportunity', 'poll'],
  concern: ['concern', 'rating'],
}
const QUICK_ACTION_TYPE_FALLBACK: Record<string, InteractionType> = {
  idea: 'feedback',
  opportunity: 'poll',
  concern: 'rating',
}

function getInteractionFormTitle(interaction: InteractionRecord) {
  return typeof interaction.settings.formTitle === 'string'
    ? interaction.settings.formTitle
    : interaction.type === 'feedback'
      ? 'AI Idea'
      : interaction.type === 'poll'
        ? 'AI Opportunity'
        : interaction.type === 'question'
          ? 'Questions'
          : 'AI Townhall'
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

export function AttendeePage() {
  const { code = '' } = useParams()
  const initialProfile = getStoredProfile(code)
  const [convexOverride, setConvexOverride] = useState<EventSnapshot | null | undefined>(undefined)
  const [convexEnabled, setConvexEnabled] = useState(false)
  const [data, setData] = useState<EventPageData | null>(null)
  const [snapshot, setSnapshot] = useState<EventSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [submissions, setSubmissions] = useState<SubmissionState>({})
  const [submittedByInteraction, setSubmittedByInteraction] = useState<SubmittedState>({})
  const [progressByCode, setProgressByCode] = useState<Record<string, number>>({})
  const [streak, setStreak] = useState(0)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [activePanel, setActivePanel] = useState<'townhall' | 'qa'>('townhall')
  const [profile, setProfile] = useState<AnonymousAttendeeProfile | null>(initialProfile)
  const [draftProfile, setDraftProfile] = useState({
    nickname: initialProfile?.nickname ?? generateNickname(),
    team: initialProfile?.team ?? 'Catalysts',
  })
  const convexLoaded = convexOverride !== undefined
  const liveSnapshot = convexLoaded && convexOverride !== null
    ? convexOverride
    : snapshot
  const progress = progressByCode[code] ?? getStoredProgress(code)
  const teams = useMemo(() => getEventTeams(liveSnapshot), [liveSnapshot])
  const townhallInteractions = useMemo(
    () => data?.interactions.filter((interaction) => getInteractionFormKey(interaction) !== 'qa') ?? [],
    [data],
  )
  const qaInteraction = useMemo(
    () => data?.interactions.find((interaction) => getInteractionFormKey(interaction) === 'qa') ?? null,
    [data],
  )
  const activePollInteraction = useMemo(
    () => data?.interactions.find((interaction) => interaction.id === liveSnapshot?.activePoll?.id) ?? null,
    [data, liveSnapshot?.activePoll?.id],
  )

  useEffect(() => {
    let cleanup: (() => void) | undefined

    api
      .getEventByCode(code)
      .then((response) => {
        if (response.convex) {
          setConvexRuntimeConfig(response.convex)
          setConvexEnabled(Boolean(response.convex.enabled))
          setConvexOverride(undefined)
        }
        setData(response)
        setSnapshot(response.snapshot)
        setCurrentIndex(0)
        setLoading(false)
        const nextTeams = getEventTeams(response.snapshot)
        setDraftProfile((current) => ({
          nickname: current.nickname || generateNickname(),
          team: nextTeams.includes(current.team) ? current.team : nextTeams[0] ?? 'Catalysts',
        }))

        const lifecycle = connectPublicSocket(response.event.id, (nextSnapshot: EventSnapshot) =>
          setSnapshot(nextSnapshot),
        )
        cleanup = lifecycle.cleanup
      })
      .catch((pageError) => {
        setLoadError(pageError instanceof Error ? pageError.message : 'Unable to load event.')
        setLoading(false)
      })

    return () => {
      cleanup?.()
    }
  }, [code])

  async function submit(interaction: InteractionRecord, payload: Record<string, unknown>) {
    if (!profile) {
      setError('Pick your anonymous nickname and team before participating.')
      return
    }

    setStatus('')
    setError('')

    try {
      const response = await api.submitResponse(code, {
        interactionId: interaction.id,
        attendee: profile,
        ...payload,
      })
      setStatus(response.message)
      setSubmittedByInteraction((current) => ({ ...current, [interaction.id]: true }))
      const nextProgress = progress + 1
      setProgressByCode((current) => ({ ...current, [code]: nextProgress }))
      setStoredProgress(code, nextProgress)
      setStreak((current) => current + 1)
      if (data) {
        const currentInteractionIndex = townhallInteractions.findIndex((item) => item.id === interaction.id)
        if (currentInteractionIndex >= 0) {
          const nextUnansweredIndex = townhallInteractions.findIndex(
            (item, index) => index > currentInteractionIndex && !submittedByInteraction[item.id] && item.id !== interaction.id,
          )
          if (nextUnansweredIndex >= 0) {
            setCurrentIndex(nextUnansweredIndex)
          } else {
            setCurrentIndex(Math.min(currentInteractionIndex + 1, townhallInteractions.length - 1))
          }
        }
      }
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Unable to submit response.')
    }
  }

  async function voteIdea(responseId: string, direction: 'up' | 'down') {
    if (!profile) {
      setError('Pick your anonymous nickname and team before voting.')
      return
    }

    setError('')
    try {
      await api.voteIdea(code, responseId, {
        direction,
        attendee: profile,
      })
    } catch (voteError) {
      setError(voteError instanceof Error ? voteError.message : 'Unable to record your vote.')
    }
  }

  function saveProfile() {
    const nickname = draftProfile.nickname.trim()
    if (nickname.length < 2) {
      setError('Choose a nickname with at least 2 characters.')
      return
    }
    if (!teams.includes(draftProfile.team)) {
      setError('Choose a valid townhall team.')
      return
    }

    const nextProfile: AnonymousAttendeeProfile = {
      attendeeKey: profile?.attendeeKey ?? createAttendeeKey(),
      nickname,
      team: draftProfile.team,
    }
    setProfile(nextProfile)
    setStoredProfile(code, nextProfile)
    setStatus(`You are in as ${nextProfile.nickname} on ${nextProfile.team}.`)
    setError('')
  }

  async function upvoteQuestion(responseId: string) {
    if (!profile) {
      setError('Pick your anonymous nickname and team before voting.')
      return
    }

    setError('')
    try {
      await api.upvoteQuestion(code, responseId, { attendee: profile })
    } catch (voteError) {
      setError(voteError instanceof Error ? voteError.message : 'Unable to record your vote.')
    }
  }

  const completion = useMemo(() => {
    if (!townhallInteractions.length) {
      return 0
    }
    return Math.min(100, Math.round((progress / Math.max(townhallInteractions.length, 1)) * 100))
  }, [progress, townhallInteractions.length])

  const currentInteraction = townhallInteractions[currentIndex] ?? null
  const answeredCount = useMemo(
    () => townhallInteractions.filter((interaction) => submittedByInteraction[interaction.id]).length,
    [submittedByInteraction, townhallInteractions],
  )
  const level = useMemo(() => getLevel(progress), [progress])
  const nextMilestone = useMemo(
    () => milestoneSteps.find((step) => step > progress) ?? null,
    [progress],
  )
  const unlockedMilestones = useMemo(
    () => milestoneSteps.filter((step) => step <= progress),
    [progress],
  )
  const roomMomentum = useMemo(
    () => getMomentumLabel(liveSnapshot?.metrics.totalResponses ?? 0, liveSnapshot?.metrics.reactionCount ?? 0),
    [liveSnapshot?.metrics.reactionCount, liveSnapshot?.metrics.totalResponses],
  )
  const milestoneMessage = useMemo(() => {
    if (progress === 0) {
      return 'First contribution unlocks your streak.'
    }
    if (nextMilestone) {
      return `${nextMilestone - progress} more to unlock the next milestone.`
    }
    return 'All session milestones unlocked.'
  }, [nextMilestone, progress])

  const completedAllTownhall = townhallInteractions.length > 0 && answeredCount === townhallInteractions.length
  const trophyShownKey = `pulseroom:${code}:completion-trophy-shown`
  const [trophyOpen, setTrophyOpen] = useState(false)
  const trophyDismissedRef = useRef(false)
  useEffect(() => {
    if (!completedAllTownhall || trophyDismissedRef.current) return
    const alreadyShown = typeof window !== 'undefined' && window.localStorage.getItem(trophyShownKey) === '1'
    if (alreadyShown) {
      trophyDismissedRef.current = true
      return
    }
    const id = window.setTimeout(() => {
      if (trophyDismissedRef.current) return
      setTrophyOpen(true)
    }, 650)
    return () => window.clearTimeout(id)
  }, [completedAllTownhall, trophyShownKey])

  function dismissTrophy() {
    trophyDismissedRef.current = true
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(trophyShownKey, '1')
      } catch {
        // Storage unavailable — ignore
      }
    }
    setTrophyOpen(false)
  }

  const totalEarnedPoints = useMemo(() => {
    let earned = 0
    for (const interaction of townhallInteractions) {
      if (submittedByInteraction[interaction.id]) {
        earned += Number(interaction.settings.points ?? 0) || 0
      }
    }
    return earned
  }, [submittedByInteraction, townhallInteractions])

  const quickActions = useMemo(
    () => [
      { key: 'idea', label: 'AI Idea', copy: 'Share your idea and the value it could unlock.' },
      { key: 'opportunity', label: 'AI Opportunity', copy: 'Spot where AI could solve a repeated business problem.' },
      { key: 'concern', label: 'AI Concern', copy: 'Capture what feels risky and what would build trust.' },
    ],
    [],
  )

  if (loading) {
    return (
      <main className="page center-state">
        <Card className="ui-state-card">
          <h1>Joining event...</h1>
          <p>Loading live interactions and the latest room activity.</p>
        </Card>
      </main>
    )
  }

  if (loadError || !data || !liveSnapshot) {
    return (
      <main className="page center-state">
        <Card className="ui-state-card">
          <h1>We could not open this event.</h1>
          <p>{loadError || 'The event may be inactive or the code may be incorrect.'}</p>
        </Card>
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
      <main className="page attendee-page">
      <section className="attendee-hero">
        <div>
          <span className="eyebrow">AI Townhall Dashboard • code {data.event.code}</span>
          <h1>{data.event.name}</h1>
          <p className="lede">{data.event.description}</p>
          {profile ? (
            <div className="achievement-row">
              <Badge variant="success">{profile.nickname}</Badge>
              <Badge variant="info">{profile.team}</Badge>
              <Badge variant="outline">{level}</Badge>
            </div>
          ) : null}
        </div>
        <div className="progress-card">
          <span>Participation progress</span>
          <strong>{completion}%</strong>
          <Progress value={completion} />
          <p>
            {progress} contributions this session • streak {streak}
          </p>
          <div className="achievement-row">
            <Badge variant="success">{level}</Badge>
            {streak > 1 ? <Badge variant="warning">Streak x{streak}</Badge> : null}
          </div>
        </div>
      </section>

      {!profile ? (
        <ProfileSetupCard
          draft={draftProfile}
          teams={teams}
          onChange={setDraftProfile}
          onSave={saveProfile}
        />
      ) : null}

      <Card className="attendee-panel">
        <div className="stats-row">
          <div>
            <strong>{liveSnapshot.metrics.totalResponses}</strong>
            <span>Live responses</span>
          </div>
          <div>
            <strong>{liveSnapshot.metrics.uniqueParticipants}</strong>
            <span>Anonymous participants</span>
          </div>
          <div>
            <strong>{liveSnapshot.analytics.sentiment.positive}%</strong>
            <span>Positive pulse</span>
          </div>
        </div>
        <div className="achievement-grid">
          <div className="achievement-card">
            <span>Session level</span>
            <strong>{level}</strong>
            <p>{milestoneMessage}</p>
          </div>
          <div className="achievement-card">
            <span>Next unlock</span>
            <strong>{nextMilestone ? `${nextMilestone} contributions` : 'Complete'}</strong>
            <p>
              {nextMilestone
                ? `Keep the streak alive to hit the next audience milestone.`
                : 'You have reached every session milestone.'}
            </p>
          </div>
          <div className="achievement-card">
            <span>Room momentum</span>
            <strong>{roomMomentum}</strong>
            <p>The crowd energy rises as ideas, votes, and reactions come in.</p>
          </div>
        </div>
        {unlockedMilestones.length > 0 ? (
          <div className="achievement-row">
            {unlockedMilestones.map((milestone) => (
              <Badge key={milestone} variant="outline">
                {milestone} unlocked
              </Badge>
            ))}
          </div>
        ) : null}
        <p className="muted">{data.privacy.notice}</p>
        {status ? (
          <Alert variant="success" className="celebration-alert" title="Contribution landed">
            {status}
          </Alert>
        ) : null}
        {error ? <Alert variant="danger">{error}</Alert> : null}
      </Card>

      {profile && liveSnapshot.activePoll && activePollInteraction ? (
        <ActivePollCard
          poll={liveSnapshot.activePoll}
          interaction={activePollInteraction}
          onSubmit={(payload) => submit(activePollInteraction, payload)}
        />
      ) : null}

      {profile ? (
        <>
          <Tabs className="attendee-section-tabs">
            <TabsList>
              <TabsTrigger active={activePanel === 'townhall'} onClick={() => setActivePanel('townhall')}>
                Townhall
              </TabsTrigger>
              <TabsTrigger active={activePanel === 'qa'} onClick={() => setActivePanel('qa')}>
                Ask the Room
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {activePanel === 'townhall' ? (
            <>
          <section className="townhall-actions">
            {quickActions.map((action) => {
              const acceptedFormKeys = QUICK_ACTION_FORM_KEYS[action.key] ?? [action.key]
              const fallbackType = QUICK_ACTION_TYPE_FALLBACK[action.key]
              const candidates = townhallInteractions
                .map((interaction, index) => ({ interaction, index }))
                .filter(({ interaction }) => {
                  const formKey = getInteractionFormKey(interaction)
                  if (acceptedFormKeys.includes(formKey)) return true
                  if (fallbackType && interaction.type === fallbackType) return true
                  return false
                })
              const nextUnanswered = candidates.find(
                ({ interaction }) => !submittedByInteraction[interaction.id],
              )
              const candidate = nextUnanswered ?? candidates[0]
              const interactionIndex = candidate?.index ?? -1
              return (
                <Card key={action.key} className="townhall-card">
                  <span className="eyebrow">{action.label}</span>
                  <h3>{action.copy}</h3>
                  {interactionIndex < 0 ? (
                    <p className="muted" style={{ fontSize: '0.9rem', marginTop: '-0.1rem', marginBottom: '0.6rem' }}>
                      Organizer hasn’t added this prompt yet. Once created in the dashboard Compose tab, it’ll open here.
                    </p>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    disabled={interactionIndex < 0}
                    onClick={() => {
                      setStatus('')
                      setError('')
                      if (interactionIndex >= 0) {
                        setCurrentIndex(interactionIndex)
                      }
                    }}
                  >
                    Open {action.label}
                  </Button>
                </Card>
              )
            })}
          </section>

          <section className="townhall-grid">
            <div className="townhall-grid__main">
              <section className="prompt-stage">
                <div className="prompt-stage__backdrop" aria-hidden="true" />
                {currentInteraction ? (
                  <InteractionCard
                    key={currentInteraction.id}
                    interaction={currentInteraction}
                    step={currentIndex + 1}
                    totalSteps={townhallInteractions.length}
                    answered={Boolean(submittedByInteraction[currentInteraction.id])}
                    streak={streak}
                    nextMilestone={nextMilestone}
                    canGoBack={currentIndex > 0}
                    canGoNext={currentIndex < townhallInteractions.length - 1}
                    onBack={() => {
                      setStatus('')
                      setError('')
                      setCurrentIndex((current) => Math.max(0, current - 1))
                    }}
                    onNext={() => {
                      setStatus('')
                      setError('')
                      setCurrentIndex((current) => Math.min(data.interactions.length - 1, current + 1))
                    }}
                    value={submissions[currentInteraction.id] ?? ''}
                    onChange={(value) =>
                      setSubmissions((current) => ({
                        ...current,
                        [currentInteraction.id]: value,
                      }))
                    }
                    onSubmit={(payload) => submit(currentInteraction, payload)}
                  />
                ) : null}
              </section>

              <section className="prompt-queue">
                <div>
                  <span className="eyebrow">Townhall flow</span>
                  <h2>
                    {answeredCount} of {townhallInteractions.length} prompts answered
                  </h2>
                </div>
                <div className="prompt-dots" aria-label="Interaction progress">
                  {townhallInteractions.map((interaction, index) => (
                    <button
                      key={interaction.id}
                      type="button"
                      className={`prompt-dot ${index === currentIndex ? 'active' : ''} ${submittedByInteraction[interaction.id] ? 'answered' : ''}`}
                      onClick={() => {
                        setStatus('')
                        setError('')
                        setCurrentIndex(index)
                      }}
                      aria-label={`Open prompt ${index + 1}`}
                    />
                  ))}
                </div>
              </section>
            </div>

            <div className="townhall-grid__side">
              <Card className="townhall-card">
                <span className="eyebrow">Live sentiment & feed</span>
                <h3>Ideas, fears, and opportunities</h3>
                <div className="idea-feed">
                  {liveSnapshot.ideaFeed.map((idea) => (
                    <article key={idea.id} className="idea-card">
                      <div className="achievement-row">
                        <Badge variant="info">{idea.team}</Badge>
                        <Badge variant="outline">{idea.nickname}</Badge>
                        <Badge variant={idea.sentiment === 'positive' ? 'success' : idea.sentiment === 'negative' ? 'danger' : 'warning'}>
                          {idea.sentiment}
                        </Badge>
                      </div>
                      <strong>{idea.text}</strong>
                      <p className="muted">{idea.timeLabel}</p>
                      <div className="vote-row">
                        <span>Score {idea.votes.score}</span>
                        <div className="achievement-row">
                          <Button type="button" size="sm" variant="outline" onClick={() => voteIdea(idea.id, 'up')}>
                            ▲ {idea.votes.up}
                          </Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => voteIdea(idea.id, 'down')}>
                            ▼ {idea.votes.down}
                          </Button>
                        </div>
                      </div>
                    </article>
                  ))}
                  {liveSnapshot.ideaFeed.length === 0 ? <p className="muted">Ideas will appear here as the room starts sharing.</p> : null}
                </div>
              </Card>

              <Card className="townhall-card">
                <span className="eyebrow">Team leaderboard</span>
                <h3>AI Champions</h3>
                <div className="leaderboard-list">
                  {liveSnapshot.teamLeaderboard.map((entry, index) => (
                    <article key={entry.team} className="leaderboard-row">
                      <div>
                        <strong>
                          #{index + 1} {entry.team}
                        </strong>
                        <p>
                          {entry.contributors} contributors • {entry.contributions} actions • {entry.votesReceived} upvotes earned
                        </p>
                      </div>
                      <Badge variant={index === 0 ? 'success' : 'outline'}>{entry.points} pts</Badge>
                    </article>
                  ))}
                </div>
              </Card>
            </div>
          </section>
            </>
          ) : null}

          {activePanel === 'qa' && qaInteraction ? (
            <section className="townhall-grid">
              <div className="townhall-grid__main">
                <QuestionComposer
                  interaction={qaInteraction}
                  value={submissions[qaInteraction.id] ?? ''}
                  onChange={(value) =>
                    setSubmissions((current) => ({
                      ...current,
                      [qaInteraction.id]: value,
                    }))
                  }
                  onSubmit={(payload) => submit(qaInteraction, payload)}
                  answered={Boolean(submittedByInteraction[qaInteraction.id])}
                />
              </div>

              <div className="townhall-grid__side">
                <Card className="townhall-card">
                  <span className="eyebrow">Top Q&A</span>
                  <h3>Questions the room wants answered</h3>
                  <div className="question-board">
                    {liveSnapshot.questionStream.map((question) => (
                      <article key={question.id} className="question-board__item">
                        <div>
                          <strong>{question.text}</strong>
                          <p className="muted">{question.timeLabel}</p>
                        </div>
                        <div className="question-board__actions">
                          <Badge variant={question.highlighted ? 'warning' : 'outline'}>▲ {question.votes.up}</Badge>
                          <Button type="button" size="sm" variant="outline" onClick={() => upvoteQuestion(question.id)}>
                            Upvote
                          </Button>
                        </div>
                      </article>
                    ))}
                    {liveSnapshot.questionStream.length === 0 ? (
                      <p className="muted">Questions will appear here once the room starts asking.</p>
                    ) : null}
                  </div>
                </Card>
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </main>

      <Dialog open={trophyOpen} onClose={dismissTrophy} role="alertdialog" aria-label="Session completed.">
        <DialogHeader>
          <div className="trophy-emblem" aria-hidden>🏆</div>
          <DialogTitle>Sentiment round complete</DialogTitle>
          <DialogDescription>
            You've answered every prompt in the session. Your anonymous responses are now part of the live room
            sentiment feed.
          </DialogDescription>
        </DialogHeader>
        <DialogContent>
          <div className="completion-stats">
            <div className="completion-stats__cell">
              <div className="completion-stats__eyebrow">Prompts</div>
              <div className="completion-stats__value">
                {answeredCount}/{townhallInteractions.length}
              </div>
            </div>
            <div className="completion-stats__cell">
              <div className="completion-stats__eyebrow">Points earned</div>
              <div className="completion-stats__value">{totalEarnedPoints}</div>
            </div>
            <div className="completion-stats__cell">
              <div className="completion-stats__eyebrow">Current streak</div>
              <div className="completion-stats__value">×{streak}</div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
            <Badge variant="outline">Level · {level}</Badge>
            <Badge variant="outline">{answeredCount === townhallInteractions.length ? 'All prompts complete' : 'Continue answering'}</Badge>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={dismissTrophy}>
            Back to the room
          </Button>
          <Button type="button" onClick={dismissTrophy}>
            Continue exploring
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  )
}

function ActivePollCard({
  poll,
  interaction,
  onSubmit,
}: {
  poll: NonNullable<EventSnapshot['activePoll']>
  interaction: InteractionRecord
  onSubmit: (payload: Record<string, unknown>) => void
}) {
  const [selected, setSelected] = useState<string[]>([])

  function toggleOption(option: string) {
    setSelected((current) => {
      if (poll.allowMultiple) {
        return current.includes(option) ? current.filter((item) => item !== option) : [...current, option]
      }
      return [option]
    })
  }

  return (
    <Card className="townhall-card active-poll-card">
      <div className="stack-list">
        <div>
          <span className="eyebrow">Live Poll</span>
          <h2>{poll.prompt}</h2>
          <p className="muted">Launched by the facilitator. Results update instantly on the public dashboard.</p>
        </div>
        <Badge variant="success">{poll.totalVotes} votes</Badge>
      </div>
      <div className="choice-grid">
        {interaction.options.map((option) => (
          <Button
            key={option}
            type="button"
            variant={selected.includes(option) ? 'default' : 'secondary'}
            className={`choice-pill ${selected.includes(option) ? 'selected' : ''}`}
            onClick={() => toggleOption(option)}
          >
            {option}
          </Button>
        ))}
      </div>
      <Button
        type="button"
        disabled={selected.length === 0}
        onClick={() => {
          onSubmit({ selections: selected })
          setSelected([])
        }}
      >
        Submit live poll vote
      </Button>
    </Card>
  )
}

function QuestionComposer({
  interaction,
  value,
  onChange,
  onSubmit,
  answered,
}: {
  interaction: InteractionRecord
  value: string
  onChange: (value: string) => void
  onSubmit: (payload: Record<string, unknown>) => void
  answered: boolean
}) {
  const formDescription = typeof interaction.settings.formDescription === 'string' ? interaction.settings.formDescription : ''

  function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!value.trim()) {
      return
    }
    onSubmit({ text: value.trim() })
    onChange('')
  }

  return (
    <Card className="interaction-card interaction-card--modal">
      <div className="prompt-meta">
        <Badge variant="info">Separate Q&amp;A</Badge>
        <div className="achievement-row">{answered ? <Badge variant="success">Asked</Badge> : null}</div>
      </div>
      <span className="eyebrow">Ask the Room</span>
      <h2>{interaction.prompt}</h2>
      {formDescription ? <p className="muted">{formDescription}</p> : null}
      <p className="prompt-helper">Ask anonymously. The room can upvote the questions they most want answered live.</p>
      <form onSubmit={submitQuestion}>
        <Textarea value={value} onChange={(event) => onChange(event.target.value)} rows={4} maxLength={400} />
        <Button type="submit">Ask anonymously</Button>
      </form>
    </Card>
  )
}

function InteractionCard({
  interaction,
  step,
  totalSteps,
  answered,
  streak,
  nextMilestone,
  canGoBack,
  canGoNext,
  onBack,
  onNext,
  value,
  onChange,
  onSubmit,
}: {
  interaction: InteractionRecord
  step: number
  totalSteps: number
  answered: boolean
  streak: number
  nextMilestone: number | null
  canGoBack: boolean
  canGoNext: boolean
  onBack: () => void
  onNext: () => void
  value: string
  onChange: (value: string) => void
  onSubmit: (payload: Record<string, unknown>) => void
}) {
  const [selected, setSelected] = useState<string[]>([])
  const formTitle = getInteractionFormTitle(interaction)
  const formDescription = typeof interaction.settings.formDescription === 'string' ? interaction.settings.formDescription : ''
  const helperText = typeof interaction.settings.helperText === 'string' ? interaction.settings.helperText : ''
  const questionNumber = Number(interaction.settings.questionNumber)
  const questionCount = Number(interaction.settings.questionCount)
  const points = Number(interaction.settings.points)

  function renderNavigation() {
    return (
      <div className="prompt-actions">
        <Button type="button" variant="outline" onClick={onBack} disabled={!canGoBack}>
          Previous
        </Button>
        <Button type="button" variant="ghost" onClick={onNext} disabled={!canGoNext}>
          Next prompt
        </Button>
      </div>
    )
  }

  function submitText(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!value.trim()) {
      return
    }
    onSubmit({ text: value.trim() })
    onChange('')
  }

  const eyebrow =
    Number.isFinite(questionNumber) && Number.isFinite(questionCount)
      ? `${formTitle} · Question ${questionNumber} of ${questionCount}`
      : formTitle

  if (interaction.type === 'question' || interaction.type === 'feedback') {
    return (
      <Card className="interaction-card interaction-card--modal">
        <div className="prompt-meta">
          <Badge variant="info">
            Prompt {step} of {totalSteps}
          </Badge>
          <div className="achievement-row">
            {answered ? <Badge variant="success">Answered</Badge> : null}
            {streak > 1 ? <Badge variant="warning">Streak x{streak}</Badge> : null}
          </div>
        </div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{interaction.prompt}</h2>
        {formDescription ? <p className="muted">{formDescription}</p> : null}
        <p className="prompt-helper">
          {helperText || (nextMilestone ? `Answer this to get closer to the ${nextMilestone}-contribution unlock.` : 'You have already unlocked every session milestone.')}
        </p>
        <form onSubmit={submitText}>
          <Textarea value={value} onChange={(event) => onChange(event.target.value)} rows={4} maxLength={400} />
          <Button type="submit">{points === 10 ? 'Submit and earn 10 points' : 'Submit'}</Button>
        </form>
        {renderNavigation()}
      </Card>
    )
  }

  if (interaction.type === 'rating') {
    const scale = Number(interaction.settings.scale ?? 5)
    return (
      <Card className="interaction-card interaction-card--modal">
        <div className="prompt-meta">
          <Badge variant="info">
            Prompt {step} of {totalSteps}
          </Badge>
          <div className="achievement-row">
            {answered ? <Badge variant="success">Answered</Badge> : null}
            {streak > 1 ? <Badge variant="warning">Streak x{streak}</Badge> : null}
          </div>
        </div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{interaction.prompt}</h2>
        {formDescription ? <p className="muted">{formDescription}</p> : null}
        <p className="prompt-helper">
          {helperText || (nextMilestone ? `Quick ratings help unlock the ${nextMilestone}-contribution milestone.` : 'Every session milestone is already unlocked.')}
        </p>
        <div className="choice-grid">
          {Array.from({ length: scale }, (_, index) => index + 1).map((item) => {
            const labels = Array.isArray(interaction.settings.labels) ? interaction.settings.labels.map(String) : []
            const label = labels[item - 1]
            return (
              <Button key={item} type="button" variant="secondary" className="choice-pill" onClick={() => onSubmit({ value: item })}>
                {label ? `${item}. ${label}` : item}
              </Button>
            )
          })}
        </div>
        {renderNavigation()}
      </Card>
    )
  }

  if (interaction.type === 'poll') {
    const allowMultiple = Boolean(interaction.settings.allowMultiple)

    function toggleOption(option: string) {
      setSelected((current) => {
        if (allowMultiple) {
          return current.includes(option) ? current.filter((item) => item !== option) : [...current, option]
        }
        return [option]
      })
    }

    return (
      <Card className="interaction-card interaction-card--modal">
        <div className="prompt-meta">
          <Badge variant="info">
            Prompt {step} of {totalSteps}
          </Badge>
          <div className="achievement-row">
            {answered ? <Badge variant="success">Answered</Badge> : null}
            {streak > 1 ? <Badge variant="warning">Streak x{streak}</Badge> : null}
          </div>
        </div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{interaction.prompt}</h2>
        {formDescription ? <p className="muted">{formDescription}</p> : null}
        <p className="prompt-helper">
          {helperText || (nextMilestone ? `Cast your vote to move toward the ${nextMilestone}-contribution unlock.` : 'Your milestone track is already complete.')}
        </p>
        <div className="choice-grid">
          {interaction.options.map((option) => (
            <Button
              key={option}
              type="button"
              variant={selected.includes(option) ? 'default' : 'secondary'}
              className={`choice-pill ${selected.includes(option) ? 'selected' : ''}`}
              onClick={() => toggleOption(option)}
            >
              {option}
            </Button>
          ))}
        </div>
        <Button
          type="button"
          disabled={selected.length === 0}
          onClick={() => {
            onSubmit({ selections: selected })
            setSelected([])
          }}
        >
          Submit vote
        </Button>
        {renderNavigation()}
      </Card>
    )
  }

  return (
    <Card className="interaction-card interaction-card--modal">
      <div className="prompt-meta">
        <Badge variant="info">
          Prompt {step} of {totalSteps}
        </Badge>
        <div className="achievement-row">
          {answered ? <Badge variant="success">Answered</Badge> : null}
          {streak > 1 ? <Badge variant="warning">Streak x{streak}</Badge> : null}
        </div>
      </div>
      <span className="eyebrow">{eyebrow}</span>
      <h2>{interaction.prompt}</h2>
      {formDescription ? <p className="muted">{formDescription}</p> : null}
      <p className="prompt-helper">
        {helperText || (nextMilestone ? `Fire a reaction to push toward the ${nextMilestone}-contribution unlock.` : 'You have already cleared the milestone track.')}
      </p>
      <div className="reaction-grid">
        {interaction.options.map((option) => (
          <Button key={option} type="button" variant="secondary" className="reaction-button" onClick={() => onSubmit({ value: option })}>
            {option}
          </Button>
        ))}
      </div>
      {renderNavigation()}
    </Card>
  )
}
