import { ConvexReactClient } from 'convex/react'
import { api as convexApi } from '../../convex/_generated/api'

const buildTimeUrl = (import.meta.env.VITE_CONVEX_URL as string | undefined)?.trim() ?? ''
const buildTimeEnabled = import.meta.env.VITE_ENABLE_CONVEX_PUBLIC_SYNC === 'true'

let runtimeOverrides: { enabled: boolean; url: string | null } | null = null

export function setConvexRuntimeConfig(overrides: { enabled: boolean; url: string | null }) {
  runtimeOverrides = overrides
}

function getEnabled() {
  if (runtimeOverrides) return runtimeOverrides.enabled
  return buildTimeEnabled
}

function getUrl() {
  if (runtimeOverrides && runtimeOverrides.url) return runtimeOverrides.url
  return buildTimeUrl || null
}

let cachedClient: ConvexReactClient | null = null
let lastCachedUrl: string | null = null

export function getConvexClient(): ConvexReactClient | null {
  if (!getEnabled()) return null
  const url = getUrl()
  if (!url) return null
  if (cachedClient && lastCachedUrl === url) {
    return cachedClient
  }
  cachedClient = new ConvexReactClient(url)
  lastCachedUrl = url
  return cachedClient
}

export const convexPublicSyncEnabled = {
  enabled: getEnabled,
  url: getUrl,
}

export const convexQueries = {
  getPublicByCode: convexApi.snapshots.getPublicByCode,
}
