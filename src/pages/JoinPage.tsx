import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert } from '../components/ui/Alert.tsx'
import { Badge } from '../components/ui/Badge.tsx'
import { Button } from '../components/ui/Button.tsx'
import { Field, Input } from '../components/ui/Field.tsx'
import { api } from '../lib/api.ts'
import type { AnonymousAttendeeProfile, EventPageData } from '../types.ts'

const defaultTeams = ['Catalysts', 'Builders', 'Navigators', 'Trailblazers']

function createAttendeeKey() {
  return `attendee-${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`
}

function getProfileStorageKey(code: string) {
  return `pulse-room-profile:${code}`
}

function getStoredProfile(code: string): AnonymousAttendeeProfile | null {
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

function getEventTeams(data: EventPageData | null) {
  const rawTeams = Array.isArray(data?.event?.config?.teams) ? data.event.config.teams : []
  const teams = rawTeams.map(String).map((team) => team.trim()).filter(Boolean)
  return teams.length > 0 ? teams : defaultTeams
}

export function JoinPage() {
  const navigate = useNavigate()
  const initialCodeStored = useMemo(() => '', [])
  const [code, setCode] = useState(initialCodeStored)
  const [nickname, setNickname] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError('')

    try {
      const normalizedCode = code.trim().toUpperCase()
      if (normalizedCode.length < 3) {
        throw new Error('Enter the event code shared by the organizer.')
      }

      const trimmedNickname = nickname.trim()
      if (trimmedNickname.length < 2) {
        throw new Error('Choose a nickname with at least 2 characters.')
      }

      const data = await api.getEventByCode(normalizedCode)
      const teams = getEventTeams(data)

      const existing = getStoredProfile(normalizedCode)
      const profile: AnonymousAttendeeProfile = {
        attendeeKey: existing?.attendeeKey ?? createAttendeeKey(),
        nickname: trimmedNickname,
        team: existing?.team && teams.includes(existing.team) ? existing.team : teams[0] ?? defaultTeams[0],
      }
      setStoredProfile(normalizedCode, profile)
      navigate(`/event/${normalizedCode}`)
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Unable to join this event.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="page attendee-home">
      <section className="hero-copy join-shell">
        <Badge variant="info">Anonymous live audience engagement</Badge>
        <h1>Turn live events into a real-time conversation.</h1>
        <p className="lede">
          Join with a code, ask questions anonymously, react in the moment, and watch the room’s sentiment evolve live.
        </p>

        <form className="join-form" onSubmit={handleSubmit}>
          <Field label="Event code">
            <Input
              id="event-code"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="ABC123"
              maxLength={6}
              autoComplete="off"
            />
          </Field>
          <Field label="Anonymous nickname">
            <Input
              id="attendee-nickname"
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              placeholder="BrightSpark42"
              maxLength={24}
              autoComplete="off"
            />
          </Field>
          <Button type="submit" block disabled={loading}>
            {loading ? 'Joining...' : 'Join event'}
          </Button>
          {error ? <Alert variant="danger">{error}</Alert> : null}
        </form>

        <div className="privacy-card">
          <strong>Privacy-first:</strong> your nickname is visible inside the room, but no name, email, phone number, or attendee account is ever collected.
        </div>
      </section>
    </main>
  )
}
