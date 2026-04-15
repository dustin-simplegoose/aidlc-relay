import { describe, it, expect } from 'vitest'
import { NoOpNotifier } from '../src/notifier.js'

describe('NoOpNotifier', () => {
  it('resolves without error', async () => {
    const notifier = new NoOpNotifier()
    await expect(notifier.notify('title', 'body')).resolves.toBeUndefined()
  })
})
