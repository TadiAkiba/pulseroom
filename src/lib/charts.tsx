import type { ReactNode } from 'react'

export type AnyTooltipEntry = {
  name?: unknown
  dataKey?: unknown
  value?: unknown
  color?: unknown
}

export type PollOption = {
  label: string
  value: number
  accent?: boolean
}

export function ChartTooltip({
  active,
  payload,
  label,
  labelPrefix,
}: {
  active?: boolean
  payload?: readonly AnyTooltipEntry[]
  label?: unknown
  labelPrefix?: string
}) {
  if (!active || !payload || payload.length === 0) return null
  const first = payload[0]
  const seriesColor = typeof first?.color === 'string' ? first.color : 'var(--chart-primary)'
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip__label">
        {labelPrefix ? `${labelPrefix} ${String(label ?? '')}` : String(label ?? '')}
      </div>
      {payload.map((entry, index) => (
        <div key={`${String(entry.dataKey)}-${index}`} className="chart-tooltip__item">
          <span className="chart-tooltip__dot" style={{ background: seriesColor }} />
          <span style={{ color: 'var(--text-soft)', flex: '0 0 auto' }}>
            {String(entry.name ?? entry.dataKey)}:
          </span>
          <strong
            style={{
              marginLeft: 'auto',
              color: 'var(--text)',
              fontVariantNumeric: 'tabular-nums',
              fontWeight: 600,
            }}
          >
            {typeof entry.value === 'number' && Number.isInteger(entry.value)
              ? entry.value
              : typeof entry.value === 'number'
                ? entry.value.toFixed(1)
                : String(entry.value)}
          </strong>
        </div>
      ))}
    </div>
  )
}

export function ChartShell({
  eyebrow,
  title,
  meta,
  children,
  className = '',
}: {
  eyebrow?: string
  title: string
  meta?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`chart-shell ${className}`}>
      <div className="chart-shell__header">
        <div style={{ minWidth: 0 }}>
          {eyebrow ? <div className="chart-shell__eyebrow">{eyebrow}</div> : null}
          <div className="chart-shell__title">{title}</div>
          {meta ? <div className="chart-shell__meta">{meta}</div> : null}
        </div>
      </div>
      {children}
    </div>
  )
}

export function PollBars({ options }: { options: PollOption[] }) {
  const total = options.reduce((acc, o) => acc + Math.max(0, o.value), 0)
  const max = options.reduce((acc, o) => Math.max(acc, o.value), 0)
  return (
    <div className="poll-bars">
      {options.map((option) => {
        const pct = total > 0 ? Math.round((option.value / total) * 100) : 0
        const fillPct = max > 0 ? Math.max(4, (option.value / max) * 100) : 0
        return (
          <div key={option.label} className="poll-bar" title={option.label}>
            <div style={{ minWidth: 0 }}>
              <div className="poll-bar__label" title={option.label}>
                {option.label}
              </div>
              <div className="poll-bar__track">
                <div className="poll-bar__fill" style={{ width: `${fillPct}%` }} />
              </div>
            </div>
            <div className="poll-bar__value">
              <span className="poll-bar__count">{option.value}</span>
              <span className="poll-bar__pct">{pct}%</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
