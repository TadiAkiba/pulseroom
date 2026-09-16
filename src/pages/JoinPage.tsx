import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert } from '../components/ui/Alert.tsx'
import { Badge } from '../components/ui/Badge.tsx'
import { Button } from '../components/ui/Button.tsx'
import { Field, Input } from '../components/ui/Field.tsx'
import { api } from '../lib/api.ts'

export function JoinPage() {
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError('')

    try {
      const normalized = code.trim().toUpperCase()
      await api.getEventByCode(normalized)
      navigate(`/event/${normalized}`)
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
          <Field label="Enter event code">
            <div className="join-row">
              <Input
                id="event-code"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="ABC123"
                maxLength={6}
                autoComplete="off"
              />
              <Button type="submit" disabled={loading}>
                {loading ? 'Joining...' : 'Join event'}
              </Button>
            </div>
          </Field>
          {error ? <Alert variant="danger">{error}</Alert> : null}
        </form>

        <div className="privacy-card">
          <strong>Privacy-first:</strong> no name, email, phone number, or attendee account required.
        </div>
      </section>
    </main>
  )
}
