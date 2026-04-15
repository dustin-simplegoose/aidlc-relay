/**
 * Message Router — routes relay envelopes to the correct recipients
 * based on message type and targeting rules.
 */

import type { WebSocket } from 'ws'
import type {
  RelayEnvelope,
  DeliveryStatus,
  DeliveryStatusPayload,
  QuestionPayload,
  AnswerPayload,
  PresencePayload,
  GateNotificationPayload,
  StateChangePayload,
} from './types.js'
import { PROTOCOL_VERSION } from './types.js'
import type { ConnectionRegistry } from './registry.js'
import type { SlackNotifier } from './slack.js'

export interface RouterConfig {
  slackWebhookUrl?: string
}

export class MessageRouter {
  constructor(
    private registry: ConnectionRegistry,
    private slack: SlackNotifier,
    private config: RouterConfig = {},
  ) {}

  route(repoId: string, envelope: RelayEnvelope): DeliveryStatus {
    switch (envelope.type) {
      case 'gate-notification':
      case 'state-change':
        return this.broadcast(repoId, envelope)

      case 'question':
        return this.routeQuestion(repoId, envelope)

      case 'answer':
        return this.routeAnswer(repoId, envelope)

      case 'presence':
        return this.broadcast(repoId, envelope)

      default:
        return 'failed'
    }
  }

  private broadcast(repoId: string, envelope: RelayEnvelope): DeliveryStatus {
    const connections = this.registry.getAll(repoId)
    const recipients = connections.filter(c => c.userId !== envelope.from.userId)

    if (recipients.length === 0) return 'delivered' // no one to send to, but that's ok

    for (const conn of recipients) {
      this.sendToSocket(conn.socket, envelope)
    }

    return 'delivered'
  }

  private routeQuestion(repoId: string, envelope: RelayEnvelope): DeliveryStatus {
    const payload = envelope.payload as QuestionPayload
    const targets = this.registry.getByRole(repoId, payload.targetRole)

    if (targets.length > 0) {
      for (const target of targets) {
        this.sendToSocket(target.socket, envelope)
      }
      return 'delivered'
    }

    // No connected recipients — try Slack fallback
    if (this.config.slackWebhookUrl) {
      const slackPayload = this.slack.formatQuestionNotification(
        envelope.from.userId,
        envelope.from.role,
        payload.targetRole,
        payload.question,
        payload.workItem,
      )
      this.slack.send(this.config.slackWebhookUrl, repoId, slackPayload).catch(err => {
        console.error('[router] Slack fallback failed:', err)
      })
      return 'offline-slack'
    }

    return 'offline-no-fallback'
  }

  private routeAnswer(repoId: string, envelope: RelayEnvelope): DeliveryStatus {
    const payload = envelope.payload as AnswerPayload
    const target = this.registry.getByUserId(repoId, payload.replyTo.userId)

    if (target) {
      this.sendToSocket(target.socket, envelope)
      return 'delivered'
    }

    return 'offline-no-fallback'
  }

  /** Generate and broadcast a presence event */
  broadcastPresence(repoId: string, userId: string, role: string, action: 'connected' | 'disconnected'): void {
    const envelope: RelayEnvelope = {
      protocolVersion: PROTOCOL_VERSION,
      type: 'presence',
      id: `presence-${userId}-${Date.now()}`,
      timestamp: new Date().toISOString(),
      from: { userId, role: role as RelayEnvelope['from']['role'] },
      payload: {
        kind: 'presence',
        action,
        connectedMembers: this.registry.getConnectedMembers(repoId),
      } satisfies PresencePayload,
    }

    this.broadcast(repoId, envelope)
  }

  /** Send delivery status back to sender */
  sendDeliveryStatus(socket: WebSocket, messageId: string, status: DeliveryStatus, fallback?: 'slack' | 'none'): void {
    const envelope: RelayEnvelope = {
      protocolVersion: PROTOCOL_VERSION,
      type: 'delivery-status',
      id: `ds-${messageId}-${Date.now()}`,
      timestamp: new Date().toISOString(),
      from: { userId: 'relay', role: 'engineer' as RelayEnvelope['from']['role'] },
      payload: {
        kind: 'delivery-status',
        messageId,
        status,
        fallback,
      } satisfies DeliveryStatusPayload,
    }

    this.sendToSocket(socket, envelope)
  }

  private sendToSocket(socket: WebSocket, envelope: RelayEnvelope): void {
    try {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(envelope))
      }
    } catch (err) {
      console.error('[router] Failed to send to socket:', err)
    }
  }
}
