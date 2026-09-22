import test from 'node:test'
import assert from 'node:assert/strict'
import { RateLimiter } from './rateLimiter.ts'

test('RateLimiter: first request allowed', () => {
  const limiter = new RateLimiter({ windowMs: 1_000, stalePruneMs: 5_000, pruneEveryWrites: 200, maxEntries: 5 })
  const first = limiter.checkAndRecord('a')
  assert.equal(first.allowed, true)
  assert.equal(limiter.size(), 1)
})

test('RateLimiter: second request within window is blocked and returns waitMs', () => {
  const limiter = new RateLimiter({ windowMs: 1_000, stalePruneMs: 5_000, pruneEveryWrites: 200, maxEntries: 5 })
  limiter.checkAndRecord('a', 1_000)
  const second = limiter.checkAndRecord('a', 1_500)
  assert.equal(second.allowed, false)
  assert.equal(second.waitMs, 500)
})

test('RateLimiter: after window elapses, request is allowed again', () => {
  const limiter = new RateLimiter({ windowMs: 1_000, stalePruneMs: 5_000, pruneEveryWrites: 200, maxEntries: 5 })
  limiter.checkAndRecord('a', 0)
  const blocked = limiter.checkAndRecord('a', 999)
  assert.equal(blocked.allowed, false)
  const third = limiter.checkAndRecord('a', 1_001)
  assert.equal(third.allowed, true)
})

test('RateLimiter: pruneEveryWrites drops stale entries before cap is reached', () => {
  const limiter = new RateLimiter({ windowMs: 10, stalePruneMs: 500, pruneEveryWrites: 5, maxEntries: 200 })
  let now = 0
  for (let i = 0; i < 50; i += 1) {
    limiter.checkAndRecord(`k-${i}`, now)
    now += 500
  }
  assert.ok(limiter.size() <= 20, `expected aggressive prune to cap smaller; got ${limiter.size()}`)
})

test('RateLimiter: maxEntries hard cap evicts oldest keys regardless of staleness', () => {
  const limiter = new RateLimiter({ windowMs: 60_000, stalePruneMs: 60_000, pruneEveryWrites: 999, maxEntries: 8 })
  for (let i = 0; i < 30; i += 1) {
    limiter.checkAndRecord(`k-${i}`, Date.now())
  }
  assert.equal(limiter.size(), 8, `hard cap not honored; got ${limiter.size()}`)
})

test('RateLimiter: distinct keys do not interfere', () => {
  const limiter = new RateLimiter({ windowMs: 1_000, stalePruneMs: 5_000, pruneEveryWrites: 50, maxEntries: 20 })
  for (let i = 0; i < 10; i += 1) {
    const r = limiter.checkAndRecord(`k-${i}`, 0)
    assert.equal(r.allowed, true, `k-${i} first submission blocked`)
  }
  assert.equal(limiter.size(), 10)
})

test('RateLimiter: size metric is returned on checkAndRecord', () => {
  const limiter = new RateLimiter({ windowMs: 1_000, stalePruneMs: 5_000, pruneEveryWrites: 50, maxEntries: 10 })
  limiter.checkAndRecord('a')
  limiter.checkAndRecord('b')
  const r = limiter.checkAndRecord('c')
  assert.equal(r.size, 3)
})

test('RateLimiter: startIntervalPrune is idempotent', () => {
  const limiter = new RateLimiter({ windowMs: 1_000, stalePruneMs: 1_000, pruneEveryWrites: 50, maxEntries: 10 })
  limiter.startIntervalPrune(1_000).startIntervalPrune(1_000)
  limiter.checkAndRecord('a', 0)
  limiter.stopIntervalPrune()
  limiter.stopIntervalPrune()
})
