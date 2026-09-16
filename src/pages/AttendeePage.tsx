import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { io, type Socket } from 'socket.io-client'
import { api } from '../lib/api.ts'
import type { EventPageData, EventSnapshot, InteractionRecord } from '../types.ts'

type SubmissionState = Record<string, string>

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
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [submissions, setSubmissions] = useState<SubmissionState>({})
  const [progressByCode, setProgressByCode] = useState<Record<string, number>>({})
  const [streak, setStreak] = useState(0)
  const progress = progressByCode[code] ?? getStoredProgress(code)

  useEffect(() => {
    let socket: Socket | undefined

    api
      .getEventByCode(code)
      .then((response) => {
        setData(response)
        setSnapshot(response.snapshot)
        setLoading(false)

        socket = io({
          transports: ['websocket'],
        })
        socket.emit('event:join', response.event.id)
        socket.on('event:update', (payload: { publicView: EventSnapshot }) => {
          setSnapshot(payload.publicView)
        })
      })
      .catch((pageError) => {
        setError(pageError instanceof Error ? pageError.message : 'Unable to load event.')
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
      const nextProgress = progress + 1
      setProgressByCode((current) => ({ ...current, [code]: nextProgress }))
      setStoredProgress(code, nextProgress)
      setStreak((current) => current + 1)
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

  if (loading) {
    return (
      <main className="page center-state">
        <div className="panel">
          <h1>Joining event...</h1>
          <p>Loading live interactions and the latest room activity.</p>
        </div>
      </main>
    )
  }

  if (error || !data || !snapshot) {
    return (
      <main className="page center-state">
        <div className="panel">
          <h1>We could not open this event.</h1>
          <p>{error || 'The event may be inactive or the code may be incorrect.'}</p>
        </div>
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
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${completion}%` }} />
          </div>
          <p>
            {progress} contributions this session • streak {streak}
          </p>
        </div>
      </section>

      <section className="panel attendee-panel">
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
        {status ? <div className="flash success">{status}</div> : null}
        {error ? <div className="flash error">{error}</div> : null}
      </section>

      <section className="interaction-stack">
        {data.interactions.map((interaction) => (
          <InteractionCard
            key={interaction.id}
            interaction={interaction}
            value={submissions[interaction.id] ?? ''}
            onChange={(value) =>
              setSubmissions((current) => ({
                ...current,
                [interaction.id]: value,
              }))
            }
            onSubmit={(payload) => submit(interaction, payload)}
          />
        ))}
      </section>
    </main>
  )
}

function InteractionCard({
  interaction,
  value,
  onChange,
  onSubmit,
}: {
  interaction: InteractionRecord
  value: string
  onChange: (value: string) => void
  onSubmit: (payload: Record<string, unknown>) => void
}) {
  const [selected, setSelected] = useState<string[]>([])

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
      <article className="panel interaction-card">
        <span className="eyebrow">{interaction.type === 'question' ? 'Ask anonymously' : 'Share feedback'}</span>
        <h2>{interaction.prompt}</h2>
        <form onSubmit={submitText}>
          <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={4} maxLength={400} />
          <button type="submit">Submit {interaction.type}</button>
        </form>
      </article>
    )
  }

  if (interaction.type === 'rating') {
    const scale = Number(interaction.settings.scale ?? 5)
    return (
      <article className="panel interaction-card">
        <span className="eyebrow">Rate the session</span>
        <h2>{interaction.prompt}</h2>
        <div className="choice-grid">
          {Array.from({ length: scale }, (_, index) => index + 1).map((item) => (
            <button key={item} type="button" className="choice-pill" onClick={() => onSubmit({ value: item })}>
              {item}
            </button>
          ))}
        </div>
      </article>
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
      <article className="panel interaction-card">
        <span className="eyebrow">Live poll</span>
        <h2>{interaction.prompt}</h2>
        <div className="choice-grid">
          {interaction.options.map((option) => (
            <button
              key={option}
              type="button"
              className={`choice-pill ${selected.includes(option) ? 'selected' : ''}`}
              onClick={() => toggleOption(option)}
            >
              {option}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={selected.length === 0}
          onClick={() => {
            onSubmit({ selections: selected })
            setSelected([])
          }}
        >
          Submit vote
        </button>
      </article>
    )
  }

  return (
    <article className="panel interaction-card">
      <span className="eyebrow">React live</span>
      <h2>{interaction.prompt}</h2>
      <div className="reaction-grid">
        {interaction.options.map((option) => (
          <button key={option} type="button" className="reaction-button" onClick={() => onSubmit({ value: option })}>
            {option}
          </button>
        ))}
      </div>
    </article>
  )
}
