/**
 * RelayClient — connects to the relay server, sends/receives typed messages,
 * auto-reconnects with exponential backoff, re-sends unanswered questions.
 */

import WebSocket from 'ws'
import {
  PROTOCOL_VERSION,
  type RelayEnvelope,
  type RelayConfig,
  type UserIdentity,
  type TeamRoster,
  type TeamMember,
  type ConnectMessage,
  type ConnectAck,
  type DeliveryStatus,
  type GateNotificationPayload,
  type QuestionPayload,
  type AnswerPayload,
  type StateChangePayload,
  type GateType,
  type StateChangeType,
  type Role,
} from '@aidlc/relay'
import { PriorityQueue } from './queue.js'
import type { Notifier } from './notifier.js'
import { NoOpNotifier } from './notifier.js'

export interface RelayClientOptions {
  config: RelayConfig
  repoId: string
  roster?: TeamRoster
  notifier?: Notifier
}

type MessageHandler = (envelope: RelayEnvelope) => void

export class RelayClient {
  private ws: WebSocket | null = null
  private config: RelayConfig
  private repoId: string
  private roster?: TeamRoster
  private notifier: Notifier
  private queue = new PriorityQueue()
  private handlers: MessageHandler[] = []
  private connectedMembers: TeamMember[] = []
  private connected = false
  private reconnecting = false
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private unansweredQuestions = new Map<string, RelayEnvelope>()

  constructor(options: RelayClientOptions) {
    this.config = options.config
    this.repoId = options.repoId
    this.roster = options.roster
    this.notifier = options.notifier ?? new NoOpNotifier()
  }

  async connect(): Promise<{ success: boolean; connectedMembers?: TeamMember[]; error?: string }> {
    if (this.connected) {
      return { success: true, connectedMembers: this.connectedMembers }
    }

    return new Promise((resolve) => {
      const wsUrl = this.config.url.replace(/^http/, 'ws')
      this.ws = new WebSocket(wsUrl, {
        headers: { Authorization: `Bearer ${this.config.teamApiKey}` },
      })

      this.ws.on('open', () => {
        const connectMsg: ConnectMessage = {
          protocolVersion: PROTOCOL_VERSION,
          identity: this.config.identity,
          teamApiKey: this.config.teamApiKey,
          repoId: this.repoId,
          roster: this.roster,
        }
        this.ws!.send(JSON.stringify(connectMsg))
      })

      // Wait for ConnectAck
      this.ws.once('message', (data: Buffer) => {
        let ack: ConnectAck
        try {
          ack = JSON.parse(data.toString()) as ConnectAck
        } catch {
          resolve({ success: false, error: 'Invalid server response' })
          return
        }

        if (ack.status !== 'ok') {
          resolve({ success: false, error: ack.error })
          return
        }

        this.connected = true
        this.reconnecting = false
        this.reconnectAttempt = 0
        this.connectedMembers = ack.connectedMembers ?? []

        // Re-send unanswered questions after reconnect
        for (const envelope of this.unansweredQuestions.values()) {
          this.ws!.send(JSON.stringify(envelope))
        }

        // Set up message handling
        this.ws!.on('message', (msgData: Buffer) => {
          let envelope: RelayEnvelope
          try {
            envelope = JSON.parse(msgData.toString()) as RelayEnvelope
          } catch {
            return
          }

          // If we receive an answer, remove the question from unanswered
          if (envelope.type === 'answer') {
            const payload = envelope.payload as AnswerPayload
            this.unansweredQuestions.delete(payload.questionId)
          }

          // Notify for important messages
          if (envelope.type === 'question' || envelope.type === 'gate-notification') {
            this.notifier.notify('AIDLC Relay', this.formatNotification(envelope)).catch(() => {})
          }

          // Queue the message for piggyback retrieval
          this.queue.enqueue(envelope)

          // Call registered handlers
          for (const handler of this.handlers) {
            try { handler(envelope) } catch { /* ignore handler errors */ }
          }
        })

        this.ws!.on('close', () => {
          this.connected = false
          this.scheduleReconnect()
        })

        this.ws!.on('error', () => {
          // Error will be followed by close event
        })

        resolve({ success: true, connectedMembers: this.connectedMembers })
      })

      this.ws.on('error', () => {
        if (!this.connected) {
          resolve({ success: false, error: 'Connection failed' })
        }
      })
    })
  }

  disconnect(): void {
    this.connected = false
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.removeAllListeners()
      try { this.ws.close(1000, 'Client disconnect') } catch { /* ignore */ }
      this.ws = null
    }
  }

  async sendGateNotification(
    gate: GateType,
    action: 'approved' | 'rejected',
    workItem: string,
    system: string,
    rationale?: string,
  ): Promise<DeliveryStatus> {
    const envelope: RelayEnvelope = {
      protocolVersion: PROTOCOL_VERSION,
      type: 'gate-notification',
      id: `gn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      from: this.config.identity,
      payload: {
        kind: 'gate-notification',
        gate,
        action,
        workItem,
        system,
        rationale,
      } satisfies GateNotificationPayload,
    }
    return this.send(envelope)
  }

  async sendQuestion(
    targetRole: Role,
    category: string,
    question: string,
    context?: string,
    workItem?: string,
    system?: string,
  ): Promise<DeliveryStatus> {
    const questionId = `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const envelope: RelayEnvelope = {
      protocolVersion: PROTOCOL_VERSION,
      type: 'question',
      id: questionId,
      timestamp: new Date().toISOString(),
      from: this.config.identity,
      payload: {
        kind: 'question',
        questionId,
        targetRole,
        category,
        question,
        context,
        workItem,
        system,
      } satisfies QuestionPayload,
    }

    // Track for re-send on reconnect
    this.unansweredQuestions.set(questionId, envelope)

    return this.send(envelope)
  }

  async sendAnswer(
    questionId: string,
    replyTo: { userId: string; role: Role },
    answer: string,
  ): Promise<DeliveryStatus> {
    const envelope: RelayEnvelope = {
      protocolVersion: PROTOCOL_VERSION,
      type: 'answer',
      id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      from: this.config.identity,
      payload: {
        kind: 'answer',
        questionId,
        replyTo,
        answer,
      } satisfies AnswerPayload,
    }
    return this.send(envelope)
  }

  async sendStateChange(
    changeType: StateChangeType,
    workItem: string,
    system: string,
    details?: string,
  ): Promise<DeliveryStatus> {
    const envelope: RelayEnvelope = {
      protocolVersion: PROTOCOL_VERSION,
      type: 'state-change',
      id: `sc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      from: this.config.identity,
      payload: {
        kind: 'state-change',
        changeType,
        workItem,
        system,
        details,
      } satisfies StateChangePayload,
    }
    return this.send(envelope)
  }

  getPendingMessages(): RelayEnvelope[] {
    return this.queue.drain()
  }

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler)
  }

  isConnected(): boolean {
    return this.connected
  }

  getConnectedTeam(): TeamMember[] {
    return this.connectedMembers
  }

  private send(envelope: RelayEnvelope): DeliveryStatus {
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return 'failed'
    }
    try {
      this.ws.send(JSON.stringify(envelope))
      return 'delivered'
    } catch {
      return 'failed'
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnecting) return
    this.reconnecting = true

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempt), 60_000)
    this.reconnectAttempt++

    console.log(`[relay-client] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`)

    this.reconnectTimer = setTimeout(async () => {
      const result = await this.connect()
      if (!result.success) {
        this.reconnecting = false
        this.scheduleReconnect()
      }
    }, delay)
  }

  private formatNotification(envelope: RelayEnvelope): string {
    switch (envelope.type) {
      case 'question': {
        const q = envelope.payload as QuestionPayload
        return `Question from ${envelope.from.userId}: ${q.question.slice(0, 100)}`
      }
      case 'gate-notification': {
        const g = envelope.payload as GateNotificationPayload
        return `${g.gate} ${g.action} for ${g.workItem}`
      }
      default:
        return `New ${envelope.type} from ${envelope.from.userId}`
    }
  }
}
