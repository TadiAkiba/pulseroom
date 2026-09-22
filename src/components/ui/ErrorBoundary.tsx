import { Component, type ErrorInfo, type ReactNode } from 'react'

type State =
  | { hasError: false; error: null; errorInfo: null }
  | { hasError: true; error: Error; errorInfo: ErrorInfo | null }

type Props = {
  children: ReactNode
  onError?: (error: Error, errorInfo: ErrorInfo | null) => void
  fallbackTitle?: string
  fallbackDescription?: string
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ error, errorInfo })
    this.props.onError?.(error, errorInfo)
  }

  reset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null })
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children
    }

    const title = this.props.fallbackTitle ?? 'Something went wrong'
    const description =
      this.props.fallbackDescription ??
      'The app hit an unexpected error. Refresh the page to continue.'

    return (
      <main className="page center-state">
        <div className="ui-state-card" style={{ maxWidth: 560 }}>
          <h1>{title}</h1>
          <p style={{ color: 'var(--text-soft)', marginBottom: '1rem' }}>{description}</p>
          {this.state.error?.message ? (
            <pre
              style={{
                background: 'var(--surface-soft)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: '0.75rem 1rem',
                color: 'var(--text)',
                fontSize: '0.85rem',
                lineHeight: 1.6,
                overflowX: 'auto',
                marginBottom: '1rem',
              }}
            >
              <code>{String(this.state.error.message)}</code>
            </pre>
          ) : null}
          <div
            style={{
              display: 'flex',
              gap: '0.5rem',
              justifyContent: 'flex-end',
              flexWrap: 'wrap',
            }}
          >
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                background: 'var(--surface-soft)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: '0.55rem 0.95rem',
                color: 'var(--text)',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Reload
            </button>
            <button
              type="button"
              onClick={this.reset}
              style={{
                background: 'var(--accent)',
                border: '1px solid transparent',
                borderRadius: 10,
                padding: '0.55rem 0.95rem',
                color: 'var(--accent-contrast)',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </main>
    )
  }
}
