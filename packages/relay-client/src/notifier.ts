/**
 * OS Notifier — sends desktop notifications for relay messages.
 * Best-effort: failures are logged silently.
 */

export interface Notifier {
  notify(title: string, body: string): Promise<void>
}

/** Sanitize content: allow alphanumeric, basic punctuation, spaces */
function sanitize(text: string): string {
  return text.replace(/[^\w\s.,!?@#:;()\-'"\/]/g, '').trim()
}

export class OSNotifier implements Notifier {
  async notify(title: string, body: string): Promise<void> {
    try {
      const safeTitle = sanitize(title)
      const safeBody = sanitize(body)

      // Dynamically import node-notifier (optional peer dependency)
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = await import(/* webpackIgnore: true */ 'node-notifier' as string) as any
      const notifier = mod.default ?? mod
      await new Promise<void>((resolve) => {
        notifier.notify(
          { title: safeTitle, message: safeBody, sound: true },
          () => resolve(),
        )
      })
    } catch {
      // Best-effort: silently ignore notification failures
    }
  }

  async testNotification(): Promise<boolean> {
    try {
      await this.notify('AIDLC Relay', 'Connected to relay server')
      return true
    } catch {
      return false
    }
  }
}

export class NoOpNotifier implements Notifier {
  async notify(): Promise<void> {
    // No-op
  }
}
