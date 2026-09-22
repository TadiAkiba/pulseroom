import { internalMutation, query } from './_generated/server'
import { v } from 'convex/values'

const viewValidator = v.union(v.literal('public'), v.literal('admin'))

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

const snapshotPayloadValidator = v.object({
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

export const getPublicByCode = query({
  args: {
    code: v.string(),
  },
  handler: async (ctx, args) => {
    const normalizedCode = args.code.trim().toUpperCase()
    const snapshot = await ctx.db
      .query('eventSnapshots')
      .withIndex('by_code_view', (q) => q.eq('code', normalizedCode).eq('view', 'public'))
      .unique()

    return snapshot?.payload ?? null
  },
})

export const syncSnapshot = internalMutation({
  args: {
    eventId: v.string(),
    code: v.string(),
    view: viewValidator,
    payload: snapshotPayloadValidator,
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const normalizedCode = args.code.trim().toUpperCase()
    const existing = await ctx.db
      .query('eventSnapshots')
      .withIndex('by_event_view', (q) => q.eq('eventId', args.eventId).eq('view', args.view))
      .unique()

    if (args.view === 'public') {
      const staleAdmin = await ctx.db
        .query('eventSnapshots')
        .withIndex('by_event_view', (q) => q.eq('eventId', args.eventId).eq('view', 'admin'))
        .unique()
      if (staleAdmin) {
        await ctx.db.delete(staleAdmin._id)
      }
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        code: normalizedCode,
        payload: args.payload,
        updatedAt: args.updatedAt,
      })
      return existing._id
    }

    return await ctx.db.insert('eventSnapshots', {
      eventId: args.eventId,
      code: normalizedCode,
      view: args.view,
      payload: args.payload,
      updatedAt: args.updatedAt,
    })
  },
})
