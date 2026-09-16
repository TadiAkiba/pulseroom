import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../lib/api.ts'

export function JoinPage() {
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [demoCode, setDemoCode] = useState('')

  useEffect(() => {
    api
      .demo()
      .then((data) => {
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
          <span className="eyebrow">Anonymous live audience engagement</span>
          <h1>Turn live events into a real-time conversation.</h1>
          <p className="lede">
            Join with a code, ask questions anonymously, react in the moment, and watch the room’s sentiment evolve live.
          </p>

          <form className="join-form" onSubmit={handleSubmit}>
            <label htmlFor="event-code">Enter event code</label>
            <div className="join-row">
              <input
                id="event-code"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="ABC123"
                maxLength={6}
                autoComplete="off"
              />
              <button type="submit" disabled={loading}>
                {loading ? 'Joining...' : 'Join event'}
              </button>
            </div>
            {error ? <p className="inline-error">{error}</p> : null}
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
              <span className="chip">Implementation</span>
              <span className="chip">Pricing</span>
              <span className="chip">Support</span>
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
          <strong>Need a live demo?</strong>
          <p>The seeded demo event includes realistic questions, feedback, ratings, polls, and reactions.</p>
        </div>
        <div className="demo-actions">
          {demoCode ? (
            <button type="button" onClick={() => navigate(`/event/${demoCode}`)}>
              Open demo event ({demoCode})
            </button>
          ) : (
            <Link to="/dashboard">Open organizer dashboard</Link>
          )}
          <Link to="/dashboard">Organizer dashboard</Link>
        </div>
      </section>
    </main>
  )
}
