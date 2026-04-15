import { describe, it, expect } from 'vitest'
import { RateLimiter } from '../src/rate-limiter.js'

describe('RateLimiter', () => {
  it('allows messages under the limit', () => {
    const limiter = new RateLimiter({ maxPerMinute: 5 })
    for (let i = 0; i < 5; i++) {
      const result = limiter.check('conn-1')
      expect(result.allowed).toBe(true)
      expect(result.shouldDisconnect).toBe(false)
    }
  })

  it('rejects messages over the limit', () => {
    const limiter = new RateLimiter({ maxPerMinute: 3, maxViolations: 3 })
    limiter.check('conn-1')
    limiter.check('conn-1')
    limiter.check('conn-1')
    const result = limiter.check('conn-1')
    expect(result.allowed).toBe(false)
  })

  it('disconnects after max violations', () => {
    const limiter = new RateLimiter({ maxPerMinute: 1, maxViolations: 2 })
    limiter.check('conn-1') // ok

    const v1 = limiter.check('conn-1') // violation 1
    expect(v1.allowed).toBe(false)
    expect(v1.shouldDisconnect).toBe(false)

    const v2 = limiter.check('conn-1') // violation 2
    expect(v2.allowed).toBe(false)
    expect(v2.shouldDisconnect).toBe(true)
  })

  it('tracks connections independently', () => {
    const limiter = new RateLimiter({ maxPerMinute: 2 })
    limiter.check('conn-1')
    limiter.check('conn-1')
    const r1 = limiter.check('conn-1')
    expect(r1.allowed).toBe(false)

    const r2 = limiter.check('conn-2')
    expect(r2.allowed).toBe(true)
  })

  it('cleans up on remove', () => {
    const limiter = new RateLimiter({ maxPerMinute: 1 })
    limiter.check('conn-1')
    limiter.remove('conn-1')
    // After removal, should start fresh
    const result = limiter.check('conn-1')
    expect(result.allowed).toBe(true)
  })
})
