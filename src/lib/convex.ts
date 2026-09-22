import { ConvexReactClient } from 'convex/react'
import { api as convexApi } from '../../convex/_generated/api'

const buildTimeUrl = (import.meta.env.VITE_CONVEX_URL as string | undefined)?.trim() ?? ''
const buildTimeEnabled = import.meta.env.VITE_ENABLE_CONVEX_PUBLIC_SYNC === 'true'

let runtimeOverrides: { enabled: boolean; url: string | null } | null = null

export function setConvexRuntimeConfig(overrides: { enabled: boolean; url: string | null }) {
  runtimeOverrides = overrides
}

export function isConvexEnabled() {
  if (runtimeOverrides) return runtimeOverrides.enabled
  return buildTimeEnabled
}

function getUrl() {
  if (runtimeOverrides && runtimeOverrides.url) return runtimeOverrides.url
  return buildTimeUrl || null
}

const stableClient = (() => {
  const initialUrl = getUrl()
  if (!initialUrl) {
    const placeholder = 'https://pulseroom.convex.invalid'
    return new ConvexReactClient(placeholder)
  }
  return new ConvexReactClient(initialUrl)
})()

export function getConvexClient(): ConvexReactClient {
  return stableClient
}

export const convexPublicSyncEnabled = {
  enabled: isConvexEnabled,
  url: getUrl,
}

export const convexQueries = {
  getPublicByCode: convexApi.snapshots.getPublicByCode,
}
