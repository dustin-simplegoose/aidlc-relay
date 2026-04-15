/**
 * Slack fallback — sends notifications when target role is disconnected.
 * URL-validated, rate-limited per team.
 */

const SLACK_URL_PATTERN = /^https:\/\/hooks\.slack\.com\/services\/.+$/

interface SlackRateState {
  timestamps: number[]
}

export interface SlackConfig {
  maxPerMinutePerTeam: number
}

export interface SlackPayload {
  text: string
  blocks?: Array<{
    type: string
    text?: { type: string; text: string }
    [key: string]: unknown
  }>
}

export class SlackNotifier {
  private rateLimits = new Map<string, SlackRateState>()
  private config: SlackConfig

  constructor(config?: Partial<SlackConfig>) {
    this.config = {
      maxPerMinutePerTeam: config?.maxPerMinutePerTeam ?? 10,
    }
  }

  async send(webhookUrl: string, teamId: string, payload: SlackPayload): Promise<{ success: boolean; error?: string }> {
    if (!SLACK_URL_PATTERN.test(webhookUrl)) {
      return { success: false, error: 'Invalid Slack webhook URL' }
    }

    // Rate limit check
    const now = Date.now()
    const windowStart = now - 60_000
    let state = this.rateLimits.get(teamId)
    if (!state) {
      state = { timestamps: [] }
      this.rateLimits.set(teamId, state)
    }
    state.timestamps = state.timestamps.filter(t => t > windowStart)
    if (state.timestamps.length >= this.config.maxPerMinutePerTeam) {
      return { success: false, error: 'Slack rate limit exceeded for team' }
    }
    state.timestamps.push(now)

    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        return { success: false, error: `Slack returned ${res.status}` }
      }

      return { success: true }
    } catch (err) {
      return { success: false, error: `Slack request failed: ${(err as Error).message}` }
    }
  }

  formatQuestionNotification(
    senderName: string,
    senderRole: string,
    targetRole: string,
    question: string,
    workItem?: string,
  ): SlackPayload {
    const header = `Question from ${senderName} (${senderRole}) for ${targetRole}`
    const text = workItem
      ? `${header}\n\nWork item: ${workItem}\n\n> ${question}`
      : `${header}\n\n> ${question}`

    return { text }
  }
}
