import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Alert } from '../components/ui/Alert.tsx'
import { Badge } from '../components/ui/Badge.tsx'
import { Button } from '../components/ui/Button.tsx'
import { buttonClasses } from '../components/ui/buttonClasses.ts'
import { Field, Input } from '../components/ui/Field.tsx'
import { api } from '../lib/api.ts'

export function JoinPage() {
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [demoCode, setDemoCode] = useState('')
  const [demoEnabled, setDemoEnabled] = useState(false)

  useEffect(() => {
    api
      .demo()
      .then((data) => {
        setDemoEnabled(data.demoEnabled)
        if (data.demoCode) {
          setDemoCode(data.demoCode)
        }
      })
      .catch(() => undefined)
  }, [])

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
      <section className="hero-grid">
        <div className="hero-copy">
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
        </div>

        <div className="dashboard-preview">
          <div className="floating-card gradient-card">
            <span>Live questions</span>
            <strong>What is the rollout timeline for teams with existing tools?</strong>
            <p>Awaiting presenter approval</p>
          </div>
          <div className="floating-card">
            <span>Sentiment pulse</span>
            <div className="sentiment-row">
              <div>
                <strong>62%</strong>
                <small>Positive</small>
              </div>
              <div>
                <strong>27%</strong>
                <small>Neutral</small>
              </div>
              <div>
                <strong>11%</strong>
                <small>Negative</small>
              </div>
            </div>
          </div>
          <div className="floating-card">
            <span>Top themes</span>
            <div className="chip-row">
              <Badge variant="outline">Implementation</Badge>
              <Badge variant="outline">Pricing</Badge>
              <Badge variant="outline">Support</Badge>
            </div>
          </div>
        </div>
      </section>

      <section className="feature-strip">
        <div className="feature-card">
          <h2>Attendee experience</h2>
          <p>Fast, mobile-first, and anonymous with instant participation feedback.</p>
        </div>
        <div className="feature-card">
          <h2>Organizer dashboard</h2>
          <p>Moderate questions, watch live metrics, and keep presenter mode synced automatically.</p>
        </div>
        <div className="feature-card">
          <h2>Presenter mode</h2>
          <p>High-contrast views for projectors, conference screens, and large venues.</p>
        </div>
      </section>

      <section className="demo-banner">
        <div>
          <strong>{demoEnabled ? 'Need a live demo?' : 'Running this live?'}</strong>
          <p>
            {demoEnabled
              ? 'The seeded demo event includes realistic questions, feedback, ratings, polls, and reactions.'
              : 'Open the organizer dashboard to sign in, create an event, and launch a production-ready room.'}
          </p>
        </div>
        <div className="demo-actions">
          {demoEnabled && demoCode ? (
            <Button type="button" onClick={() => navigate(`/event/${demoCode}`)}>
              Open demo event ({demoCode})
            </Button>
          ) : null}
          <Link className={buttonClasses({ variant: 'outline' })} to="/dashboard">
            Organizer dashboard
          </Link>
        </div>
      </section>
    </main>
  )
}
