/**
 * Relay server entry point.
 * Reads config from env vars, starts the server, handles graceful shutdown.
 */

import { createAuthConfig } from './auth.js'
import { createRelayServer } from './server.js'

const port = parseInt(process.env.PORT ?? '8080', 10)
const teamApiKeys = process.env.TEAM_API_KEYS
const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL
const maxConnectionsPerTeam = parseInt(process.env.MAX_CONNECTIONS_PER_TEAM ?? '20', 10)

if (!teamApiKeys) {
  console.error('TEAM_API_KEYS environment variable is required')
  process.exit(1)
}

const server = createRelayServer({
  port,
  authConfig: createAuthConfig(teamApiKeys),
  slackWebhookUrl,
  maxConnectionsPerTeam,
})

server.start().catch((err) => {
  console.error('Failed to start relay server:', err)
  process.exit(1)
})

const shutdown = async () => {
  console.log(JSON.stringify({ event: 'server_stopping', timestamp: new Date().toISOString() }))
  await server.stop()
  console.log(JSON.stringify({ event: 'server_stopped', timestamp: new Date().toISOString() }))
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
