import { describe, it, expect } from 'vitest'
import { PriorityQueue } from '../src/queue.js'
import type { RelayEnvelope, MessageType } from '@aidlc/relay'
import { PROTOCOL_VERSION } from '@aidlc/relay'

function makeMsg(type: MessageType, id?: string): RelayEnvelope {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type,
    id: id ?? `msg-${Math.random()}`,
    timestamp: new Date().toISOString(),
    from: { userId: 'test', role: 'engineer' },
    payload: { kind: 'presence', action: 'connected' } as any,
  }
}

describe('PriorityQueue', () => {
  it('enqueues and drains messages', () => {
    const q = new PriorityQueue()
    q.enqueue(makeMsg('question'))
    q.enqueue(makeMsg('presence'))
    expect(q.size()).toBe(2)

    const drained = q.drain()
    expect(drained).toHaveLength(2)
    expect(q.size()).toBe(0)
  })

  it('drains in priority order (highest first)', () => {
    const q = new PriorityQueue()
    q.enqueue(makeMsg('presence'))
    q.enqueue(makeMsg('answer'))
    q.enqueue(makeMsg('question'))
    q.enqueue(makeMsg('gate-notification'))

    const drained = q.drain()
    expect(drained[0].type).toBe('answer')
    expect(drained[1].type).toBe('question')
    expect(drained[2].type).toBe('gate-notification')
    expect(drained[3].type).toBe('presence')
  })

  it('evicts lowest priority when full', () => {
    const q = new PriorityQueue(3)
    q.enqueue(makeMsg('presence', 'p1'))
    q.enqueue(makeMsg('state-change', 'sc1'))
    q.enqueue(makeMsg('question', 'q1'))

    // Queue full. Adding higher-priority answer should evict presence
    const result = q.enqueue(makeMsg('answer', 'a1'))
    expect(result.evicted).toBe(true)
    expect(q.size()).toBe(3)

    const drained = q.drain()
    const types = drained.map(m => m.type)
    expect(types).not.toContain('presence')
    expect(types).toContain('answer')
  })

  it('does not evict if new message is lower priority', () => {
    const q = new PriorityQueue(2)
    q.enqueue(makeMsg('question'))
    q.enqueue(makeMsg('answer'))

    // Queue full. Presence is lower priority than both — should not evict
    const result = q.enqueue(makeMsg('presence'))
    expect(result.evicted).toBe(false)
    expect(q.size()).toBe(2)
  })

  it('peek returns first message without removing', () => {
    const q = new PriorityQueue()
    const msg = makeMsg('question')
    q.enqueue(msg)
    expect(q.peek()).toBe(msg)
    expect(q.size()).toBe(1)
  })

  it('peek returns undefined on empty queue', () => {
    const q = new PriorityQueue()
    expect(q.peek()).toBeUndefined()
  })
})
