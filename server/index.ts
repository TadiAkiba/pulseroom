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
  listEvents,
  listEventsForOrganizer,
  listInteractions,
  listResponses,
  listResponseVotes,
  type InteractionType,
  type OrganizerRecord,
  upsertResponseVote,
  updateEvent,
  updateInteraction,
  updateResponseModeration,
} from './db.ts'
import { hashPassword, verifyPassword } from './security.ts'

type OrganizerRequest = express.Request & {
  organizer: OrganizerRecord
}

const rateLimitWindowMs = 2000
const lastSubmissionByKey = new Map<string, number>()
let convexSyncWarned = false

initializeDatabase()
bootstrapOrganizer()

if (config.enableDemoSeed) {
  ensureDemoEvent(getOrganizerByEmail(config.bootstrapOrganizerEmail)?.id)
}

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

function bootstrapOrganizer() {
  const email = config.bootstrapOrganizerEmail
  const password = config.bootstrapOrganizerPassword

  if (!email && !password) {
    return
  }

  if (!email || !password) {
    console.warn('Bootstrap organizer credentials are incomplete. Skipping bootstrap organizer creation.')
    return
  }

  if (!getOrganizerByEmail(email)) {
    createOrganizer({
      email,
      passwordHash: hashPassword(password),
    })
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
    httpOnly: true,
    sameSite: config.usesCrossSiteCookies ? 'none' : 'lax',
    secure: config.isProduction || config.usesCrossSiteCookies,
    maxAge: config.sessionTtlHours * 60 * 60 * 1000,
  })
}

function clearSessionCookie(res: express.Response) {
  res.clearCookie('organizer_session', {
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
  const lookup = getOrganizerFromRequest(req)
  if (!lookup) {
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
      type: 'feedback',
      prompt: 'What is your AI idea?',
      settings: {
        formKey: 'idea',
        formTitle: 'AI Idea',
        formDescription: 'Tell us in your own words.',
        questionNumber: 1,
        questionCount: 5,
        points: 10,
        feedEligible: true,
      },
      ordering: 1,
    }),
    createInteraction({
      eventId,
      type: 'poll',
      prompt: 'What would this improve?',
      options: [
        'Customer experience',
        'Employee experience',
        'Productivity',
        'Cost / efficiency',
        'Decision-making',
        'Revenue / growth',
        'Risk / compliance',
        'Something else',
      ],
      settings: {
        formKey: 'idea',
        formTitle: 'AI Idea',
        questionNumber: 2,
        questionCount: 5,
        allowMultiple: true,
        points: 2,
      },
      ordering: 2,
    }),
    createInteraction({
      eventId,
      type: 'poll',
      prompt: 'Who would benefit most?',
      options: ['Customers', 'Employees', 'Managers', 'The business', 'Everyone'],
      settings: {
        formKey: 'idea',
        formTitle: 'AI Idea',
        questionNumber: 3,
        questionCount: 5,
        allowMultiple: false,
        points: 2,
      },
      ordering: 3,
    }),
    createInteraction({
      eventId,
      type: 'rating',
      prompt: 'How valuable do you think this could be?',
      settings: {
        formKey: 'idea',
        formTitle: 'AI Idea',
        questionNumber: 4,
        questionCount: 5,
        scale: 4,
        labels: ['Low', 'Medium', 'High', 'Game-changing'],
        points: 3,
      },
      ordering: 4,
    }),
    createInteraction({
      eventId,
      type: 'poll',
      prompt: 'How easy do you think it would be to implement?',
      options: ['Easy', 'Moderate', 'Difficult', 'Not sure'],
      settings: {
        formKey: 'idea',
        formTitle: 'AI Idea',
        questionNumber: 5,
        questionCount: 5,
        allowMultiple: false,
        points: 2,
      },
      ordering: 5,
    }),
    createInteraction({
      eventId,
      type: 'feedback',
      prompt: 'Where do you see an opportunity for AI?',
      settings: {
        formKey: 'opportunity',
        formTitle: 'AI Opportunity',
        questionNumber: 1,
        questionCount: 5,
        feedEligible: true,
        points: 8,
      },
      ordering: 6,
    }),
    createInteraction({
      eventId,
      type: 'feedback',
      prompt: 'What problem could AI solve?',
      settings: {
        formKey: 'opportunity',
        formTitle: 'AI Opportunity',
        questionNumber: 2,
        questionCount: 5,
        feedEligible: true,
        points: 6,
      },
      ordering: 7,
    }),
    createInteraction({
      eventId,
      type: 'poll',
      prompt: 'How often does this problem occur?',
      options: ['Daily', 'Weekly', 'Monthly', 'Occasionally'],
      settings: {
        formKey: 'opportunity',
        formTitle: 'AI Opportunity',
        questionNumber: 3,
        questionCount: 5,
        allowMultiple: false,
        points: 2,
      },
      ordering: 8,
    }),
    createInteraction({
      eventId,
      type: 'poll',
      prompt: 'What would the impact be?',
      options: [
        'Save time',
        'Reduce costs',
        'Improve quality',
        'Improve customer experience',
        'Increase revenue',
        'Reduce risk',
        'Other',
      ],
      settings: {
        formKey: 'opportunity',
        formTitle: 'AI Opportunity',
        questionNumber: 4,
        questionCount: 5,
        allowMultiple: false,
        points: 2,
      },
      ordering: 9,
    }),
    createInteraction({
      eventId,
      type: 'rating',
      prompt: 'How excited are you about this opportunity?',
      settings: {
        formKey: 'opportunity',
        formTitle: 'AI Opportunity',
        questionNumber: 5,
        questionCount: 5,
        scale: 4,
        labels: ['Not yet', 'Curious', 'Excited', 'Very excited'],
        points: 2,
      },
      ordering: 10,
    }),
    createInteraction({
      eventId,
      type: 'poll',
      prompt: 'What concerns you most about AI?',
      options: [
        'Job security',
        'Privacy',
        'Data security',
        'Incorrect information',
        'Bias / unfair decisions',
        'Loss of human interaction',
        'Lack of understanding',
        'Too much change',
        'Something else',
      ],
      settings: {
        formKey: 'concern',
        formTitle: 'AI Concern',
        formDescription: 'There are no wrong answers. Your response is anonymous.',
        questionNumber: 1,
        questionCount: 4,
        allowMultiple: false,
        points: 3,
      },
      ordering: 11,
    }),
    createInteraction({
      eventId,
      type: 'feedback',
      prompt: 'Tell us more.',
      settings: {
        formKey: 'concern',
        formTitle: 'AI Concern',
        questionNumber: 2,
        questionCount: 4,
        feedEligible: false,
        points: 4,
      },
      ordering: 12,
    }),
    createInteraction({
      eventId,
      type: 'rating',
      prompt: 'How concerned are you?',
      settings: {
        formKey: 'concern',
        formTitle: 'AI Concern',
        questionNumber: 3,
        questionCount: 4,
        scale: 4,
        labels: ['Not concerned', 'Slightly concerned', 'Concerned', 'Very concerned'],
        points: 2,
      },
      ordering: 13,
    }),
    createInteraction({
      eventId,
      type: 'feedback',
      prompt: 'What would make you feel more comfortable with AI?',
      settings: {
        formKey: 'concern',
        formTitle: 'AI Concern',
        questionNumber: 4,
        questionCount: 4,
        feedEligible: false,
        helperText: 'This is especially useful because it turns fear into action.',
        points: 6,
      },
      ordering: 14,
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
      return response.moderationState === 'visible' || response.moderationState === 'answered'
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
    .map((response) => ({
      id: response.id,
      interactionId: response.interactionId,
      interactionPrompt: interactionById.get(response.interactionId)?.prompt ?? 'Question',
      text: String(response.content.text ?? ''),
      createdAt: response.createdAt,
      timeLabel: formatTime(response.createdAt),
      moderationState: response.moderationState,
      highlighted: response.highlighted,
    }))

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
        options: interaction.options.map((option) => ({
          label: option,
          value: counts.get(option) ?? 0,
        })),
      }
    })

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
    presenterQuestions: questionStream.filter((question) => question.moderationState !== 'hidden').slice(0, 12),
    ideaFeed,
    teamLeaderboard,
    pollResults,
    ratingResults,
    reactionTotals: [...reactionTotals.entries()].map(([label, value]) => ({ label, value })),
  }
}

async function syncEventToConvex(
  adminSnapshot: NonNullable<ReturnType<typeof buildEventSnapshot>>,
  publicSnapshot: NonNullable<ReturnType<typeof buildEventSnapshot>>,
) {
  if (!config.enableConvexPublicSync || !config.convexHttpActionsUrl) {
    return
  }

  const endpoint = new URL('/sync-snapshot', config.convexHttpActionsUrl.endsWith('/') ? config.convexHttpActionsUrl : `${config.convexHttpActionsUrl}/`)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (config.convexSyncSecret) {
    headers['x-pulseroom-sync-secret'] = config.convexSyncSecret
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        eventId: adminSnapshot.event.id,
        code: adminSnapshot.event.code,
        adminSnapshot,
        publicSnapshot,
        updatedAt: new Date().toISOString(),
      }),
    })

    if (!response.ok) {
      throw new Error(`Convex sync returned ${response.status}.`)
    }
  } catch (error) {
    if (!convexSyncWarned) {
      const message = error instanceof Error ? error.message : 'Unknown sync failure.'
      console.warn(`Convex sync is enabled but could not push snapshots: ${message}`)
      convexSyncWarned = true
    }
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
  void syncEventToConvex(admin, publicView)
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
  res.json({
    ok: true,
    mode: config.nodeEnv,
    analysisProvider: config.analysisProvider,
    convex: {
      enabled: config.enableConvexPublicSync,
      urlConfigured: Boolean(config.convexUrl),
      httpActionsConfigured: Boolean(config.convexHttpActionsUrl),
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
    res.status(403).json({ error: 'Organizer signup is disabled for this deployment.' })
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
  })
})

app.get('/api/events/code/:code/presenter', (req, res) => {
  const event = getEventByCode(String(req.params.code))
  if (!event || event.status !== 'active') {
    res.status(404).json({ error: 'Event not found or inactive.' })
    return
  }

  const snapshot = buildEventSnapshot(event.id, false)
  res.json(snapshot)
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
      moderationState = interaction.type === 'question' ? 'pending' : 'visible'
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
    message:
      interaction.type === 'question'
        ? 'Question received. It is waiting for organiser approval before appearing publicly.'
        : `${toTitle(interaction.type)} captured successfully.`,
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
