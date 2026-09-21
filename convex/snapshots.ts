import { internalMutation, query } from './_generated/server'
import { v } from 'convex/values'

const viewValidator = v.union(v.literal('public'), v.literal('admin'))

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
    payload: v.any(),
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
