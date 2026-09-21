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

function parseOrigins(value: string | undefined) {
  if (!value) {
    return []
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function normalizeOrigin(value: string | undefined) {
  if (!value) {
    return ''
  }

  try {
    return new URL(value).origin
  } catch {
    return value.trim()
  }
}

const nodeEnv = process.env.NODE_ENV === 'production' ? 'production' : 'development'
const port = parseNumber(process.env.PORT, 3001)
const convexUrl = process.env.CONVEX_URL?.trim() || process.env.VITE_CONVEX_URL?.trim() || ''
const convexHttpActionsUrl = process.env.CONVEX_HTTP_ACTIONS_URL?.trim() || ''
const appUrl = process.env.APP_URL?.trim() || `http://localhost:${port}`
const frontendUrl = process.env.FRONTEND_URL?.trim() || ''
const allowedOrigins = [
  normalizeOrigin(appUrl),
  normalizeOrigin(frontendUrl),
  ...parseOrigins(process.env.CORS_ALLOWED_ORIGINS).map(normalizeOrigin),
].filter(Boolean)
const usesCrossSiteCookies =
  Boolean(frontendUrl) && normalizeOrigin(frontendUrl) !== normalizeOrigin(appUrl)

export const config = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  port,
  appUrl,
  frontendUrl,
  allowedOrigins,
  usesCrossSiteCookies,
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
    true,
  ),
  analysisProvider: process.env.ANALYSIS_PROVIDER?.trim() || 'heuristic',
  convexUrl,
  convexHttpActionsUrl,
  convexSyncSecret: process.env.CONVEX_SYNC_SECRET?.trim() || '',
  enableConvexPublicSync: parseBoolean(
    process.env.ENABLE_CONVEX_PUBLIC_SYNC,
    false,
  ) && Boolean(convexUrl && convexHttpActionsUrl),
}
