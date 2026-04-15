import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MessageRouter } from '../src/router.js'
import { ConnectionRegistry } from '../src/registry.js'
import { SlackNotifier } from '../src/slack.js'
import type { RelayEnvelope, QuestionPayload, AnswerPayload } from '../src/types.js'
import { PROTOCOL_VERSION } from '../src/types.js'

function mockSocket(): any {
  return { close: vi.fn(), readyState: 1, OPEN: 1, send: vi.fn() }
}

function makeEnvelope(overrides: Partial<RelayEnvelope>): RelayEnvelope {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: 'gate-notification',
    id: 'test-msg-1',
    timestamp: new Date().toISOString(),
    from: { userId: 'alice', role: 'engineer' },
    payload: { kind: 'gate-notification', gate: 'requirements-approval', action: 'approved', workItem: 'auth-flow', system: 'api' },
    ...overrides,
  }
}

describe('MessageRouter', () => {
  let registry: ConnectionRegistry
  let slack: SlackNotifier
  let router: MessageRouter

  beforeEach(() => {
    registry = new ConnectionRegistry()
    slack = new SlackNotifier()
    router = new MessageRouter(registry, slack)
  })

  describe('broadcast', () => {
    it('broadcasts gate notifications to all except sender', () => {
      const ws1 = mockSocket()
      const ws2 = mockSocket()
      registry.register('org/repo', 'alice', 'engineer', ws1)
      registry.register('org/repo', 'bob', 'product', ws2)

      const envelope = makeEnvelope({ from: { userId: 'alice', role: 'engineer' } })
      const status = router.route('org/repo', envelope)

      expect(status).toBe('delivered')
      expect(ws1.send).not.toHaveBeenCalled()
      expect(ws2.send).toHaveBeenCalledOnce()
    })

    it('returns delivered even with no other recipients', () => {
      const ws = mockSocket()
      registry.register('org/repo', 'alice', 'engineer', ws)

      const envelope = makeEnvelope({ from: { userId: 'alice', role: 'engineer' } })
      const status = router.route('org/repo', envelope)

      expect(status).toBe('delivered')
    })
  })

  describe('question routing', () => {
    it('routes questions to target role', () => {
      const ws1 = mockSocket()
      const ws2 = mockSocket()
      registry.register('org/repo', 'alice', 'engineer', ws1)
      registry.register('org/repo', 'bob', 'product', ws2)

      const envelope = makeEnvelope({
        type: 'question',
        from: { userId: 'alice', role: 'engineer' },
        payload: {
          kind: 'question',
          questionId: 'q-1',
          targetRole: 'product',
          category: 'requirements',
          question: 'What is the priority?',
        } satisfies QuestionPayload,
      })

      const status = router.route('org/repo', envelope)
      expect(status).toBe('delivered')
      expect(ws2.send).toHaveBeenCalledOnce()
      expect(ws1.send).not.toHaveBeenCalled()
    })

    it('returns offline-no-fallback when target role not connected', () => {
      const ws = mockSocket()
      registry.register('org/repo', 'alice', 'engineer', ws)

      const envelope = makeEnvelope({
        type: 'question',
        from: { userId: 'alice', role: 'engineer' },
        payload: {
          kind: 'question',
          questionId: 'q-1',
          targetRole: 'product',
          category: 'requirements',
          question: 'What is the priority?',
        } satisfies QuestionPayload,
      })

      const status = router.route('org/repo', envelope)
      expect(status).toBe('offline-no-fallback')
    })

    it('uses Slack fallback when configured and target offline', () => {
      const routerWithSlack = new MessageRouter(registry, slack, {
        slackWebhookUrl: 'https://hooks.slack.com/services/T/B/x',
      })

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))

      const ws = mockSocket()
      registry.register('org/repo', 'alice', 'engineer', ws)

      const envelope = makeEnvelope({
        type: 'question',
        from: { userId: 'alice', role: 'engineer' },
        payload: {
          kind: 'question',
          questionId: 'q-1',
          targetRole: 'product',
          category: 'requirements',
          question: 'What is the priority?',
        } satisfies QuestionPayload,
      })

      const status = routerWithSlack.route('org/repo', envelope)
      expect(status).toBe('offline-slack')

      vi.unstubAllGlobals()
    })
  })

  describe('answer routing', () => {
    it('routes answers to replyTo user', () => {
      const ws1 = mockSocket()
      const ws2 = mockSocket()
      registry.register('org/repo', 'alice', 'engineer', ws1)
      registry.register('org/repo', 'bob', 'product', ws2)

      const envelope = makeEnvelope({
        type: 'answer',
        from: { userId: 'bob', role: 'product' },
        payload: {
          kind: 'answer',
          questionId: 'q-1',
          replyTo: { userId: 'alice', role: 'engineer' },
          answer: 'High priority',
        } satisfies AnswerPayload,
      })

      const status = router.route('org/repo', envelope)
      expect(status).toBe('delivered')
      expect(ws1.send).toHaveBeenCalledOnce()
      expect(ws2.send).not.toHaveBeenCalled()
    })

    it('returns offline when replyTo user is not connected', () => {
      const ws = mockSocket()
      registry.register('org/repo', 'bob', 'product', ws)

      const envelope = makeEnvelope({
        type: 'answer',
        from: { userId: 'bob', role: 'product' },
        payload: {
          kind: 'answer',
          questionId: 'q-1',
          replyTo: { userId: 'alice', role: 'engineer' },
          answer: 'High priority',
        } satisfies AnswerPayload,
      })

      const status = router.route('org/repo', envelope)
      expect(status).toBe('offline-no-fallback')
    })
  })
})
