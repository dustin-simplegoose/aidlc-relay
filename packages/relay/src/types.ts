import type { Role, GateType, StateChangeType } from '@aidlc/core'

// Re-export core types used in the relay protocol
export type { Role, GateType, StateChangeType }

// --- Protocol ---

export const PROTOCOL_VERSION = 1 as const

export type MessageType =
  | 'gate-notification'
  | 'question'
  | 'answer'
  | 'state-change'
  | 'presence'
  | 'delivery-status'

export interface RelayEnvelope {
  protocolVersion: typeof PROTOCOL_VERSION
  type: MessageType
  id: string
  timestamp: string
  from: UserIdentity
  to?: MessageTarget
  payload: MessagePayload
}

export type MessagePayload =
  | GateNotificationPayload
  | QuestionPayload
  | AnswerPayload
  | StateChangePayload
  | PresencePayload
  | DeliveryStatusPayload

// --- Payloads ---

export interface GateNotificationPayload {
  kind: 'gate-notification'
  gate: GateType
  action: 'approved' | 'rejected'
  workItem: string
  system: string
  artifact?: string
  rationale?: string
}

export interface QuestionPayload {
  kind: 'question'
  questionId: string
  targetRole: Role
  category: string
  question: string
  context?: string
  workItem?: string
  system?: string
}

export interface AnswerPayload {
  kind: 'answer'
  questionId: string
  replyTo: { userId: string; role: Role }
  answer: string
}

export interface StateChangePayload {
  kind: 'state-change'
  changeType: StateChangeType
  workItem: string
  system: string
  details?: string
}

export interface PresencePayload {
  kind: 'presence'
  action: 'connected' | 'disconnected'
  connectedMembers?: TeamMember[]
}

export interface DeliveryStatusPayload {
  kind: 'delivery-status'
  messageId: string
  status: DeliveryStatus
  fallback?: 'slack' | 'none'
  reason?: string
}

// --- Identity & Config ---

export interface UserIdentity {
  userId: string
  role: Role
}

export interface MessageTarget {
  userId?: string
  role?: Role
}

export interface TeamMember {
  userId: string
  role: Role
  displayName?: string
}

export interface TeamRoster {
  repoId: string
  members: TeamMember[]
}

export interface RelayConfig {
  url: string
  teamApiKey: string
  identity: UserIdentity
  autoConnect?: boolean
}

export type DeliveryStatus = 'delivered' | 'queued' | 'offline-slack' | 'offline-no-fallback' | 'failed'

// --- Connection ---

export interface ConnectMessage {
  protocolVersion: typeof PROTOCOL_VERSION
  identity: UserIdentity
  teamApiKey: string
  repoId: string
  roster?: TeamRoster
}

export interface ConnectAck {
  protocolVersion: typeof PROTOCOL_VERSION
  status: 'ok' | 'error'
  connectedMembers?: TeamMember[]
  error?: string
}
