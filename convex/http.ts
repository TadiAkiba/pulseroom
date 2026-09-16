import { httpRouter } from 'convex/server'
import { httpAction } from './_generated/server'
import { internal } from './_generated/api'

const http = httpRouter()

http.route({
  path: '/sync-snapshot',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const expectedSecret = process.env.CONVEX_SYNC_SECRET?.trim()
    const receivedSecret = request.headers.get('x-pulseroom-sync-secret')?.trim()

    if (expectedSecret && receivedSecret !== expectedSecret) {
      return Response.json({ error: 'Unauthorized.' }, { status: 401 })
    }

    const body = (await request.json()) as {
      eventId?: string
      code?: string
      publicSnapshot?: unknown
      adminSnapshot?: unknown
      updatedAt?: string
    }

    if (
      typeof body.eventId !== 'string' ||
      typeof body.code !== 'string' ||
      typeof body.updatedAt !== 'string' ||
      body.publicSnapshot === undefined ||
      body.adminSnapshot === undefined
    ) {
      return Response.json({ error: 'Invalid payload.' }, { status: 400 })
    }

    await ctx.runMutation(internal.snapshots.syncSnapshot, {
      eventId: body.eventId,
      code: body.code,
      view: 'public',
      payload: body.publicSnapshot,
      updatedAt: body.updatedAt,
    })

    await ctx.runMutation(internal.snapshots.syncSnapshot, {
      eventId: body.eventId,
      code: body.code,
      view: 'admin',
      payload: body.adminSnapshot,
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
