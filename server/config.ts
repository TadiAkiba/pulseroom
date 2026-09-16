import path from 'node:path'

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined) {
    return fallback
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

function parseNumber(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const nodeEnv = process.env.NODE_ENV === 'production' ? 'production' : 'development'
const port = parseNumber(process.env.PORT, 3001)

export const config = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  port,
  appUrl: process.env.APP_URL?.trim() || `http://localhost:${port}`,
  databasePath: path.resolve(
    process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'engagement.sqlite'),
  ),
  sessionTtlHours: parseNumber(process.env.SESSION_TTL_HOURS, 8),
  enableDemoSeed: parseBoolean(
    process.env.ENABLE_DEMO_SEED,
    nodeEnv !== 'production',
  ),
  allowOrganizerSignup: parseBoolean(
    process.env.ALLOW_ORGANIZER_SIGNUP,
    nodeEnv !== 'production',
  ),
  bootstrapOrganizerEmail: process.env.BOOTSTRAP_ORGANIZER_EMAIL?.trim().toLowerCase() || '',
  bootstrapOrganizerPassword: process.env.BOOTSTRAP_ORGANIZER_PASSWORD?.trim() || '',
  analysisProvider: process.env.ANALYSIS_PROVIDER?.trim() || 'heuristic',
}
