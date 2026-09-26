export type ReplyStatus = 'recovering' | 'idle' | 'pending' | 'accepted' | 'rejected' | 'unknown'

export function mergeReplyStatus(current: ReplyStatus, incoming: ReplyStatus): ReplyStatus {
  if (current === 'accepted' || current === 'rejected') {
    return current
  }
  if (incoming === 'accepted' || incoming === 'rejected') {
    return incoming
  }
  if (current === 'unknown') {
    return current
  }
  return incoming
}
