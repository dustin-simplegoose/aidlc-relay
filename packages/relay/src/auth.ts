/**
 * Auth — validates Bearer tokens against configured team API keys.
 * Supports key rotation via comma-separated TEAM_API_KEYS env var.
 */

export interface AuthConfig {
  teamApiKeys: string[]
}

export function createAuthConfig(envKeys: string): AuthConfig {
  const keys = envKeys
    .split(',')
    .map(k => k.trim())
    .filter(k => k.length > 0)

  if (keys.length === 0) {
    throw new Error('TEAM_API_KEYS must contain at least one key')
  }

  return { teamApiKeys: keys }
}

export function validateToken(config: AuthConfig, token: string): boolean {
  return config.teamApiKeys.includes(token)
}

export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  return match ? match[1] : null
}
