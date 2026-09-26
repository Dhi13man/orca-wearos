import { describe, expect, it } from 'vitest'
import {
  canReadAgentConversation,
  parseAttentionEvents,
  parseAgentInventory,
  parseNativeChatMessages,
  parseProviderUsage
} from './runtime-dashboard'

describe('runtime dashboard projections', () => {
  it('does not read a transcript without a verified local owner', () => {
    expect(canReadAgentConversation({ execution: 'local', sessionId: 'session-a' }, true)).toBe(
      true
    )
    expect(
      canReadAgentConversation({ execution: 'unverifiable', sessionId: 'session-a' }, true)
    ).toBe(false)
    expect(canReadAgentConversation({ execution: 'remote', sessionId: 'session-a' }, true)).toBe(
      false
    )
    expect(canReadAgentConversation({ execution: 'local', sessionId: null }, true)).toBe(false)
    expect(canReadAgentConversation({ execution: 'local', sessionId: 'session-a' }, false)).toBe(
      false
    )
  })

  it('keeps only bounded redacted host events', () => {
    expect(
      parseAttentionEvents({
        events: [
          { key: 'epoch:1', kind: 'agent-task-complete', at: 10, body: 'secret' },
          { key: 'epoch:2', kind: 'plugin', at: 11 }
        ],
        eventsOmitted: 3
      })
    ).toEqual({
      events: [{ key: 'epoch:1', kind: 'agent-task-complete', at: 10 }],
      omitted: 3
    })
  })

  it('decodes bounded provider usage', () => {
    expect(
      parseProviderUsage({
        rateLimits: {
          claude: {
            session: { usedPercent: 125, resetsAt: 200, resetDescription: 'tomorrow' },
            weekly: { usedPercent: 45, resetsAt: null, resetDescription: null },
            updatedAt: 100,
            status: 'ok'
          },
          codex: null
        }
      })
    ).toEqual([
      {
        provider: 'claude',
        label: 'Claude',
        session: { usedPercent: 100, resetsAt: 200, resetDescription: 'tomorrow' },
        weekly: { usedPercent: 45, resetsAt: null, resetDescription: null },
        updatedAt: 100,
        status: 'ok'
      }
    ])
  })

  it('keeps local, SSH, WSL, and unknown execution authority distinct', () => {
    const tab = (id: string, connectionId: unknown, state: string) => ({
      type: 'terminal',
      id,
      title: id,
      status: 'ready',
      terminal: `terminal-${id}`,
      agentStatus: {
        agentType: 'codex',
        state,
        updatedAt: 10,
        connectionId,
        providerSession: { id: `session-${id}` }
      }
    })
    const unknown = tab('unknown', undefined, 'done')
    delete unknown.agentStatus.connectionId
    const agents = parseAgentInventory({
      snapshots: [
        {
          worktree: 'C:\\repo',
          publicationEpoch: 'epoch-a',
          snapshotVersion: 1,
          tabs: [
            tab('local', null, 'working'),
            tab('ssh', 'ssh-host', 'blocked'),
            tab('wsl', 'wsl:Ubuntu', 'waiting'),
            unknown
          ]
        }
      ]
    })

    expect(Object.fromEntries(agents.map((agent) => [agent.title, agent.execution]))).toEqual({
      ssh: 'remote',
      wsl: 'local',
      local: 'local',
      unknown: 'unverifiable'
    })
  })

  it('projects text and tool blocks without retaining raw payloads', () => {
    expect(
      parseNativeChatMessages({
        messages: [
          {
            id: 'm1',
            role: 'assistant',
            timestamp: 10,
            blocks: [
              { type: 'text', text: 'Done.' },
              { type: 'tool-call', name: 'Bash', input: { secret: 'not rendered' } }
            ]
          }
        ]
      })
    ).toEqual([{ id: 'm1', role: 'assistant', timestamp: 10, text: 'Done.\nTool: Bash' }])
  })
})
