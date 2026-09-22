import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

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

export default defineSchema({
  eventSnapshots: defineTable({
    eventId: v.string(),
    code: v.string(),
    view: v.union(v.literal('public'), v.literal('admin')),
    payload: snapshotPayloadValidator,
    updatedAt: v.string(),
  })
    .index('by_code_view', ['code', 'view'])
    .index('by_event_view', ['eventId', 'view']),
})
