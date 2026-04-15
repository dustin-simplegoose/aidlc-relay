// Re-export all shared types from the relay package
export type {
  Role,
  GateType,
  StateChangeType,
  MessageType,
  RelayEnvelope,
  MessagePayload,
  GateNotificationPayload,
  QuestionPayload,
  AnswerPayload,
  StateChangePayload,
  PresencePayload,
  DeliveryStatusPayload,
  UserIdentity,
  MessageTarget,
  TeamMember,
  TeamRoster,
  RelayConfig,
  DeliveryStatus,
  ConnectMessage,
  ConnectAck,
} from '@aidlc/relay'

export { PROTOCOL_VERSION } from '@aidlc/relay'
