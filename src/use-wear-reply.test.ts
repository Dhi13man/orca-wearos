import { describe, expect, it } from 'vitest'
import { mergeReplyStatus } from './wear-reply-status'

describe('watch reply receipt order', () => {
  it('never regresses a verified terminal receipt to an older pending or uncertain read', () => {
    expect(mergeReplyStatus('accepted', 'pending')).toBe('accepted')
    expect(mergeReplyStatus('accepted', 'unknown')).toBe('accepted')
    expect(mergeReplyStatus('rejected', 'pending')).toBe('rejected')
    expect(mergeReplyStatus('unknown', 'accepted')).toBe('accepted')
    expect(mergeReplyStatus('pending', 'unknown')).toBe('unknown')
  })
})
