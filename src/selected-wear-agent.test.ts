import { describe, expect, it } from 'vitest'
import type { WearAgentRow } from '../packages/wear-companion-contract/src/agent-page'
import { selectCurrentWearAgent } from './selected-wear-agent'

const selected: WearAgentRow = {
  workspaceId: 'workspace-a',
  workspaceKind: 'worktree',
  sessionTabId: 'tab-a',
  kind: 'terminal',
  title: 'Codex',
  state: 'waiting',
  freshness: 'fresh',
  updatedAt: 100,
  freshUntil: 200,
  targetPublicationEpoch: 'host-epoch-a',
  targetSnapshotVersion: 4
}

describe('selected Wear agent', () => {
  it('follows a newer publication of the same agent tab', () => {
    const current = { ...selected, targetSnapshotVersion: 5, state: 'working' as const }
    expect(selectCurrentWearAgent([current], selected)).toBe(current)
  })

  it('does not move selection to another workspace, tab, kind, or host epoch', () => {
    for (const change of [
      { workspaceId: 'workspace-b' },
      { workspaceKind: 'folder' as const },
      { sessionTabId: 'tab-b' },
      { kind: 'structured' as const },
      { targetPublicationEpoch: 'host-epoch-b' }
    ]) {
      expect(selectCurrentWearAgent([{ ...selected, ...change }], selected)).toBeNull()
    }
  })
})
