export function resolveCssVar(token: string, fallback: string) {
  if (typeof window === 'undefined') return fallback
  const match = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
  return match || fallback
}
