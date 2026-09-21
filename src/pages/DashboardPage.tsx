import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Alert } from '../components/ui/Alert.tsx'
import { Button } from '../components/ui/Button.tsx'
import { buttonClasses } from '../components/ui/buttonClasses.ts'
import { Card, CardContent, CardDescription, CardTitle } from '../components/ui/Card.tsx'
import { Field, Input, Textarea } from '../components/ui/Field.tsx'
import { Tabs, TabsList, TabsTrigger } from '../components/ui/Tabs.tsx'
import { api } from '../lib/api.ts'
import type { AuthSession, EventRecord } from '../types.ts'

type AuthMode = 'login' | 'register'

const emptySession: AuthSession = {
  authenticated: false,
  organizer: null,
  canRegister: false,
}

export function DashboardPage() {
  const navigate = useNavigate()
  const [session, setSession] = useState<AuthSession>(emptySession)
  const [loading, setLoading] = useState(true)
  const [events, setEvents] = useState<EventRecord[]>([])
  const [mode, setMode] = useState<AuthMode>('login')
  const [credentials, setCredentials] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [form, setForm] = useState({ name: '', description: '' })

  async function loadEvents() {
    const data = await api.listEvents()
    setEvents(data.events)
  }

  useEffect(() => {
    api
      .session()
      .then(async (currentSession) => {
        setSession(currentSession)
        if (currentSession.authenticated) {
          await loadEvents()
        } else if (currentSession.canRegister) {
          setMode('register')
        }
      })
      .catch(() => undefined)
      .finally(() => setLoading(false))
  }, [])

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')

    try {
      const nextSession =
        mode === 'register'
          ? await api.register(credentials)
          : await api.login(credentials)
      setSession(nextSession)
      await loadEvents()
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : 'Unable to continue.')
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
    const nextSession = await api.session()
    setSession(nextSession)
    setEvents([])
  }

  if (loading) {
    return (
      <main className="page center-state">
        <Card className="ui-state-card">
          <CardContent>
            <CardTitle>Opening dashboard...</CardTitle>
            <CardDescription>Checking your organizer session.</CardDescription>
          </CardContent>
        </Card>
      </main>
    )
  }

  if (!session.authenticated) {
    return (
      <main className="page center-state">
        <Card className="auth-panel">
          <span className="eyebrow">Organizer access</span>
          <h1>{mode === 'register' ? 'Create your organizer account' : 'Sign in to manage live events'}</h1>
          <p>
            {session.canRegister
              ? 'Organizer accounts are stored securely and sessions survive restarts.'
              : 'Open organizer sign up is currently closed. Use the credentials set up for this deployment, or enable ALLOW_ORGANIZER_SIGNUP to create additional accounts.'}
          </p>

          <Tabs>
            <TabsList className="auth-tabs">
              <TabsTrigger active={mode === 'login'} onClick={() => setMode('login')}>
                Sign in
              </TabsTrigger>
              <TabsTrigger active={mode === 'register'} onClick={() => setMode('register')}>
                Create account
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <form onSubmit={handleAuth} className="stack-form">
            <Field label="Email">
              <Input
                type="email"
                value={credentials.email}
                onChange={(event) => setCredentials((current) => ({ ...current, email: event.target.value }))}
                placeholder="organizer@company.com"
                autoComplete="email"
              />
            </Field>
            <Field label="Password">
              <Input
                type="password"
                value={credentials.password}
                onChange={(event) => setCredentials((current) => ({ ...current, password: event.target.value }))}
                placeholder="Enter password"
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              />
            </Field>
            <Button type="submit" block>
              {mode === 'register' ? 'Create organizer account' : 'Open dashboard'}
            </Button>
          </form>
          {error ? <Alert variant="danger">{error}</Alert> : null}
        </Card>
      </main>
    )
  }

  return (
    <main className="page dashboard-home">
      <section className="section-header">
        <div>
          <span className="eyebrow">Organizer dashboard</span>
          <h1>Run live events without refreshing the room.</h1>
          <p>
            Signed in as <strong>{session.organizer?.email}</strong>. Create events, moderate questions, and launch presenter mode.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={handleLogout}>
          Sign out
        </Button>
      </section>

      <section className="dashboard-grid">
        <Card>
          <CardTitle>Create an event</CardTitle>
          <form className="stack-form" onSubmit={handleCreate}>
            <Field label="Event name">
              <Input
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Quarterly product town hall"
              />
            </Field>
            <Field label="Description">
              <Textarea
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="Short event description"
                rows={4}
              />
            </Field>
            <Button type="submit">Create event</Button>
          </form>
          {error ? <Alert variant="danger">{error}</Alert> : null}
        </Card>

        <Card>
          <CardTitle>Your events</CardTitle>
          <div className="event-list">
            {events.map((event) => (
              <Link key={event.id} className={buttonClasses({ variant: 'ghost', className: 'event-row-link' })} to={`/dashboard/${event.id}`}>
                <div className="event-row">
                <div>
                  <strong>{event.name}</strong>
                  <p>
                    Code {event.code} • {event.status}
                  </p>
                </div>
                <span>{event.isDemo ? 'Demo' : 'Live'}</span>
                </div>
              </Link>
            ))}
            {events.length === 0 ? <p className="muted">No events yet. Create one to get started.</p> : null}
          </div>
        </Card>
      </section>
    </main>
  )
}
