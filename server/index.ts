import 'dotenv/config'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { Server } from 'socket.io'
import { z } from 'zod'
import { analyseText, buildAnalytics } from './analysis.ts'
import { config } from './config.ts'
import {
  countOrganizers,
  createEvent,
  createInteraction,
  createOrganizer,
  createOrganizerSession,
  createOrReplaceAnalysis,
  createResponse,
  deleteOrganizerSession,
  ensureDemoEvent,
  getEventByCode,
  getEventById,
  getInteraction,
  getManageableEventById,
  getOrganizerByEmail,
  getOrganizerSession,
  getResponse,
  initializeDatabase,
  listAnalyses,
  listConvexSyncFailures,
  listEvents,
  listEventsForOrganizer,
  listInteractions,
  listOrganizers,
  listResponses,
  listResponseVotes,
  markConvexSyncFailure,
  markConvexSyncSuccess,
  touchConvexSyncState,
  type InteractionType,
  type OrganizerRecord,
  updateEvent,
  updateInteraction,
  updateOrganizerPassword,
  updateResponseModeration,
  upsertResponseVote,
} from './db.ts'
import { hashPassword, verifyPassword } from './security.ts'

type OrganizerRequest = express.Request & {
  organizer: OrganizerRecord
}

const rateLimitWindowMs = 2000
const lastSubmissionByKey = new Map<string, number>()
let convexSyncWarned = false
const convexRetryTimers = new Map<string, ReturnType<typeof setTimeout>>()
const CONVEX_MIN_RETRY_MS = 1_000
const CONVEX_MAX_RETRY_MS = 5 * 60 * 1000

function convexBackoffMs(tries: number) {
  const jitter = Math.random() * 0.3 + 0.85
  const base = Math.min(CONVEX_MAX_RETRY_MS, CONVEX_MIN_RETRY_MS * 2 ** Math.max(0, tries - 1))
  return Math.round(base * jitter)
}

initializeDatabase()
applyOrganizerPasswordReset()
reportAuthState()

if (config.enableDemoSeed) {
  ensureDemoEvent(undefined)
}

if (config.enableConvexPublicSync) {
  console.log(
    `Convex sync enabled → endpoint=${config.convexHttpActionsUrl} clientUrl=${config.convexUrl}`,
  )
  void verifyConvexReachability()
} else {
  console.log('Convex sync disabled.')
}

scheduleStaleConvexRetries()

const cookieSameSite = config.usesCrossSiteCookies ? 'none' : 'lax'
const cookieSecure = config.isProduction || config.usesCrossSiteCookies
console.log(
  `HTTP: env=${config.nodeEnv} port=${config.port} app=${config.appUrl} frontend=${config.frontendUrl || '(same-origin)'} ` +
  `crossSiteCookies=${config.usesCrossSiteCookies} cookie.sameSite=${cookieSameSite} cookie.secure=${cookieSecure} ` +
  `allowedOrigins=[${config.allowedOrigins.join(', ') || '*'}]`,
)

const app = express()
const server = http.createServer(app)
const io = new Server(server, {
  cors: {
    origin: config.allowedOrigins.length > 0 ? config.allowedOrigins : true,
    credentials: true,
  },
})

if (config.isProduction) {
  app.set('trust proxy', 1)
}

app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())
app.use(
  cors({
    origin: config.allowedOrigins.length > 0 ? config.allowedOrigins : true,
    credentials: true,
  }),
)

const eventSchema = z.object({
  name: z.string().min(3),
  description: z.string().max(280).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
})

const interactionSchema = z.object({
  type: z.enum(['question', 'feedback', 'rating', 'poll', 'reaction']),
  prompt: z.string().min(3),
  options: z.array(z.string()).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  ordering: z.number().int().optional(),
})

const interactionImportSchema = z.object({
  interactions: z.array(interactionSchema).min(1).max(100),
})

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(128),
})

const registerSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(128),
})

const attendeeProfileSchema = z.object({
  attendeeKey: z.string().trim().min(8).max(120),
  nickname: z.string().trim().min(2).max(24),
  team: z.string().trim().min(2).max(40),
})

function normalizeProfile(input: z.infer<typeof attendeeProfileSchema>) {
  return {
    attendeeKey: input.attendeeKey.trim(),
    nickname: input.nickname.trim(),
    team: input.team.trim(),
  }
}

function getConfiguredTeams(event: { config: Record<string, unknown> }) {
  const rawTeams = Array.isArray(event.config.teams) ? event.config.teams : []
  const teams = rawTeams.map(String).map((team) => team.trim()).filter(Boolean)
  return teams.length > 0 ? teams : ['Catalysts', 'Builders', 'Navigators', 'Trailblazers']
}

function getAttendeeMeta(content: Record<string, unknown>) {
  const attendeeKey = typeof content.attendeeKey === 'string' ? content.attendeeKey : ''
  const nickname = typeof content.nickname === 'string' ? content.nickname : 'Anonymous'
  const team = typeof content.team === 'string' ? content.team : 'Unassigned'

  return {
    attendeeKey,
    nickname,
    team,
  }
}

function getActivePollInteractionId(event: { config: Record<string, unknown> }) {
  return typeof event.config.activePollInteractionId === 'string' ? event.config.activePollInteractionId : null
}

function maskEmail(email: string) {
  const [local, domain] = email.split('@')
  if (!local || !domain) return email
  const safeLocal = local.length <= 2 ? local : `${local.slice(0, 2)}${'*'.repeat(Math.min(local.length - 2, 10))}`
  const domainParts = domain.split('.')
  const safeDomain = domainParts.length >= 2
    ? `${domainParts[0].slice(0, Math.max(1, Math.min(2, domainParts[0].length)))}${'*'.repeat(Math.min(domainParts[0].length - 1, 8))}.${domainParts.slice(1).join('.')}`
    : domain
  return `${safeLocal}@${safeDomain}`
}

function applyOrganizerPasswordReset() {
  const resetEmail = String(process.env.ORGANIZER_PASSWORD_RESET_EMAIL ?? '').trim().toLowerCase()
  const resetPassword = String(process.env.ORGANIZER_PASSWORD_RESET_PASSWORD ?? '')
  if (!resetEmail || !resetPassword) {
    return
  }
  if (resetPassword.length < 8) {
    console.warn(
      `[auth] ORGANIZER_PASSWORD_RESET_PASSWORD is too short (min 8 chars); password reset for ${maskEmail(resetEmail)} skipped.`,
    )
    return
  }
  const target = getOrganizerByEmail(resetEmail)
  if (!target) {
    console.warn(
      `[auth] ORGANIZER_PASSWORD_RESET_EMAIL=${maskEmail(resetEmail)} does not match any organizer; no reset applied.`,
    )
    return
  }
  try {
    const newHash = hashPassword(resetPassword)
    updateOrganizerPassword(target.id, newHash)
    console.log(
      `[auth] Password reset applied for organizer ${maskEmail(target.email)}. Remove ORGANIZER_PASSWORD_RESET_EMAIL + ORGANIZER_PASSWORD_RESET_PASSWORD from env vars for security.`,
    )
  } catch (err) {
    console.error(
      `[auth] Failed to apply password reset for ${maskEmail(resetEmail)}:`,
      err instanceof Error ? err.message : err,
    )
  }
}

function reportAuthState() {
  const organizers = listOrganizers()
  const total = organizers.length
  const signupAllowed = canRegisterOrganizer()
  const why = config.allowOrganizerSignup
    ? 'ALLOW_ORGANIZER_SIGNUP is enabled'
    : total === 0
      ? 'no organizers exist yet (first account is always unlocked)'
      : 'ALLOW_ORGANIZER_SIGNUP is disabled and organizers already exist'

  console.log(
    `Auth: ${total} organizer(s) registered. Signup ${signupAllowed ? 'OPEN' : 'CLOSED'} — ${why}.`,
  )
  if (total > 0) {
    console.log(
      `Auth: existing accounts → ${organizers.map((o) => `${maskEmail(o.email)} (id ${o.id.slice(0, 6)}…)`).join(', ')}.`,
    )
  }
  if (process.env.ORGANIZER_PASSWORD_RESET_EMAIL) {
    console.warn(
      '[auth] ORGANIZER_PASSWORD_RESET_EMAIL is set in env vars. After successful login, remove both ORGANIZER_PASSWORD_RESET_EMAIL and ORGANIZER_PASSWORD_RESET_PASSWORD from the deployment to prevent repeat resets.',
    )
  }
  if (total === 0) {
    console.log(
      'Tip: on first run, visit the dashboard to create your initial organizer account from the UI.',
    )
  }
}

function canRegisterOrganizer() {
  return config.allowOrganizerSignup || countOrganizers() === 0
}

function parseCookieHeader(cookieHeader?: string) {
  const parsed = new Map<string, string>()
  if (!cookieHeader) {
    return parsed
  }

  for (const fragment of cookieHeader.split(';')) {
    const [rawKey, ...rawValue] = fragment.trim().split('=')
    if (rawKey) {
      parsed.set(rawKey, rawValue.join('='))
    }
  }

  return parsed
}

function authSummary(organizer: OrganizerRecord | null) {
  return organizer ? { email: organizer.email } : null
}

function getOrganizerFromRequest(req: express.Request) {
  const sessionId = typeof req.cookies.organizer_session === 'string' ? req.cookies.organizer_session : ''
  if (!sessionId) {
    return null
  }

  return getOrganizerSession(sessionId)
}

function setSessionCookie(res: express.Response, sessionId: string) {
  res.cookie('organizer_session', sessionId, {
    path: '/',
    httpOnly: true,
    sameSite: config.usesCrossSiteCookies ? 'none' : 'lax',
    secure: config.isProduction || config.usesCrossSiteCookies,
    maxAge: config.sessionTtlHours * 60 * 60 * 1000,
  })
}

function clearSessionCookie(res: express.Response) {
  res.clearCookie('organizer_session', {
    path: '/',
    httpOnly: true,
    sameSite: config.usesCrossSiteCookies ? 'none' : 'lax',
    secure: config.isProduction || config.usesCrossSiteCookies,
  })
}

function toTitle(type: InteractionType) {
  return (
    {
      question: 'Question',
      feedback: 'Feedback',
      rating: 'Rating',
      poll: 'Poll',
      reaction: 'Reaction',
    }[type] ?? type
  )
}

function requireOrganizer(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  const sessionId = typeof req.cookies.organizer_session === 'string' ? req.cookies.organizer_session : ''
  if (!sessionId) {
    console.warn(
      `[auth] 401 ${req.method} ${req.path} — no organizer_session cookie. ` +
      `origin=${req.get('origin') || 'n/a'} cookie=${req.get('cookie') ? 'present (other keys)' : 'absent entirely'} — ` +
      `check FRONTEND_URL + APP_URL match sameSite/secure and that credentials: 'include' is used on the client.`,
    )
    res.status(401).json({ error: 'Organizer session required.' })
    return
  }

  const lookup = getOrganizerSession(sessionId)
  if (!lookup) {
    console.warn(
      `[auth] 401 ${req.method} ${req.path} — invalid or expired organizer_session ` +
      `(${sessionId.slice(0, 8)}…). origin=${req.get('origin') || 'n/a'}`,
    )
    res.status(401).json({ error: 'Organizer session required.' })
    return
  }

  ;(req as OrganizerRequest).organizer = lookup.organizer
  next()
}

function createDefaultInteractions(eventId: string) {
  const existing = listInteractions(eventId)
  if (existing.length > 0) {
    return existing
  }

  return [
    createInteraction({
      eventId,
      type: 'question',
      prompt: 'What question would you like us to answer?',
      settings: {
        formKey: 'qa',
        formTitle: 'Ask the Room',
        formDescription: 'Ask anonymously and let the room upvote the questions they want answered live.',
        questionNumber: 1,
        questionCount: 1,
        points: 4,
      },
      ordering: 1,
    }),
    createInteraction({
      eventId,
      type: 'poll',
      prompt: 'What matters most to you right now?',
      options: [
        'Customer experience',
        'Employee experience',
        'Productivity',
        'Cost efficiency',
        'Revenue growth',
      ],
      settings: {
        formKey: 'event',
        formTitle: 'Live poll',
        questionNumber: 1,
        questionCount: 3,
        allowMultiple: false,
        points: 2,
      },
      ordering: 2,
    }),
    createInteraction({
      eventId,
      type: 'rating',
      prompt: 'How is the event going so far?',
      settings: {
        formKey: 'event',
        formTitle: 'Pulse check',
        questionNumber: 2,
        questionCount: 3,
        scale: 5,
        labels: ['Poor', 'Fair', 'Good', 'Great', 'Excellent'],
        points: 2,
      },
      ordering: 3,
    }),
    createInteraction({
      eventId,
      type: 'feedback',
      prompt: 'What should we keep doing more of?',
      settings: {
        formKey: 'event',
        formTitle: 'Feedback',
        questionNumber: 3,
        questionCount: 3,
        feedEligible: true,
        points: 4,
      },
      ordering: 4,
    }),
  ]
}

function formatTime(iso: string) {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

function ensureEventAccess(eventId: string, organizerId: string) {
  return getManageableEventById(eventId, organizerId)
}

function buildEventSnapshot(eventId: string, includeHidden: boolean) {
  const event = getEventById(eventId)
  if (!event) {
    return null
  }

  const interactions = listInteractions(eventId)
  const responses = listResponses(eventId)
  const analyses = listAnalyses(eventId)
  const votes = listResponseVotes(eventId)
  const interactionById = new Map(interactions.map((interaction) => [interaction.id, interaction]))
  const analysisByResponseId = new Map(analyses.map((analysis) => [analysis.responseId, analysis]))
  const voteSummaryByResponseId = new Map<string, { up: number; down: number; score: number }>()
  const teams = getConfiguredTeams(event)

  const usableResponses = responses.filter((response) => response.moderationState !== 'deleted')
  const publicResponses = usableResponses.filter((response) => {
    if (includeHidden) {
      return true
    }

    const interaction = interactionById.get(response.interactionId)
    if (!interaction) {
      return false
    }

    if (interaction.type === 'question') {
      return (
        response.moderationState === 'visible' ||
        response.moderationState === 'answered' ||
        response.moderationState === 'pending'
      )
    }

    return response.moderationState !== 'hidden'
  })

  const responsesForView = includeHidden ? usableResponses : publicResponses

  for (const vote of votes) {
    const current = voteSummaryByResponseId.get(vote.responseId) ?? { up: 0, down: 0, score: 0 }
    if (vote.direction === 'down') {
      current.down += 1
      current.score -= 1
    } else {
      current.up += 1
      current.score += 1
    }
    voteSummaryByResponseId.set(vote.responseId, current)
  }

  const engagementTimeline = new Map<string, number>()
  for (const response of usableResponses) {
    const bucket = formatTime(response.createdAt)
    engagementTimeline.set(bucket, (engagementTimeline.get(bucket) ?? 0) + 1)
  }

  const questionStream = responsesForView
    .filter((response) => response.responseType === 'question')
    .map((response) => {
      const voteSummary = voteSummaryByResponseId.get(response.id) ?? { up: 0, down: 0, score: 0 }
      return {
        id: response.id,
        interactionId: response.interactionId,
        interactionPrompt: interactionById.get(response.interactionId)?.prompt ?? 'Question',
        text: String(response.content.text ?? ''),
        createdAt: response.createdAt,
        timeLabel: formatTime(response.createdAt),
        moderationState: response.moderationState,
        highlighted: response.highlighted,
        votes: {
          up: voteSummary.up,
          score: voteSummary.score,
        },
      }
    })
    .sort(
      (left, right) =>
        Number(right.highlighted) - Number(left.highlighted) ||
        right.votes.score - left.votes.score ||
        right.createdAt.localeCompare(left.createdAt),
    )

  const ideaFeed = responsesForView
    .filter((response) => {
      if (response.responseType !== 'feedback') {
        return false
      }
      const interaction = interactionById.get(response.interactionId)
      return interaction?.settings.feedEligible !== false
    })
    .map((response) => {
      const attendee = getAttendeeMeta(response.content)
      const voteSummary = voteSummaryByResponseId.get(response.id) ?? { up: 0, down: 0, score: 0 }
      return {
        id: response.id,
        interactionId: response.interactionId,
        interactionPrompt: interactionById.get(response.interactionId)?.prompt ?? 'Idea',
        text: String(response.content.text ?? ''),
        createdAt: response.createdAt,
        timeLabel: formatTime(response.createdAt),
        nickname: attendee.nickname,
        team: attendee.team,
        sentiment: analysisByResponseId.get(response.id)?.sentiment ?? 'neutral',
        votes: voteSummary,
      }
    })
    .sort((left, right) => right.votes.score - left.votes.score || right.createdAt.localeCompare(left.createdAt))

  const teamSummary = new Map(
    teams.map((team) => [
      team,
      {
        team,
        points: 0,
        contributors: new Set<string>(),
        contributions: 0,
        ideas: 0,
        questions: 0,
        votesReceived: 0,
      },
    ]),
  )
  const uniqueParticipants = new Set<string>()
  const defaultResponsePoints: Record<InteractionType, number> = {
    question: 5,
    feedback: 6,
    poll: 3,
    rating: 2,
    reaction: 1,
  }

  for (const response of usableResponses) {
    const attendee = getAttendeeMeta(response.content)
    if (!attendee.attendeeKey || !attendee.team) {
      continue
    }

    uniqueParticipants.add(attendee.attendeeKey)
    const team = teamSummary.get(attendee.team) ?? {
      team: attendee.team,
      points: 0,
      contributors: new Set<string>(),
      contributions: 0,
      ideas: 0,
      questions: 0,
      votesReceived: 0,
    }
    team.contributors.add(attendee.attendeeKey)
    team.contributions += 1
    const interaction = interactionById.get(response.interactionId)
    const configuredPoints = Number(interaction?.settings.points)
    team.points += Number.isFinite(configuredPoints) ? configuredPoints : defaultResponsePoints[response.responseType] ?? 1

    if (response.responseType === 'feedback') {
      if (interaction?.settings.feedEligible !== false) {
        team.ideas += 1
        const voteSummary = voteSummaryByResponseId.get(response.id) ?? { up: 0, down: 0, score: 0 }
        team.votesReceived += voteSummary.up
        team.points += voteSummary.up * 2
        team.points -= voteSummary.down
      }
    }

    if (response.responseType === 'question') {
      team.questions += 1
      const voteSummary = voteSummaryByResponseId.get(response.id) ?? { up: 0, down: 0, score: 0 }
      team.votesReceived += voteSummary.up
      team.points += voteSummary.up
    }

    teamSummary.set(team.team, team)
  }

  const teamLeaderboard = [...teamSummary.values()]
    .map((team) => ({
      team: team.team,
      points: team.points,
      contributors: team.contributors.size,
      contributions: team.contributions,
      ideas: team.ideas,
      questions: team.questions,
      votesReceived: team.votesReceived,
    }))
    .sort((left, right) => right.points - left.points || right.contributions - left.contributions || left.team.localeCompare(right.team))

  const activePollInteractionId = getActivePollInteractionId(event)
  const pollResults = interactions
    .filter((interaction) => interaction.type === 'poll')
    .map((interaction) => {
      const counts = new Map(interaction.options.map((option) => [option, 0]))
      const relevant = responsesForView.filter((response) => response.interactionId === interaction.id)
      for (const response of relevant) {
        const selections = Array.isArray(response.content.selections) ? response.content.selections : []
        for (const selection of selections.map(String)) {
          counts.set(selection, (counts.get(selection) ?? 0) + 1)
        }
      }

      return {
        id: interaction.id,
        prompt: interaction.prompt,
        totalVotes: relevant.length,
        allowMultiple: Boolean(interaction.settings.allowMultiple),
        active: interaction.id === activePollInteractionId,
        options: interaction.options.map((option) => ({
          label: option,
          value: counts.get(option) ?? 0,
        })),
      }
    })
  const activePoll = pollResults.find((poll) => poll.active) ?? null

  const ratingResults = interactions
    .filter((interaction) => interaction.type === 'rating')
    .map((interaction) => {
      const relevant = responsesForView.filter((response) => response.interactionId === interaction.id)
      const values = relevant
        .map((response) => Number(response.content.value))
        .filter((value) => Number.isFinite(value))

      const total = values.reduce((sum, value) => sum + value, 0)
      const scale = Number(interaction.settings.scale ?? 5)

      return {
        id: interaction.id,
        prompt: interaction.prompt,
        average: values.length ? Number((total / values.length).toFixed(1)) : 0,
        responses: values.length,
        scale,
      }
    })

  const reactionTotals = new Map<string, number>()
  for (const response of responsesForView.filter((response) => response.responseType === 'reaction')) {
    const value = String(response.content.value ?? '')
    if (value) {
      reactionTotals.set(value, (reactionTotals.get(value) ?? 0) + 1)
    }
  }

  const analytics = buildAnalytics({
    responses: usableResponses,
    analyses,
    interactions,
    includeHidden,
  })

  const totalResponses = usableResponses.length
  const pollResponseCount = usableResponses.filter((response) => response.responseType === 'poll').length
  const reactionCount = usableResponses.filter((response) => response.responseType === 'reaction').length
  const ratingValues = usableResponses
    .filter((response) => response.responseType === 'rating')
    .map((response) => Number(response.content.value))
    .filter((value) => Number.isFinite(value))
  const avgRating = ratingValues.length
    ? Number((ratingValues.reduce((sum, value) => sum + value, 0) / ratingValues.length).toFixed(1))
    : 0

  return {
    event,
    interactions,
    metrics: {
      totalResponses,
      questionCount: usableResponses.filter((response) => response.responseType === 'question').length,
      pollResponses: pollResponseCount,
      pollParticipation: totalResponses ? Math.round((pollResponseCount / totalResponses) * 100) : 0,
      averageRating: avgRating,
      reactionCount,
      uniqueParticipants: uniqueParticipants.size,
      timeline: [...engagementTimeline.entries()].map(([time, value]) => ({ time, value })),
    },
    analytics,
    questionStream,
    presenterQuestions: questionStream
      .filter((question) =>
        question.moderationState === 'visible' ||
        question.moderationState === 'answered' ||
        question.moderationState === 'pending',
      )
      .slice(0, 12),
    ideaFeed: ideaFeed.slice(0, 9),
    teamLeaderboard,
    activePoll,
    pollResults,
    ratingResults,
    reactionTotals: [...reactionTotals.entries()].map(([label, value]) => ({ label, value })),
  }
}

async function verifyConvexReachability() {
  try {
    const base = config.convexHttpActionsUrl.endsWith('/')
      ? config.convexHttpActionsUrl
      : `${config.convexHttpActionsUrl}/`
    const healthUrl = new URL('/health', base)
    const syncUrl = new URL('/sync-snapshot', base)

    const healthResp = await fetch(healthUrl, { method: 'GET' })
      .catch(() => ({ ok: false, status: 0, text: async () => '' })) as Response
    if (!healthResp.ok) {
      const detail = await healthResp.text().catch(() => '')
      throw new Error(
        `Health endpoint returned ${String(healthResp.status || 'no status')}. ` +
        `If this persists, run \`npx convex deploy\` to push the HTTP routes to Convex. ` +
        `Body: ${detail.slice(0, 120)}`,
      )
    }

    const probeResp = await fetch(syncUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-pulseroom-sync-secret': config.convexSyncSecret,
      },
      body: JSON.stringify({}),
    }).catch(() => ({ ok: false, status: 0, text: async () => '' })) as Response

    const probeStatus = probeResp.status
    const probeBody = await probeResp.text().catch(() => '')

    if (probeStatus === 404) {
      throw new Error(
        `The /sync-snapshot route is not yet deployed on Convex (got 404). ` +
        `Run: npx convex login && npx convex deploy --message "Add sync-snapshot route"`,
      )
    }
    if (probeStatus === 500 && probeBody.includes('Sync secret is not configured')) {
      throw new Error(
        `CONVEX_SYNC_SECRET is not set on the Convex deployment. ` +
        `Add it via the Convex dashboard → Settings → Environment Variables, then re-deploy.`,
      )
    }
    if (![400, 401, 200].includes(probeStatus)) {
      throw new Error(
        `Unexpected probe response from /sync-snapshot: ${probeStatus}. Body: ${probeBody.slice(0, 120)}`,
      )
    }

    console.log('Convex connectivity check passed.')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error.'
    console.warn(`Convex connectivity check failed — sync will retry in the background. Detail: ${message}`)
  }
}

function scheduleConvexRetry(eventId: string, tries: number) {
  if (convexRetryTimers.has(eventId)) {
    return
  }
  const delayMs = convexBackoffMs(tries)
  const timer = setTimeout(() => {
    convexRetryTimers.delete(eventId)
    void broadcastEvent(eventId)
  }, delayMs)
  convexRetryTimers.set(eventId, timer)
}

function scheduleStaleConvexRetries() {
  const pending = listConvexSyncFailures()
  if (pending.length === 0) return
  const now = Date.now()
  for (const state of pending) {
    const dueAtMs = new Date(state.nextRetryAt).getTime()
    const waitMs = Math.max(0, dueAtMs - now)
    console.log(
      `Convex pending retry: event=${state.eventId} tries=${state.tries} lastError=${state.lastError ?? 'n/a'} retryInMs=${waitMs}`,
    )
    const timer = setTimeout(() => {
      convexRetryTimers.delete(state.eventId)
      void broadcastEvent(state.eventId)
    }, waitMs)
    convexRetryTimers.set(state.eventId, timer)
  }
}

async function syncEventToConvex(publicSnapshot: NonNullable<ReturnType<typeof buildEventSnapshot>>) {
  if (!config.enableConvexPublicSync || !config.convexHttpActionsUrl || !config.convexSyncSecret) {
    return
  }

  const endpoint = new URL('/sync-snapshot', config.convexHttpActionsUrl.endsWith('/') ? config.convexHttpActionsUrl : `${config.convexHttpActionsUrl}/`)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-pulseroom-sync-secret': config.convexSyncSecret,
  }
  const updatedAt = new Date().toISOString()
  const eventId = publicSnapshot.event.id

  touchConvexSyncState(eventId, updatedAt)

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        eventId,
        code: publicSnapshot.event.code,
        publicSnapshot,
        updatedAt,
      }),
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Convex sync returned ${response.status}: ${body.slice(0, 200)}`)
    }

    markConvexSyncSuccess(eventId)
    if (convexSyncWarned) {
      convexSyncWarned = false
      console.log(`Convex sync recovered for event ${eventId}.`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown sync failure.'
    const nextRetryAt = new Date(Date.now() + convexBackoffMs(0)).toISOString()
    markConvexSyncFailure(eventId, message, nextRetryAt)
    if (!convexSyncWarned) {
      console.warn(`Convex sync failed for event ${eventId}: ${message}. Will retry in background.`)
      convexSyncWarned = true
    }
    const pending = listConvexSyncFailures().find((s) => s.eventId === eventId)
    scheduleConvexRetry(eventId, pending?.tries ?? 1)
  }
}

async function broadcastEvent(eventId: string) {
  const admin = buildEventSnapshot(eventId, true)
  const publicView = buildEventSnapshot(eventId, false)
  if (!admin || !publicView) {
    return
  }

  io.to(`event:${eventId}:admin`).emit('event:update-admin', admin)
  io.to(`event:${eventId}:public`).emit('event:update-public', publicView)
  void syncEventToConvex(publicView)
}

function queueAnalysis(eventId: string, responseId: string, text: string) {
  setTimeout(async () => {
    const result = analyseText(text)
    createOrReplaceAnalysis({
      responseId,
      eventId,
      sentiment: result.sentiment,
      keywords: result.keywords,
      themes: result.themes,
      summary: result.summary,
    })
    await broadcastEvent(eventId)
  }, 0)
}

function seedMissingAnalyses() {
  for (const event of listEvents()) {
    const analyses = listAnalyses(event.id)
    const existing = new Set(analyses.map((analysis) => analysis.responseId))
    for (const response of listResponses(event.id)) {
      if ((response.responseType === 'question' || response.responseType === 'feedback') && !existing.has(response.id)) {
        const text = String(response.content.text ?? '')
        if (text) {
          const result = analyseText(text)
          createOrReplaceAnalysis({
            responseId: response.id,
            eventId: event.id,
            sentiment: result.sentiment,
            keywords: result.keywords,
            themes: result.themes,
            summary: result.summary,
          })
        }
      }
    }
  }
}

seedMissingAnalyses()

if (config.enableConvexPublicSync) {
  for (const event of listEvents()) {
    void broadcastEvent(event.id)
  }
}

app.get('/api/health', (_req, res) => {
  const pending = listConvexSyncFailures().length
  const organizers = listOrganizers()
  res.json({
    ok: true,
    mode: config.nodeEnv,
    analysisProvider: config.analysisProvider,
    auth: {
      organizerCount: organizers.length,
      canRegister: canRegisterOrganizer(),
      allowOrganizerSignup: config.allowOrganizerSignup,
      organizers: organizers.map((o) => ({ emailMasked: maskEmail(o.email), createdAt: o.createdAt })),
    },
    convex: {
      enabled: config.enableConvexPublicSync,
      url: config.enableConvexPublicSync ? config.convexUrl : null,
      pendingFailures: pending,
    },
  })
})

app.get('/api/demo', (_req, res) => {
  const demo = config.enableDemoSeed ? listEvents().find((event) => event.isDemo) : null
  res.json({ demoEnabled: config.enableDemoSeed, demoCode: demo?.code ?? null })
})

app.get('/api/auth/session', (req, res) => {
  const lookup = getOrganizerFromRequest(req)
  res.json({
    authenticated: Boolean(lookup),
    organizer: authSummary(lookup?.organizer ?? null),
    canRegister: canRegisterOrganizer(),
  })
})

app.post('/api/auth/register', (req, res) => {
  if (!canRegisterOrganizer()) {
    const total = countOrganizers()
    const hint = total === 0
      ? ''
      : ' Set ALLOW_ORGANIZER_SIGNUP=true in the deployment environment to allow additional organizer accounts.'
    res.status(403).json({
      error: `Organizer signup is disabled for this deployment.${hint}`,
    })
    return
  }

  const parsed = registerSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Use a valid email and a password with at least 8 characters.' })
    return
  }

  const email = parsed.data.email.trim().toLowerCase()
  if (getOrganizerByEmail(email)) {
    res.status(409).json({ error: 'An organizer account with this email already exists.' })
    return
  }

  const organizer = createOrganizer({
    email,
    passwordHash: hashPassword(parsed.data.password),
  })
  const session = createOrganizerSession(organizer.id)
  setSessionCookie(res, session.id)
  res.status(201).json({
    authenticated: true,
    organizer: authSummary(organizer),
    canRegister: canRegisterOrganizer(),
  })
})

app.post('/api/auth/login', (req, res) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Use a valid email and password.' })
    return
  }

  const organizer = getOrganizerByEmail(parsed.data.email)
  if (!organizer || !verifyPassword(parsed.data.password, organizer.passwordHash)) {
    res.status(401).json({ error: 'Incorrect email or password.' })
    return
  }

  const session = createOrganizerSession(organizer.id)
  setSessionCookie(res, session.id)
  res.json({
    authenticated: true,
    organizer: authSummary(organizer),
    canRegister: canRegisterOrganizer(),
  })
})

app.post('/api/auth/logout', (req, res) => {
  const sessionId = typeof req.cookies.organizer_session === 'string' ? req.cookies.organizer_session : ''
  if (sessionId) {
    deleteOrganizerSession(sessionId)
  }
  clearSessionCookie(res)
  res.json({ ok: true })
})

app.get('/api/admin/events', requireOrganizer, (req, res) => {
  const organizer = (req as OrganizerRequest).organizer
  res.json({ events: listEventsForOrganizer(organizer.id) })
})

app.post('/api/admin/events', requireOrganizer, (req, res) => {
  const parsed = eventSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid event payload.' })
    return
  }

  const organizer = (req as OrganizerRequest).organizer
  const event = createEvent({
    organizerId: organizer.id,
    ...parsed.data,
  })
  createDefaultInteractions(event.id)
  res.status(201).json({ event })
})

app.get('/api/admin/events/:eventId', requireOrganizer, (req, res) => {
  const organizer = (req as OrganizerRequest).organizer
  const event = ensureEventAccess(String(req.params.eventId), organizer.id)
  if (!event) {
    res.status(404).json({ error: 'Event not found.' })
    return
  }

  const snapshot = buildEventSnapshot(event.id, true)
  res.json(snapshot)
})

app.put('/api/admin/events/:eventId', requireOrganizer, (req, res) => {
  const parsed = eventSchema.partial().safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid event update.' })
    return
  }

  const organizer = (req as OrganizerRequest).organizer
  const current = ensureEventAccess(String(req.params.eventId), organizer.id)
  if (!current) {
    res.status(404).json({ error: 'Event not found.' })
    return
  }

  const event = updateEvent(current.id, parsed.data)
  if (!event) {
    res.status(404).json({ error: 'Event not found.' })
    return
  }

  void broadcastEvent(event.id)
  res.json({ event })
})

app.post('/api/admin/events/:eventId/interactions', requireOrganizer, (req, res) => {
  const parsed = interactionSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid interaction.' })
    return
  }

  const organizer = (req as OrganizerRequest).organizer
  const event = ensureEventAccess(String(req.params.eventId), organizer.id)
  if (!event) {
    res.status(404).json({ error: 'Event not found.' })
    return
  }

  const interaction = createInteraction({
    eventId: event.id,
    ...parsed.data,
  })
  void broadcastEvent(event.id)
  res.status(201).json({ interaction })
})

app.post('/api/admin/events/:eventId/interactions/import', requireOrganizer, (req, res) => {
  const parsed = interactionImportSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid interaction import file. Use 1 to 100 valid interactions.' })
    return
  }

  const organizer = (req as OrganizerRequest).organizer
  const event = ensureEventAccess(String(req.params.eventId), organizer.id)
  if (!event) {
    res.status(404).json({ error: 'Event not found.' })
    return
  }

  const existingCount = listInteractions(event.id).length
  const interactions = parsed.data.interactions.map((item, index) =>
    createInteraction({
      eventId: event.id,
      ...item,
      ordering: item.ordering ?? existingCount + index + 1,
    }),
  )

  void broadcastEvent(event.id)
  res.status(201).json({ interactions, importedCount: interactions.length })
})

app.put('/api/admin/interactions/:interactionId', requireOrganizer, (req, res) => {
  const parsed = interactionSchema.partial().safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid interaction update.' })
    return
  }

  const organizer = (req as OrganizerRequest).organizer
  const current = getInteraction(String(req.params.interactionId))
  if (!current) {
    res.status(404).json({ error: 'Interaction not found.' })
    return
  }

  const event = ensureEventAccess(current.eventId, organizer.id)
  if (!event) {
    res.status(404).json({ error: 'Interaction not found.' })
    return
  }

  const interaction = updateInteraction(current.id, parsed.data)
  if (!interaction) {
    res.status(404).json({ error: 'Interaction not found.' })
    return
  }

  void broadcastEvent(event.id)
  res.json({ interaction })
})

app.patch('/api/admin/responses/:responseId', requireOrganizer, (req, res) => {
  const schema = z.object({
    moderationState: z.enum(['pending', 'visible', 'hidden', 'answered', 'deleted']).optional(),
    highlighted: z.boolean().optional(),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid moderation update.' })
    return
  }

  const organizer = (req as OrganizerRequest).organizer
  const current = getResponse(String(req.params.responseId))
  if (!current) {
    res.status(404).json({ error: 'Response not found.' })
    return
  }

  const event = ensureEventAccess(current.eventId, organizer.id)
  if (!event) {
    res.status(404).json({ error: 'Response not found.' })
    return
  }

  const updated = updateResponseModeration(
    current.id,
    parsed.data.moderationState ?? current.moderationState,
    parsed.data.highlighted,
  )

  if (!updated) {
    res.status(404).json({ error: 'Response not found.' })
    return
  }

  void broadcastEvent(event.id)
  res.json({ response: updated })
})

app.get('/api/events/code/:code', (req, res) => {
  const event = getEventByCode(String(req.params.code))
  if (!event || event.status !== 'active') {
    res.status(404).json({ error: 'Event not found or inactive.' })
    return
  }

  const interactions = listInteractions(event.id).filter((interaction) => interaction.status === 'active')
  const snapshot = buildEventSnapshot(event.id, false)
  res.json({
    event,
    interactions,
    snapshot,
    privacy: {
      notice:
        'Responses stay anonymous. The app stores your chosen nickname, team, submissions, vote activity, timestamps, moderation state, and derived analysis for this room, but does not collect names, emails, or attendee accounts.',
    },
    convex: {
      enabled: config.enableConvexPublicSync,
      url: config.enableConvexPublicSync ? config.convexUrl : null,
    },
  })
})

app.get('/api/events/code/:code/presenter', (req, res) => {
  const event = getEventByCode(String(req.params.code))
  if (!event || event.status !== 'active') {
    res.status(404).json({ error: 'Event not found or inactive.' })
    return
  }

  const snapshot = buildEventSnapshot(event.id, false)
  res.json({
    snapshot,
    convex: {
      enabled: config.enableConvexPublicSync,
      url: config.enableConvexPublicSync ? config.convexUrl : null,
    },
  })
})

app.post('/api/events/code/:code/responses', (req, res) => {
  const event = getEventByCode(String(req.params.code))
  if (!event || event.status !== 'active') {
    res.status(404).json({ error: 'Event not found or inactive.' })
    return
  }

  const parsedAttendee = attendeeProfileSchema.safeParse(req.body?.attendee)
  if (!parsedAttendee.success) {
    res.status(400).json({ error: 'Choose an anonymous nickname and team before joining the townhall.' })
    return
  }
  const attendee = normalizeProfile(parsedAttendee.data)
  if (!getConfiguredTeams(event).includes(attendee.team)) {
    res.status(400).json({ error: 'Choose a valid townhall team.' })
    return
  }

  const interaction = getInteraction(String(req.body?.interactionId ?? ''))
  if (!interaction || interaction.eventId !== event.id || interaction.status !== 'active') {
    res.status(400).json({ error: 'Interaction is unavailable.' })
    return
  }

  const rateKey = `${req.ip}:${attendee.attendeeKey}:${event.id}:${interaction.id}`
  const lastSubmission = lastSubmissionByKey.get(rateKey) ?? 0
  if (Date.now() - lastSubmission < rateLimitWindowMs) {
    res.status(429).json({ error: 'Please wait a moment before submitting again.' })
    return
  }
  lastSubmissionByKey.set(rateKey, Date.now())

  let content: Record<string, unknown>
  let moderationState: 'pending' | 'visible'

  switch (interaction.type) {
    case 'question':
    case 'feedback': {
      const schema = z.object({ text: z.string().min(3).max(400) })
      const parsed = schema.safeParse(req.body)
      if (!parsed.success) {
        res.status(400).json({ error: 'Text responses must be between 3 and 400 characters.' })
        return
      }
      content = { text: parsed.data.text.trim(), ...attendee }
      moderationState = 'visible'
      break
    }
    case 'rating': {
      const scale = Number(interaction.settings.scale ?? 5)
      const schema = z.object({ value: z.number().int().min(1).max(scale) })
      const parsed = schema.safeParse(req.body)
      if (!parsed.success) {
        res.status(400).json({ error: `Choose a rating between 1 and ${scale}.` })
        return
      }
      content = { value: parsed.data.value, ...attendee }
      moderationState = 'visible'
      break
    }
    case 'poll': {
      const schema = z.object({ selections: z.array(z.string()).min(1) })
      const parsed = schema.safeParse(req.body)
      const allowMultiple = Boolean(interaction.settings.allowMultiple)
      if (!parsed.success) {
        res.status(400).json({ error: 'Select at least one poll option.' })
        return
      }
      if (!allowMultiple && parsed.data.selections.length > 1) {
        res.status(400).json({ error: 'This poll only allows a single option.' })
        return
      }
      if (parsed.data.selections.some((selection) => !interaction.options.includes(selection))) {
        res.status(400).json({ error: 'One or more selected options are invalid.' })
        return
      }
      content = { selections: parsed.data.selections, ...attendee }
      moderationState = 'visible'
      break
    }
    case 'reaction': {
      const schema = z.object({ value: z.string().min(1) })
      const parsed = schema.safeParse(req.body)
      if (!parsed.success || !interaction.options.includes(parsed.data.value)) {
        res.status(400).json({ error: 'Choose a valid reaction.' })
        return
      }
      content = { value: parsed.data.value, ...attendee }
      moderationState = 'visible'
      break
    }
    default:
      res.status(400).json({ error: 'Unsupported interaction.' })
      return
  }

  const response = createResponse({
    eventId: event.id,
    interactionId: interaction.id,
    responseType: interaction.type,
    content,
    moderationState,
  })

  if (interaction.type === 'question' || interaction.type === 'feedback') {
    queueAnalysis(event.id, response.id, String(content.text ?? ''))
  }

  void broadcastEvent(event.id)
  res.status(201).json({
    responseId: response.id,
    message: `${toTitle(interaction.type)} captured successfully.`,
  })
})

app.post('/api/events/code/:code/responses/:responseId/vote', (req, res) => {
  const event = getEventByCode(String(req.params.code))
  if (!event || event.status !== 'active') {
    res.status(404).json({ error: 'Event not found or inactive.' })
    return
  }

  const response = getResponse(String(req.params.responseId))
  if (!response || response.eventId !== event.id || response.responseType !== 'feedback') {
    res.status(404).json({ error: 'Idea not found.' })
    return
  }

  const parsedAttendee = attendeeProfileSchema.safeParse(req.body?.attendee)
  const parsedVote = z.object({ direction: z.enum(['up', 'down']) }).safeParse(req.body)
  if (!parsedAttendee.success || !parsedVote.success) {
    res.status(400).json({ error: 'Valid attendee and vote direction are required.' })
    return
  }

  const attendee = normalizeProfile(parsedAttendee.data)
  const author = getAttendeeMeta(response.content)
  if (author.attendeeKey && author.attendeeKey === attendee.attendeeKey) {
    res.status(400).json({ error: 'You cannot vote on your own idea.' })
    return
  }

  upsertResponseVote({
    eventId: event.id,
    responseId: response.id,
    voterKey: attendee.attendeeKey,
    direction: parsedVote.data.direction,
  })

  void broadcastEvent(event.id)
  res.json({ ok: true })
})

app.post('/api/events/code/:code/questions/:responseId/upvote', (req, res) => {
  const event = getEventByCode(String(req.params.code))
  if (!event || event.status !== 'active') {
    res.status(404).json({ error: 'Event not found or inactive.' })
    return
  }

  const response = getResponse(String(req.params.responseId))
  if (!response || response.eventId !== event.id || response.responseType !== 'question') {
    res.status(404).json({ error: 'Question not found.' })
    return
  }

  const parsedAttendee = attendeeProfileSchema.safeParse(req.body?.attendee)
  if (!parsedAttendee.success) {
    res.status(400).json({ error: 'A valid attendee profile is required.' })
    return
  }

  const attendee = normalizeProfile(parsedAttendee.data)
  const author = getAttendeeMeta(response.content)
  if (author.attendeeKey && author.attendeeKey === attendee.attendeeKey) {
    res.status(400).json({ error: 'You cannot upvote your own question.' })
    return
  }

  upsertResponseVote({
    eventId: event.id,
    responseId: response.id,
    voterKey: attendee.attendeeKey,
    direction: 'up',
  })

  void broadcastEvent(event.id)
  res.json({ ok: true })
})

io.on('connection', (socket) => {
  socket.on('event:join-public', (eventId: string) => {
    const snapshot = buildEventSnapshot(eventId, false)
    if (!snapshot) {
      return
    }

    socket.join(`event:${eventId}:public`)
    socket.emit('event:update-public', snapshot)
  })

  socket.on('event:join-admin', (eventId: string) => {
    const cookies = parseCookieHeader(socket.handshake.headers.cookie)
    const sessionId = cookies.get('organizer_session') ?? ''
    const lookup = sessionId ? getOrganizerSession(sessionId) : null
    const event = lookup ? ensureEventAccess(eventId, lookup.organizer.id) : null
    if (!lookup || !event) {
      socket.emit('event:error', { message: 'Organizer session required for admin stream.' })
      return
    }

    const snapshot = buildEventSnapshot(event.id, true)
    if (!snapshot) {
      return
    }

    socket.join(`event:${eventId}:admin`)
    socket.emit('event:update-admin', snapshot)
  })
})

const distPath = path.resolve(process.cwd(), 'dist')
if (config.isProduction && fs.existsSync(distPath)) {
  app.use(express.static(distPath))
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) {
      next()
      return
    }
    res.sendFile(path.join(distPath, 'index.html'))
  })
}

server.listen(config.port, () => {
  console.log(`PulseRoom running on ${config.appUrl}`)
})
