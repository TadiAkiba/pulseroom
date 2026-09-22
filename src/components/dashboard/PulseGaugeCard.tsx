export type PulseRatingEntry = {
  id: string
  prompt: string
  average: number
  scale: number
  responses: number
}

export type PulsePalette = {
  positive: string
  neutral: string
  negative: string
  primary: string
}

function pulseLabelAndColor(
  rating: Pick<PulseRatingEntry, 'average'>,
  palette: PulsePalette,
): { label: string; color: string } {
  const { average } = rating
  if (average >= 4.2) return { label: 'Strongly positive', color: palette.positive }
  if (average >= 3.5) return { label: 'Positive', color: palette.primary }
  if (average >= 2.5) return { label: 'Neutral', color: palette.neutral }
  if (average >= 1.5) return { label: 'Cooler room', color: palette.negative }
  return { label: 'Concern flagged', color: palette.negative }
}

export function PulseGaugeCard({
  rating,
  palette,
}: {
  rating: PulseRatingEntry
  palette: PulsePalette
}) {
  const ratio = Math.max(0, Math.min(1, Number.isFinite(rating.average) ? rating.average / rating.scale : 0))
  const circumference = 2 * Math.PI * 46
  const strokeDashoffset = circumference * (1 - ratio)
  const { label, color: pulseColor } = pulseLabelAndColor(rating, palette)

  return (
    <article key={rating.id} className="pulse-card">
      <div className="pulse-card__gauge" aria-hidden>
        <svg viewBox="0 0 120 120">
          <circle className="gauge-track" cx="60" cy="60" r="46" />
          <circle
            className="gauge-fill"
            cx="60"
            cy="60"
            r="46"
            stroke={pulseColor}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
          />
        </svg>
        <div className="pulse-card__gauge-center">
          <div>
            <div className="pulse-card__avg">{rating.responses ? rating.average : '—'}</div>
            <div className="pulse-card__scale">/ {rating.scale}</div>
          </div>
        </div>
      </div>
      <div>
        <h3 className="pulse-card__headline">{rating.prompt}</h3>
        <p className="pulse-card__sub">
          {rating.responses
            ? `This pulse reading aggregates ${rating.responses} anonymous attendee ratings in real time.`
            : 'No one has voted on this pulse yet — ratings will populate here as the room responds.'}
        </p>
        <div className="pulse-card__summary">
          <span className="pulse-card__badge">{label}</span>
          <span className="pulse-card__badge">{rating.responses.toLocaleString()} responses</span>
          <span className="pulse-card__badge">1–{rating.scale} scale</span>
        </div>
      </div>
    </article>
  )
}
