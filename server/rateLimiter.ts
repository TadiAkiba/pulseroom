export type RateLimiterOptions = {
  windowMs: number
  maxEntries?: number
  stalePruneMs?: number
  pruneEveryWrites?: number
}

export class RateLimiter {
  readonly windowMs: number
  readonly maxEntries: number
  readonly stalePruneMs: number
  readonly pruneEveryWrites: number

  private readonly map = new Map<string, number>()
  private writesSincePrune = 0
  private intervalId: ReturnType<typeof setInterval> | null = null

  constructor(options: RateLimiterOptions) {
    this.windowMs = options.windowMs
    this.maxEntries = options.maxEntries ?? 25_000
    this.stalePruneMs = options.stalePruneMs ?? Math.max(5_000, options.windowMs * 10)
    this.pruneEveryWrites = options.pruneEveryWrites ?? 50
  }

  startIntervalPrune(everyMs = 60_000) {
    if (this.intervalId) return this
    this.intervalId = setInterval(() => {
      this.pruneStale(Date.now())
    }, everyMs)
    if (typeof this.intervalId.unref === 'function') this.intervalId.unref()
    return this
  }

  stopIntervalPrune() {
    if (this.intervalId) clearInterval(this.intervalId)
    this.intervalId = null
    return this
  }

  size() {
    return this.map.size
  }

  entries() {
    return this.map.entries()
  }

  private pruneStale(now: number) {
    if (this.map.size === 0) return
    const cutoff = now - this.stalePruneMs
    for (const [key, ts] of this.map) {
      if (ts <= cutoff) this.map.delete(key)
    }
  }

  private evictOldestIfOverCap(now: number) {
    if (this.map.size <= this.maxEntries) return
    const cutoff = now - this.stalePruneMs
    const overshoot = this.map.size - this.maxEntries
    let evicted = 0
    for (const [key, ts] of this.map) {
      if (evicted >= overshoot) break
      if (ts <= cutoff) {
        this.map.delete(key)
        evicted += 1
      }
    }
    if (this.map.size <= this.maxEntries) return
    const toRemove = this.map.size - this.maxEntries
    let remaining = toRemove
    for (const key of this.map.keys()) {
      if (remaining <= 0) break
      this.map.delete(key)
      remaining -= 1
    }
  }

  checkAndRecord(key: string, now?: number): { allowed: boolean; waitMs?: number; size: number } {
    const t = now ?? Date.now()
    const last = this.map.get(key)
    if (last !== undefined && t - last < this.windowMs) {
      const waitMs = this.windowMs - (t - last)
      return { allowed: false, waitMs, size: this.map.size }
    }
    this.map.set(key, t)
    this.writesSincePrune += 1
    if (this.writesSincePrune >= this.pruneEveryWrites) {
      this.writesSincePrune = 0
      this.pruneStale(t)
    }
    this.evictOldestIfOverCap(t)
    return { allowed: true, size: this.map.size }
  }

  clear() {
    this.map.clear()
    this.writesSincePrune = 0
    return this
  }
}
