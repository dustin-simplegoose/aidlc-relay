/**
 * WebSocket + HTTP server — handles upgrades, connection lifecycle,
 * message dispatch, health/status endpoints.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import type { RelayEnvelope, ConnectMessage, ConnectAck } from './types.js'
import { PROTOCOL_VERSION } from './types.js'
import { type AuthConfig, validateToken, extractBearerToken } from './auth.js'
import { ConnectionRegistry } from './registry.js'
import { MessageRouter } from './router.js'
import { RateLimiter } from './rate-limiter.js'
import { SlackNotifier } from './slack.js'

export interface ServerConfig {
  port: number
  authConfig: AuthConfig
  slackWebhookUrl?: string
  maxPayload?: number
  maxConnectionsPerTeam?: number
  rateLimit?: { maxPerMinute?: number; maxViolations?: number }
}

interface ClientState {
  repoId?: string
  userId?: string
  role?: string
  authenticated: boolean
}

export function createRelayServer(config: ServerConfig) {
  const registry = new ConnectionRegistry({
    maxConnectionsPerTeam: config.maxConnectionsPerTeam,
  })
  const slack = new SlackNotifier()
  const router = new MessageRouter(registry, slack, {
    slackWebhookUrl: config.slackWebhookUrl,
  })
  const rateLimiter = new RateLimiter(config.rateLimit)

  const clientStates = new WeakMap<WebSocket, ClientState>()

  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>AIDLC Relay</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 560px; margin: 4rem auto; padding: 0 1.5rem; color: #1a1a1a; line-height: 1.6; }
  h1 { font-weight: 700; margin: 0 0 0.5rem; }
  .sub { color: #666; margin-bottom: 2rem; }
  code { background: #f4f4f5; padding: 0.15rem 0.4rem; border-radius: 4px; font-size: 0.9em; }
  a { color: #0070f3; }
  .endpoints { margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid #eee; font-size: 0.9em; color: #555; }
</style>
</head>
<body>
<h1>AIDLC Relay</h1>
<p class="sub">WebSocket relay for AI Development Life Cycle agents.</p>
<p>This is a backend service. Clients connect via <code>wss://relay.simplygoose.com</code> using the <a href="https://www.npmjs.com/package/@aidlc/relay-client"><code>@aidlc/relay-client</code></a> package.</p>
<p>Learn more: <a href="https://simplygoose.com">simplygoose.com</a></p>
<div class="endpoints">
  Endpoints: <a href="/health">/health</a> (public) · <code>/status</code> (auth required)
</div>
</body>
</html>`)
      return
    }

    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', protocolVersion: PROTOCOL_VERSION }))
      return
    }

    if (req.url === '/status' && req.method === 'GET') {
      const token = extractBearerToken(req.headers.authorization)
      if (!token || !validateToken(config.authConfig, token)) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Unauthorized' }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', ...registry.getStats() }))
      return
    }

    res.writeHead(404)
    res.end()
  })

  const wss = new WebSocketServer({
    server: httpServer,
    maxPayload: config.maxPayload ?? 64 * 1024,
    verifyClient: (info, callback) => {
      const token = extractBearerToken(info.req.headers.authorization)
      if (!token || !validateToken(config.authConfig, token)) {
        callback(false, 401, 'Unauthorized')
        return
      }
      callback(true)
    },
  })

  wss.on('connection', (ws: WebSocket) => {
    const state: ClientState = { authenticated: true }
    clientStates.set(ws, state)

    // First message must be ConnectMessage
    ws.once('message', (data: Buffer) => {
      let connectMsg: ConnectMessage
      try {
        connectMsg = JSON.parse(data.toString()) as ConnectMessage
      } catch {
        const ack: ConnectAck = { protocolVersion: PROTOCOL_VERSION, status: 'error', error: 'Invalid JSON' }
        ws.send(JSON.stringify(ack))
        ws.close(1002, 'Invalid connect message')
        return
      }

      if (connectMsg.protocolVersion !== PROTOCOL_VERSION) {
        const ack: ConnectAck = {
          protocolVersion: PROTOCOL_VERSION,
          status: 'error',
          error: `Protocol version mismatch: expected ${PROTOCOL_VERSION}, got ${connectMsg.protocolVersion}`,
        }
        ws.send(JSON.stringify(ack))
        ws.close(1002, 'Protocol version mismatch')
        return
      }

      const result = registry.register(
        connectMsg.repoId,
        connectMsg.identity.userId,
        connectMsg.identity.role,
        ws,
        connectMsg.roster,
      )

      if (!result.success) {
        const ack: ConnectAck = { protocolVersion: PROTOCOL_VERSION, status: 'error', error: result.error }
        ws.send(JSON.stringify(ack))
        ws.close(1008, result.error)
        return
      }

      state.repoId = connectMsg.repoId
      state.userId = connectMsg.identity.userId
      state.role = connectMsg.identity.role

      const ack: ConnectAck = {
        protocolVersion: PROTOCOL_VERSION,
        status: 'ok',
        connectedMembers: result.connectedMembers,
      }
      ws.send(JSON.stringify(ack))

      // Broadcast presence
      router.broadcastPresence(state.repoId, state.userId, state.role, 'connected')

      // Handle subsequent messages
      ws.on('message', (msgData: Buffer) => {
        const connectionId = `${state.repoId}:${state.userId}`
        const { allowed, shouldDisconnect } = rateLimiter.check(connectionId)

        if (!allowed) {
          ws.send(JSON.stringify({ error: 'Rate limit exceeded' }))
          if (shouldDisconnect) {
            ws.close(1008, 'Rate limit violations exceeded')
          }
          return
        }

        let envelope: RelayEnvelope
        try {
          envelope = JSON.parse(msgData.toString()) as RelayEnvelope
        } catch {
          ws.send(JSON.stringify({ error: 'Invalid JSON' }))
          return
        }

        if (envelope.protocolVersion !== PROTOCOL_VERSION) {
          ws.send(JSON.stringify({ error: 'Protocol version mismatch' }))
          return
        }

        // Enforce sender identity (prevent impersonation)
        envelope.from = { userId: state.userId!, role: state.role! as RelayEnvelope['from']['role'] }

        const deliveryStatus = router.route(state.repoId!, envelope)
        const fallback = deliveryStatus === 'offline-slack' ? 'slack' as const
          : deliveryStatus.startsWith('offline') ? 'none' as const
          : undefined
        router.sendDeliveryStatus(ws, envelope.id, deliveryStatus, fallback)
      })
    })

    ws.on('close', () => {
      if (state.repoId && state.userId && state.role) {
        router.broadcastPresence(state.repoId, state.userId, state.role, 'disconnected')
        registry.unregister(state.repoId, state.userId)
        rateLimiter.remove(`${state.repoId}:${state.userId}`)
      }
    })

    ws.on('error', (err) => {
      console.error('[server] WebSocket error:', err.message)
    })
  })

  return {
    httpServer,
    wss,
    registry,
    router,
    start(port?: number): Promise<void> {
      const p = port ?? config.port
      return new Promise((resolve) => {
        httpServer.listen(p, () => {
          console.log(JSON.stringify({
            event: 'server_started',
            port: p,
            protocolVersion: PROTOCOL_VERSION,
            timestamp: new Date().toISOString(),
          }))
          resolve()
        })
      })
    },
    stop(): Promise<void> {
      return new Promise((resolve) => {
        wss.close(() => {
          httpServer.close(() => resolve())
        })
      })
    },
  }
}

export type RelayServer = ReturnType<typeof createRelayServer>
