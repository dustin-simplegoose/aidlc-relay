import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SlackNotifier } from '../src/slack.js'

describe('SlackNotifier', () => {
  let slack: SlackNotifier

  beforeEach(() => {
    slack = new SlackNotifier({ maxPerMinutePerTeam: 3 })
  })

  it('rejects invalid webhook URLs', async () => {
    const r = await slack.send('https://evil.com/hook', 'team-1', { text: 'hi' })
    expect(r.success).toBe(false)
    expect(r.error).toContain('Invalid Slack webhook URL')
  })

  it('rejects non-https URLs', async () => {
    const r = await slack.send('http://hooks.slack.com/services/x', 'team-1', { text: 'hi' })
    expect(r.success).toBe(false)
  })

  it('rate limits per team', async () => {
    const url = 'https://hooks.slack.com/services/T/B/x'
    // Mock fetch to avoid actual HTTP calls
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))

    await slack.send(url, 'team-1', { text: '1' })
    await slack.send(url, 'team-1', { text: '2' })
    await slack.send(url, 'team-1', { text: '3' })
    const r = await slack.send(url, 'team-1', { text: '4' })
    expect(r.success).toBe(false)
    expect(r.error).toContain('rate limit')

    vi.unstubAllGlobals()
  })

  it('tracks rate limits per team independently', async () => {
    const url = 'https://hooks.slack.com/services/T/B/x'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))

    await slack.send(url, 'team-1', { text: '1' })
    await slack.send(url, 'team-1', { text: '2' })
    await slack.send(url, 'team-1', { text: '3' })

    // Different team should still be allowed
    const r = await slack.send(url, 'team-2', { text: '1' })
    expect(r.success).toBe(true)

    vi.unstubAllGlobals()
  })

  it('formats question notification', () => {
    const payload = slack.formatQuestionNotification(
      'alice', 'engineer', 'product',
      'What is the priority of this feature?',
      'auth-flow',
    )
    expect(payload.text).toContain('alice')
    expect(payload.text).toContain('engineer')
    expect(payload.text).toContain('product')
    expect(payload.text).toContain('auth-flow')
    expect(payload.text).toContain('What is the priority')
  })
})
