import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../lib/api.ts'
import type { EventRecord } from '../types.ts'

export function DashboardPage() {
  const navigate = useNavigate()
  const [authenticated, setAuthenticated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [events, setEvents] = useState<EventRecord[]>([])
  const [passcode, setPasscode] = useState('')
  const [error, setError] = useState('')
  const [form, setForm] = useState({ name: '', description: '' })

  async function loadEvents() {
    const data = await api.listEvents()
    setEvents(data.events)
  }

  useEffect(() => {
    api
      .session()
      .then(async (session) => {
        setAuthenticated(session.authenticated)
        if (session.authenticated) {
          await loadEvents()
        }
      })
      .catch(() => undefined)
      .finally(() => setLoading(false))
  }, [])

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')

    try {
      await api.login(passcode)
      setAuthenticated(true)
      await loadEvents()
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Unable to sign in.')
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')

    try {
      const response = await api.createEvent({
        name: form.name,
        description: form.description,
        status: 'active',
      })
      await loadEvents()
      navigate(`/dashboard/${response.event.id}`)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Unable to create event.')
    }
  }

  async function handleLogout() {
    await api.logout()
    setAuthenticated(false)
    setEvents([])
  }

  if (loading) {
    return (
      <main className="page center-state">
        <div className="panel">
          <h1>Opening dashboard...</h1>
          <p>Checking your organizer session.</p>
        </div>
      </main>
    )
  }

  if (!authenticated) {
    return (
      <main className="page center-state">
        <div className="panel auth-panel">
          <span className="eyebrow">Organizer access</span>
          <h1>Sign in to manage live events</h1>
          <p>Use your organizer passcode. For local demo mode, the default is <code>demo-admin</code>.</p>
          <form onSubmit={handleLogin}>
            <input
              type="password"
              value={passcode}
              onChange={(event) => setPasscode(event.target.value)}
              placeholder="Enter passcode"
            />
            <button type="submit">Open dashboard</button>
          </form>
          {error ? <p className="inline-error">{error}</p> : null}
        </div>
      </main>
    )
  }

  return (
    <main className="page dashboard-home">
      <section className="section-header">
        <div>
          <span className="eyebrow">Organizer dashboard</span>
          <h1>Run live events without refreshing the room.</h1>
          <p>Create events, moderate audience questions, and launch presenter mode in one place.</p>
        </div>
        <button type="button" className="ghost-button" onClick={handleLogout}>
          Sign out
        </button>
      </section>

      <section className="dashboard-grid">
        <article className="panel">
          <h2>Create an event</h2>
          <form className="stack-form" onSubmit={handleCreate}>
            <input
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Quarterly product town hall"
            />
            <textarea
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              placeholder="Short event description"
              rows={4}
            />
            <button type="submit">Create event</button>
          </form>
          {error ? <p className="inline-error">{error}</p> : null}
        </article>

        <article className="panel">
          <h2>Your events</h2>
          <div className="event-list">
            {events.map((event) => (
              <Link key={event.id} className="event-row" to={`/dashboard/${event.id}`}>
                <div>
                  <strong>{event.name}</strong>
                  <p>
                    Code {event.code} • {event.status}
                  </p>
                </div>
                <span>{event.isDemo ? 'Demo' : 'Live'}</span>
              </Link>
            ))}
            {events.length === 0 ? <p className="muted">No events yet. Create one to get started.</p> : null}
          </div>
        </article>
      </section>
    </main>
  )
}
