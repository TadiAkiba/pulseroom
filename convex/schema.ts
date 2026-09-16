import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  eventSnapshots: defineTable({
    eventId: v.string(),
    code: v.string(),
    view: v.union(v.literal('public'), v.literal('admin')),
    payload: v.any(),
    updatedAt: v.string(),
  })
    .index('by_code_view', ['code', 'view'])
    .index('by_event_view', ['eventId', 'view']),
})
