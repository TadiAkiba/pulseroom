import { httpRouter } from 'convex/server'
import { httpAction } from './_generated/server'
import { internal } from './_generated/api'
import { v } from 'convex/values'
import type { Infer } from 'convex/values'

const sentimentValidator = v.object({
  positive: v.float64(),
  neutral: v.float64(),
  negative: v.float64(),
})

const ratingResultValidator = v.object({
  id: v.string(),
  prompt: v.string(),
  average: v.float64(),
  responses: v.float64(),
  scale: v.float64(),
})

const payloadShapeValidator = v.object({
  id: v.string(),
  eventId: v.string(),
  code: v.string(),
  name: v.string(),
  description: v.optional(v.string()),
  status: v.union(v.literal('active'), v.literal('inactive')),
  createdAt: v.string(),
  interactions: v.array(v.any()),
  publicResponses: v.record(v.string(), v.array(v.any())),
  questionStream: v.array(v.any()),
  pollResults: v.array(v.any()),
  ratingResults: v.array(ratingResultValidator),
  reactionResults: v.array(v.any()),
  ideaFeed: v.array(v.any()),
  presenterQuestions: v.array(v.any()),
  metrics: v.object({
    totalResponses: v.float64(),
    questionCount: v.float64(),
    pollParticipation: v.float64(),
    averageRating: v.float64(),
    reactionCount: v.float64(),
  }),
  sentimentSeries: v.array(v.any()),
  analytics: v.object({
    sentiment: sentimentValidator,
    themes: v.array(v.any()),
    keywords: v.array(v.any()),
    wordCloud: v.array(v.any()),
    timeline: v.array(v.any()),
    emergingConcerns: v.array(v.string()),
    pendingAnalyses: v.float64(),
    totalTextResponses: v.float64(),
  }),
  convex: v.optional(v.object({
    enabled: v.boolean(),
    url: v.optional(v.union(v.string(), v.null())),
  })),
})

type SnapshotPayloadShape = Infer<typeof payloadShapeValidator>

const http = httpRouter()

http.route({
  path: '/sync-snapshot',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const expectedSecret = process.env.CONVEX_SYNC_SECRET?.trim() ?? ''
    const receivedSecret = request.headers.get('x-pulseroom-sync-secret')?.trim() ?? ''

    if (!expectedSecret) {
      return Response.json(
        { error: 'Sync secret is not configured on this deployment. Set CONVEX_SYNC_SECRET and re-deploy.' },
        { status: 500 },
      )
    }
    if (receivedSecret !== expectedSecret) {
      return Response.json({ error: 'Missing or invalid sync secret.' }, { status: 401 })
    }

    const rawBody = await request.json()
    const body =
      typeof rawBody === 'object' && rawBody !== null
        ? (rawBody as {
            eventId?: string
            code?: string
            publicSnapshot?: unknown
            updatedAt?: string
          })
        : null

    if (
      !body ||
      typeof body.eventId !== 'string' ||
      typeof body.code !== 'string' ||
      typeof body.updatedAt !== 'string' ||
      body.publicSnapshot === undefined
    ) {
      return Response.json({ error: 'Invalid payload.' }, { status: 400 })
    }

    const payload = body.publicSnapshot as SnapshotPayloadShape

    await ctx.runMutation(internal.snapshots.syncSnapshot, {
      eventId: body.eventId,
      code: body.code,
      view: 'public',
      payload,
      updatedAt: body.updatedAt,
    })

    return Response.json({ ok: true })
  }),
})

http.route({
  path: '/health',
  method: 'GET',
  handler: httpAction(async () => Response.json({ ok: true })),
})

export default http
