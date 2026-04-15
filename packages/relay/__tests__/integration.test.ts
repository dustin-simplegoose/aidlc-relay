/**
 * Integration tests — full relay flow with real WebSockets + 2 mock clients.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { WebSocket } from 'ws'
import { createRelayServer, type RelayServer } from '../src/server.js'
import { createAuthConfig } from '../src/auth.js'
import {
  PROTOCOL_VERSION,
  type RelayEnvelope,
  type ConnectMessage,
  type ConnectAck,
  type QuestionPayload,
  type AnswerPayload,
  type GateNotificationPayload,
} from '../src/types.js'

const TEST_KEY = 'test-key-abc'
const PM_IDENTITY = { userId: 'alice', role: 'product' as const }
const SDE_IDENTITY = { userId: 'bob', role: 'engineer' as const }
const REPO_ID = 'test-org/test-repo'

const ROSTER = {
  repoId: REPO_ID,
  members: [
    { userId: 'alice', role: 'product' as const },
    { userId: 'bob', role: 'engineer' as const },
  ],
}

async function pickPort(): Promise<number> {
  return 10000 + Math.floor(Math.random() * 20000)
}

function openClient(port: number, identity: typeof PM_IDENTITY, roster?: typeof ROSTER): Promise<{ ws: WebSocket; ack: ConnectAck }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`, {
      headers: { Authorization: `Bearer ${TEST_KEY}` },
    })

    ws.on('open', () => {
      const connect: ConnectMessage = {
        protocolVersion: PROTOCOL_VERSION,
        identity,
        teamApiKey: TEST_KEY,
        repoId: REPO_ID,
        roster,
      }
      ws.send(JSON.stringify(connect))
    })

    ws.once('message', (data: Buffer) => {
      const ack = JSON.parse(data.toString()) as ConnectAck
      if (ack.status !== 'ok') {
        reject(new Error(ack.error ?? 'Connection rejected'))
        return
      }
      resolve({ ws, ack })
    })

    ws.on('error', reject)
  })
}

function collectMessages(ws: WebSocket): RelayEnvelope[] {
  const messages: RelayEnvelope[] = []
  ws.on('message', (data: Buffer) => {
    try {
      messages.push(JSON.parse(data.toString()) as RelayEnvelope)
    } catch { /* ignore */ }
  })
  return messages
}

async function wait(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

describe('Integration: relay server + 2 clients', () => {
  let server: RelayServer
  let port: number

  beforeEach(async () => {
    port = await pickPort()
    server = createRelayServer({
      port,
      authConfig: createAuthConfig(TEST_KEY),
      rateLimit: { maxPerMinute: 100, maxViolations: 3 },
    })
    await server.start()
  })

  afterEach(async () => {
    // Force-close any remaining client sockets
    for (const conn of server.registry.getAll(REPO_ID)) {
      try { conn.socket.terminate() } catch { /* ignore */ }
    }
    await server.stop()
  })

  it('AC-1: two clients connect and register', async () => {
    const pm = await openClient(port, PM_IDENTITY, ROSTER)
    const sde = await openClient(port, SDE_IDENTITY)

    expect(pm.ack.status).toBe('ok')
    expect(sde.ack.status).toBe('ok')
    expect(server.registry.getAll(REPO_ID)).toHaveLength(2)

    pm.ws.close()
    sde.ws.close()
  })

  it('AC-2: gate notification routes from PM to SDE within 2 seconds', async () => {
    const pm = await openClient(port, PM_IDENTITY, ROSTER)
    const sde = await openClient(port, SDE_IDENTITY)

    const sdeMessages = collectMessages(sde.ws)
    await wait(50) // Let presence messages settle

    const gateEnvelope: RelayEnvelope = {
      protocolVersion: PROTOCOL_VERSION,
      type: 'gate-notification',
      id: 'gate-1',
      timestamp: new Date().toISOString(),
      from: PM_IDENTITY,
      payload: {
        kind: 'gate-notification',
        gate: 'requirements-approval',
        action: 'approved',
        workItem: 'auth-flow',
        system: 'api',
      } satisfies GateNotificationPayload,
    }

    const start = Date.now()
    pm.ws.send(JSON.stringify(gateEnvelope))

    // Wait up to 2 seconds for delivery
    for (let i = 0; i < 40; i++) {
      await wait(50)
      if (sdeMessages.some(m => m.type === 'gate-notification' && m.id === 'gate-1')) break
    }
    const elapsed = Date.now() - start

    const received = sdeMessages.find(m => m.type === 'gate-notification' && m.id === 'gate-1')
    expect(received).toBeDefined()
    expect(elapsed).toBeLessThan(2000)

    pm.ws.close()
    sde.ws.close()
  })

  it('AC-3 & AC-4: question routes to role, answer routes back via replyTo', async () => {
    const pm = await openClient(port, PM_IDENTITY, ROSTER)
    const sde = await openClient(port, SDE_IDENTITY)

    const pmMessages = collectMessages(pm.ws)
    const sdeMessages = collectMessages(sde.ws)
    await wait(50)

    // SDE asks a question to product role
    const questionEnvelope: RelayEnvelope = {
      protocolVersion: PROTOCOL_VERSION,
      type: 'question',
      id: 'q-env-1',
      timestamp: new Date().toISOString(),
      from: SDE_IDENTITY,
      payload: {
        kind: 'question',
        questionId: 'q-1',
        targetRole: 'product',
        category: 'requirements',
        question: 'What is the priority?',
      } satisfies QuestionPayload,
    }

    sde.ws.send(JSON.stringify(questionEnvelope))

    // Wait for PM to receive
    for (let i = 0; i < 20; i++) {
      await wait(50)
      if (pmMessages.some(m => m.type === 'question')) break
    }

    const receivedQ = pmMessages.find(m => m.type === 'question')
    expect(receivedQ).toBeDefined()
    expect((receivedQ!.payload as QuestionPayload).questionId).toBe('q-1')

    // PM answers with replyTo
    const answerEnvelope: RelayEnvelope = {
      protocolVersion: PROTOCOL_VERSION,
      type: 'answer',
      id: 'a-env-1',
      timestamp: new Date().toISOString(),
      from: PM_IDENTITY,
      payload: {
        kind: 'answer',
        questionId: 'q-1',
        replyTo: { userId: 'bob', role: 'engineer' },
        answer: 'High priority — deadline Friday.',
      } satisfies AnswerPayload,
    }

    pm.ws.send(JSON.stringify(answerEnvelope))

    // Wait for SDE to receive the answer
    for (let i = 0; i < 20; i++) {
      await wait(50)
      if (sdeMessages.some(m => m.type === 'answer')) break
    }

    const receivedA = sdeMessages.find(m => m.type === 'answer')
    expect(receivedA).toBeDefined()
    expect((receivedA!.payload as AnswerPayload).answer).toContain('High priority')

    pm.ws.close()
    sde.ws.close()
  })

  it('AC-6: roster validation rejects wrong user/role', async () => {
    // First client caches roster
    const pm = await openClient(port, PM_IDENTITY, ROSTER)

    try {
      // Client with wrong role for known user
      await expect(openClient(port, { userId: 'bob', role: 'product' as const })).rejects.toThrow(/Role mismatch/)

      // Client with unknown user
      await expect(openClient(port, { userId: 'charlie', role: 'engineer' as const })).rejects.toThrow(/not found in team roster/)
    } finally {
      pm.ws.close()
      await wait(50)
    }
  })

  it('AC-9: health endpoint returns 200', async () => {
    const res = await fetch(`http://localhost:${port}/health`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(body.protocolVersion).toBe(PROTOCOL_VERSION)
  })

  it('status endpoint requires auth', async () => {
    const res = await fetch(`http://localhost:${port}/status`)
    expect(res.status).toBe(401)

    const authed = await fetch(`http://localhost:${port}/status`, {
      headers: { Authorization: `Bearer ${TEST_KEY}` },
    })
    expect(authed.status).toBe(200)
    const body = await authed.json()
    expect(body.status).toBe('ok')
  })

  it('rejects invalid auth on WebSocket upgrade', async () => {
    await expect(new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${port}`, {
        headers: { Authorization: 'Bearer invalid-key' },
      })
      ws.on('open', () => { ws.close(); resolve() })
      ws.on('unexpected-response', (_req, res) => {
        reject(new Error(`${res.statusCode}`))
      })
      ws.on('error', (err) => reject(err))
    })).rejects.toThrow(/401/)
  })

  it('Slack fallback fires when target role not connected', async () => {
    await server.stop()

    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    const port2 = await pickPort()
    const srv = createRelayServer({
      port: port2,
      authConfig: createAuthConfig(TEST_KEY),
      slackWebhookUrl: 'https://hooks.slack.com/services/T/B/x',
    })
    await srv.start()

    try {
      const sde = await openClient(port2, SDE_IDENTITY)
      await wait(50)

      // No PM connected; question targets 'product'
      const q: RelayEnvelope = {
        protocolVersion: PROTOCOL_VERSION,
        type: 'question',
        id: 'q-slack-1',
        timestamp: new Date().toISOString(),
        from: SDE_IDENTITY,
        payload: {
          kind: 'question',
          questionId: 'q-slack',
          targetRole: 'product',
          category: 'requirements',
          question: 'Urgent: need priority clarification',
          workItem: 'auth-flow',
        } satisfies QuestionPayload,
      }
      sde.ws.send(JSON.stringify(q))

      // Wait for fetch to be called
      for (let i = 0; i < 20; i++) {
        await wait(50)
        if (fetchMock.mock.calls.length > 0) break
      }

      expect(fetchMock).toHaveBeenCalled()
      expect(fetchMock.mock.calls[0][0]).toContain('hooks.slack.com')

      sde.ws.close()
    } finally {
      await srv.stop()
      vi.unstubAllGlobals()
    }
  })
})
