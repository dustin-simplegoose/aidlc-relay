import { describe, it, expect, vi } from 'vitest'
import { ConnectionRegistry } from '../src/registry.js'
import type { TeamRoster } from '../src/types.js'

function mockSocket(): any {
  return { close: vi.fn(), readyState: 1, OPEN: 1, send: vi.fn() }
}

describe('ConnectionRegistry', () => {
  it('registers and retrieves connections', () => {
    const registry = new ConnectionRegistry()
    const ws = mockSocket()
    const result = registry.register('org/repo', 'alice', 'engineer', ws)

    expect(result.success).toBe(true)
    expect(registry.getAll('org/repo')).toHaveLength(1)
    expect(registry.getByRole('org/repo', 'engineer')).toHaveLength(1)
    expect(registry.getByUserId('org/repo', 'alice')).toBeDefined()
  })

  it('unregisters connections', () => {
    const registry = new ConnectionRegistry()
    registry.register('org/repo', 'alice', 'engineer', mockSocket())
    registry.unregister('org/repo', 'alice')
    expect(registry.getAll('org/repo')).toHaveLength(0)
  })

  it('validates against cached roster', () => {
    const registry = new ConnectionRegistry()
    const roster: TeamRoster = {
      repoId: 'org/repo',
      members: [
        { userId: 'alice', role: 'engineer' },
        { userId: 'bob', role: 'product' },
      ],
    }

    // First connection caches roster
    registry.register('org/repo', 'alice', 'engineer', mockSocket(), roster)

    // Valid member
    const r1 = registry.register('org/repo', 'bob', 'product', mockSocket())
    expect(r1.success).toBe(true)

    // Unknown user
    const r2 = registry.register('org/repo', 'charlie', 'engineer', mockSocket())
    expect(r2.success).toBe(false)
    expect(r2.error).toContain('not found in team roster')

    // Wrong role
    const r3 = registry.register('org/repo', 'bob', 'engineer', mockSocket())
    expect(r3.success).toBe(false)
    expect(r3.error).toContain('Role mismatch')
  })

  it('enforces max connections per team', () => {
    const registry = new ConnectionRegistry({ maxConnectionsPerTeam: 2 })
    registry.register('org/repo', 'alice', 'engineer', mockSocket())
    registry.register('org/repo', 'bob', 'product', mockSocket())
    const r = registry.register('org/repo', 'charlie', 'engineer', mockSocket())
    expect(r.success).toBe(false)
    expect(r.error).toContain('Max connections')
  })

  it('allows reconnection for same user', () => {
    const registry = new ConnectionRegistry({ maxConnectionsPerTeam: 1 })
    const ws1 = mockSocket()
    registry.register('org/repo', 'alice', 'engineer', ws1)
    const ws2 = mockSocket()
    const r = registry.register('org/repo', 'alice', 'engineer', ws2)
    expect(r.success).toBe(true)
    expect(ws1.close).toHaveBeenCalled()
  })

  it('returns connected members', () => {
    const registry = new ConnectionRegistry()
    registry.register('org/repo', 'alice', 'engineer', mockSocket())
    registry.register('org/repo', 'bob', 'product', mockSocket())

    const members = registry.getConnectedMembers('org/repo')
    expect(members).toHaveLength(2)
    expect(members.map(m => m.userId).sort()).toEqual(['alice', 'bob'])
  })

  it('returns stats', () => {
    const registry = new ConnectionRegistry()
    registry.register('org/repo-a', 'alice', 'engineer', mockSocket())
    registry.register('org/repo-b', 'bob', 'product', mockSocket())

    const stats = registry.getStats()
    expect(stats.totalConnections).toBe(2)
    expect(stats.teams).toBe(2)
  })

  it('cleans up roster when last connection leaves', () => {
    const registry = new ConnectionRegistry()
    const roster: TeamRoster = {
      repoId: 'org/repo',
      members: [{ userId: 'alice', role: 'engineer' }],
    }
    registry.register('org/repo', 'alice', 'engineer', mockSocket(), roster)
    registry.unregister('org/repo', 'alice')

    // New connection to same repo — no roster cached, so any identity is accepted
    const r = registry.register('org/repo', 'bob', 'product', mockSocket())
    expect(r.success).toBe(true)
  })
})
