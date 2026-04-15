/**
 * Connection Registry — tracks connected clients per repo,
 * validates against team rosters, enforces max connections.
 */

import type { WebSocket } from 'ws'
import type { Role, TeamRoster, TeamMember } from './types.js'

export interface ConnectionEntry {
  userId: string
  role: Role
  socket: WebSocket
  connectedAt: string
}

export interface RegistryConfig {
  maxConnectionsPerTeam: number
}

export class ConnectionRegistry {
  /** repoId -> userId -> ConnectionEntry */
  private connections = new Map<string, Map<string, ConnectionEntry>>()
  /** repoId -> TeamRoster (cached from first connector) */
  private rosters = new Map<string, TeamRoster>()
  private config: RegistryConfig

  constructor(config?: Partial<RegistryConfig>) {
    this.config = {
      maxConnectionsPerTeam: config?.maxConnectionsPerTeam ?? 20,
    }
  }

  register(
    repoId: string,
    userId: string,
    role: Role,
    socket: WebSocket,
    roster?: TeamRoster,
  ): { success: boolean; error?: string; connectedMembers?: TeamMember[] } {
    // Cache roster from first connector
    if (roster && !this.rosters.has(repoId)) {
      this.rosters.set(repoId, roster)
    }

    // Validate against cached roster
    const cachedRoster = this.rosters.get(repoId)
    if (cachedRoster) {
      const member = cachedRoster.members.find(m => m.userId === userId)
      if (!member) {
        return { success: false, error: `User "${userId}" not found in team roster` }
      }
      if (member.role !== role) {
        return { success: false, error: `Role mismatch for "${userId}": expected ${member.role}, got ${role}` }
      }
    }

    // Get or create repo connections
    let repoConnections = this.connections.get(repoId)
    if (!repoConnections) {
      repoConnections = new Map()
      this.connections.set(repoId, repoConnections)
    }

    // Check max connections
    if (repoConnections.size >= this.config.maxConnectionsPerTeam && !repoConnections.has(userId)) {
      return { success: false, error: `Max connections (${this.config.maxConnectionsPerTeam}) reached for team` }
    }

    // Close existing connection for same user (reconnection)
    const existing = repoConnections.get(userId)
    if (existing) {
      try { existing.socket.close(1000, 'Replaced by new connection') } catch { /* ignore */ }
    }

    repoConnections.set(userId, {
      userId,
      role,
      socket,
      connectedAt: new Date().toISOString(),
    })

    return {
      success: true,
      connectedMembers: this.getConnectedMembers(repoId),
    }
  }

  unregister(repoId: string, userId: string): void {
    const repoConnections = this.connections.get(repoId)
    if (!repoConnections) return
    repoConnections.delete(userId)
    if (repoConnections.size === 0) {
      this.connections.delete(repoId)
      this.rosters.delete(repoId)
    }
  }

  getByRole(repoId: string, role: Role): ConnectionEntry[] {
    const repoConnections = this.connections.get(repoId)
    if (!repoConnections) return []
    return Array.from(repoConnections.values()).filter(c => c.role === role)
  }

  getByUserId(repoId: string, userId: string): ConnectionEntry | undefined {
    return this.connections.get(repoId)?.get(userId)
  }

  getAll(repoId: string): ConnectionEntry[] {
    const repoConnections = this.connections.get(repoId)
    if (!repoConnections) return []
    return Array.from(repoConnections.values())
  }

  getConnectedMembers(repoId: string): TeamMember[] {
    return this.getAll(repoId).map(c => ({
      userId: c.userId,
      role: c.role,
    }))
  }

  getStats(): { totalConnections: number; teams: number } {
    let totalConnections = 0
    for (const repo of this.connections.values()) {
      totalConnections += repo.size
    }
    return { totalConnections, teams: this.connections.size }
  }
}
