import { lazy, Suspense, useEffect } from 'react'
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { ConvexProvider } from 'convex/react'
import { getConvexClient } from './lib/convex.ts'
import { Card, CardContent, CardDescription, CardTitle } from './components/ui/Card.tsx'
import { ErrorBoundary } from './components/ui/ErrorBoundary.tsx'
import { installGlobalErrorHandlers } from './lib/globalErrorHandlers.ts'

const JoinPage = lazy(() => import('./pages/JoinPage.tsx').then((module) => ({ default: module.JoinPage })))
const AttendeePage = lazy(() =>
  import('./pages/AttendeePage.tsx').then((module) => ({ default: module.AttendeePage })),
)
const DashboardPage = lazy(() =>
  import('./pages/DashboardPage.tsx').then((module) => ({ default: module.DashboardPage })),
)
const EventDashboardPage = lazy(() =>
  import('./pages/EventDashboardPage.tsx').then((module) => ({ default: module.EventDashboardPage })),
)
const PresenterPage = lazy(() =>
  import('./pages/PresenterPage.tsx').then((module) => ({ default: module.PresenterPage })),
)

function TopNav() {
  const location = useLocation()
  const isPresenter = location.pathname.startsWith('/present/')

  if (isPresenter) {
    return null
  }

  return (
    <header className="topbar">
      <Link className="brand" to="/join">
        PulseRoom
      </Link>
      <nav className="topbar-links">
        <Link to="/join">Join</Link>
        <Link to="/dashboard">Dashboard</Link>
      </nav>
    </header>
  )
}

function AppShell() {
  return (
    <div className="app-shell">
      <TopNav />
      <Suspense
        fallback={
          <main className="page center-state">
            <Card className="ui-state-card">
              <CardContent>
                <CardTitle>Loading experience...</CardTitle>
                <CardDescription>Pulling in the right live view for this route.</CardDescription>
              </CardContent>
            </Card>
          </main>
        }
      >
        <Routes>
          <Route path="/" element={<Navigate to="/join" replace />} />
          <Route path="/join" element={<JoinPage />} />
          <Route path="/event/:code" element={<AttendeePage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/dashboard/:eventId" element={<EventDashboardPage />} />
          <Route path="/present/:code" element={<PresenterPage />} />
        </Routes>
      </Suspense>
    </div>
  )
}

export default function App() {
  const convexClient = getConvexClient()

  useEffect(() => {
    const { uninstall } = installGlobalErrorHandlers((source, detail) => {
      try {
        if (typeof console !== 'undefined') {
          console.error(`[global:${source}]`, detail.message, detail.stack ?? '')
        }
      } catch {
      }
    })
    return uninstall
  }, [])

  return (
    <ConvexProvider client={convexClient}>
      <ErrorBoundary
        fallbackTitle="PulseRoom ran into an error"
        fallbackDescription="Your room state is safe on the server. Reload to reconnect."
      >
        <AppShell />
      </ErrorBoundary>
    </ConvexProvider>
  )
}
