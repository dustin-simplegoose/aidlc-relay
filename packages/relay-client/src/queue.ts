/**
 * Priority Message Queue — bounded queue with priority eviction.
 * Priority: answer > question > gate-notification > state-change > presence
 */

import type { RelayEnvelope, MessageType } from '@aidlc/relay'

const PRIORITY: Record<MessageType, number> = {
  'delivery-status': 6,
  'answer': 5,
  'question': 4,
  'gate-notification': 3,
  'state-change': 2,
  'presence': 1,
}

export class PriorityQueue {
  private messages: RelayEnvelope[] = []
  private maxSize: number

  constructor(maxSize = 100) {
    this.maxSize = maxSize
  }

  enqueue(msg: RelayEnvelope): { evicted: boolean } {
    if (this.messages.length >= this.maxSize) {
      // Find lowest priority message to evict
      let lowestIdx = 0
      let lowestPriority = PRIORITY[this.messages[0].type] ?? 0
      for (let i = 1; i < this.messages.length; i++) {
        const p = PRIORITY[this.messages[i].type] ?? 0
        if (p < lowestPriority) {
          lowestPriority = p
          lowestIdx = i
        }
      }

      // Only evict if new message has higher priority
      const newPriority = PRIORITY[msg.type] ?? 0
      if (newPriority <= lowestPriority) {
        return { evicted: false }
      }

      this.messages.splice(lowestIdx, 1)
      this.messages.push(msg)
      return { evicted: true }
    }

    this.messages.push(msg)
    return { evicted: false }
  }

  drain(): RelayEnvelope[] {
    const result = this.messages.sort((a, b) => {
      return (PRIORITY[b.type] ?? 0) - (PRIORITY[a.type] ?? 0)
    })
    this.messages = []
    return result
  }

  peek(): RelayEnvelope | undefined {
    return this.messages[0]
  }

  size(): number {
    return this.messages.length
  }
}
