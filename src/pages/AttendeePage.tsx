import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { io, type Socket } from 'socket.io-client'
import { Alert } from '../components/ui/Alert.tsx'
import { Badge } from '../components/ui/Badge.tsx'
import { Button } from '../components/ui/Button.tsx'
import { Card } from '../components/ui/Card.tsx'
import { Progress } from '../components/ui/Progress.tsx'
import { Textarea } from '../components/ui/Field.tsx'
import { api } from '../lib/api.ts'
import type { EventPageData, EventSnapshot, InteractionRecord } from '../types.ts'

type SubmissionState = Record<string, string>
type SubmittedState = Record<string, boolean>

function getStoredProgress(code: string) {
  const key = `pulse-room-progress:${code}`
  const raw = localStorage.getItem(key)
  return raw ? Number(raw) || 0 : 0
}

function setStoredProgress(code: string, value: number) {
  localStorage.setItem(`pulse-room-progress:${code}`, String(value))
}

export function AttendeePage() {
  const { code = '' } = useParams()
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
  const progress = progressByCode[code] ?? getStoredProgress(code)

  useEffect(() => {
    let socket: Socket | undefined

    api
      .getEventByCode(code)
      .then((response) => {
        setData(response)
        setSnapshot(response.snapshot)
        setCurrentIndex(0)
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
        setLoadError(pageError instanceof Error ? pageError.message : 'Unable to load event.')
        setLoading(false)
      })

    return () => {
      socket?.disconnect()
    }
  }, [code])

  async function submit(interaction: InteractionRecord, payload: Record<string, unknown>) {
    setStatus('')
    setError('')

    try {
      const response = await api.submitResponse(code, {
        interactionId: interaction.id,
        ...payload,
      })
      setStatus(response.message)
      setSubmittedByInteraction((current) => ({ ...current, [interaction.id]: true }))
      const nextProgress = progress + 1
      setProgressByCode((current) => ({ ...current, [code]: nextProgress }))
      setStoredProgress(code, nextProgress)
      setStreak((current) => current + 1)
      if (data) {
        const currentInteractionIndex = data.interactions.findIndex((item) => item.id === interaction.id)
        if (currentInteractionIndex >= 0) {
          const nextUnansweredIndex = data.interactions.findIndex(
            (item, index) => index > currentInteractionIndex && !submittedByInteraction[item.id] && item.id !== interaction.id,
          )
          if (nextUnansweredIndex >= 0) {
            setCurrentIndex(nextUnansweredIndex)
          } else {
            setCurrentIndex(Math.min(currentInteractionIndex + 1, data.interactions.length - 1))
          }
        }
      }
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Unable to submit response.')
    }
  }

  const completion = useMemo(() => {
    if (!data) {
      return 0
    }
    return Math.min(100, Math.round((progress / Math.max(data.interactions.length, 1)) * 100))
  }, [data, progress])

  const currentInteraction = data?.interactions[currentIndex] ?? null
  const answeredCount = useMemo(
    () => Object.values(submittedByInteraction).filter(Boolean).length,
    [submittedByInteraction],
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

  if (loadError || !data || !snapshot) {
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
    <main className="page attendee-page">
      <section className="attendee-hero">
        <div>
          <span className="eyebrow">Event code {data.event.code}</span>
          <h1>{data.event.name}</h1>
          <p className="lede">{data.event.description}</p>
        </div>
        <div className="progress-card">
          <span>Participation progress</span>
          <strong>{completion}%</strong>
          <Progress value={completion} />
          <p>
            {progress} contributions this session • streak {streak}
          </p>
        </div>
      </section>

      <Card className="attendee-panel">
        <div className="stats-row">
          <div>
            <strong>{snapshot.metrics.totalResponses}</strong>
            <span>Live responses</span>
          </div>
          <div>
            <strong>{snapshot.metrics.reactionCount}</strong>
            <span>Reactions fired</span>
          </div>
          <div>
            <strong>{snapshot.analytics.sentiment.positive}%</strong>
            <span>Positive pulse</span>
          </div>
        </div>
        <p className="muted">{data.privacy.notice}</p>
        {status ? <Alert variant="success">{status}</Alert> : null}
        {error ? <Alert variant="danger">{error}</Alert> : null}
      </Card>

      <section className="prompt-stage">
        <div className="prompt-stage__backdrop" aria-hidden="true" />
        {currentInteraction ? (
          <InteractionCard
            key={currentInteraction.id}
            interaction={currentInteraction}
            step={currentIndex + 1}
            totalSteps={data.interactions.length}
            answered={Boolean(submittedByInteraction[currentInteraction.id])}
            canGoBack={currentIndex > 0}
            canGoNext={currentIndex < data.interactions.length - 1}
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
          <span className="eyebrow">Sequential flow</span>
          <h2>
            {answeredCount} of {data.interactions.length} prompts answered
          </h2>
        </div>
        <div className="prompt-dots" aria-label="Interaction progress">
          {data.interactions.map((interaction, index) => (
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
    </main>
  )
}

function InteractionCard({
  interaction,
  step,
  totalSteps,
  answered,
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
  canGoBack: boolean
  canGoNext: boolean
  onBack: () => void
  onNext: () => void
  value: string
  onChange: (value: string) => void
  onSubmit: (payload: Record<string, unknown>) => void
}) {
  const [selected, setSelected] = useState<string[]>([])

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

  if (interaction.type === 'question' || interaction.type === 'feedback') {
    return (
      <Card className="interaction-card interaction-card--modal">
        <div className="prompt-meta">
          <Badge variant="info">
            Prompt {step} of {totalSteps}
          </Badge>
          {answered ? <Badge variant="success">Answered</Badge> : null}
        </div>
        <span className="eyebrow">{interaction.type === 'question' ? 'Ask anonymously' : 'Share feedback'}</span>
        <h2>{interaction.prompt}</h2>
        <form onSubmit={submitText}>
          <Textarea value={value} onChange={(event) => onChange(event.target.value)} rows={4} maxLength={400} />
          <Button type="submit">Submit {interaction.type}</Button>
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
          {answered ? <Badge variant="success">Answered</Badge> : null}
        </div>
        <span className="eyebrow">Rate the session</span>
        <h2>{interaction.prompt}</h2>
        <div className="choice-grid">
          {Array.from({ length: scale }, (_, index) => index + 1).map((item) => (
            <Button key={item} type="button" variant="secondary" className="choice-pill" onClick={() => onSubmit({ value: item })}>
              {item}
            </Button>
          ))}
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
          {answered ? <Badge variant="success">Answered</Badge> : null}
        </div>
        <span className="eyebrow">Live poll</span>
        <h2>{interaction.prompt}</h2>
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
        {answered ? <Badge variant="success">Answered</Badge> : null}
      </div>
      <span className="eyebrow">React live</span>
      <h2>{interaction.prompt}</h2>
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
