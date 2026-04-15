/**
 * Rate limiter — sliding window per-connection message counting.
 * Disconnects after repeated violations.
 */

export interface RateLimiterConfig {
  maxPerMinute: number
  maxViolations: number
}

interface ConnectionState {
  timestamps: number[]
  violations: number
}

export class RateLimiter {
  private connections = new Map<string, ConnectionState>()
  private config: RateLimiterConfig

  constructor(config?: Partial<RateLimiterConfig>) {
    this.config = {
      maxPerMinute: config?.maxPerMinute ?? 60,
      maxViolations: config?.maxViolations ?? 3,
    }
  }

  /** Returns true if allowed, false if rate limited */
  check(connectionId: string): { allowed: boolean; shouldDisconnect: boolean } {
    const now = Date.now()
    const windowStart = now - 60_000

    let state = this.connections.get(connectionId)
    if (!state) {
      state = { timestamps: [], violations: 0 }
      this.connections.set(connectionId, state)
    }

    // Prune old timestamps
    state.timestamps = state.timestamps.filter(t => t > windowStart)
    state.timestamps.push(now)

    if (state.timestamps.length > this.config.maxPerMinute) {
      state.violations++
      return {
        allowed: false,
        shouldDisconnect: state.violations >= this.config.maxViolations,
      }
    }

    return { allowed: true, shouldDisconnect: false }
  }

  remove(connectionId: string): void {
    this.connections.delete(connectionId)
  }
}
