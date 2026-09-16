import { ConvexReactClient } from 'convex/react'
import { api as convexApi } from '../../convex/_generated/api'

const fallbackConvexUrl = 'https://charming-shrimp-707.convex.cloud'

export const convexUrl = import.meta.env.VITE_CONVEX_URL?.trim() || fallbackConvexUrl
export const convexPublicSyncEnabled = import.meta.env.VITE_ENABLE_CONVEX_PUBLIC_SYNC === 'true'
export const convexClient = new ConvexReactClient(convexUrl)

export const convexQueries = {
  getPublicByCode: convexApi.snapshots.getPublicByCode,
}
