import { beforeEach, describe, expect, it, vi } from 'vitest'

let randomSeed = 0
vi.mock('expo-crypto', () => ({
  getRandomBytes: (length: number) =>
    Uint8Array.from({ length }, () => {
      randomSeed = (randomSeed + 17) % 251
      return randomSeed
    })
}))

import {
  fetchRuntimeDashboard,
  fetchCommandReceipt,
  fetchRuntimeStatus,
  sendAgentMessage,
  type OrcaSocket
} from './direct-orca-client'
import {
  decrypt,
  deriveSharedKey,
  encrypt,
  generateKeyPair,
  publicKeyFromBase64,
  publicKeyToBase64
} from './e2ee'
import type { PairingOffer } from './pairing'
import type { WearAgentSession } from './runtime-dashboard'

type FakeReply = { ok: true; result: unknown } | { ok: false; error: { message: string } }

class FakeOrcaSocket implements OrcaSocket {
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: ((event: { code?: number }) => void) | null = null
  onerror: (() => void) | null = null
  private sharedKey: Uint8Array | null = null
  readonly requests: Record<string, unknown>[] = []

  constructor(
    private readonly secretKey: Uint8Array,
    private readonly acceptedToken: string,
    private readonly responder: (message: Record<string, unknown>) => FakeReply | null = () => ({
      ok: true,
      result: {
        runtimeId: 'runtime-1',
        appVersion: '1.4.178',
        graphStatus: 'ready',
        hostPlatform: 'win32',
        liveTabCount: 3
      }
    })
  ) {
    queueMicrotask(() => {
      this.readyState = 1
      this.onopen?.()
    })
  }

  send(data: string): void {
    if (!this.sharedKey) {
      const hello = JSON.parse(data) as { publicKeyB64: string }
      this.sharedKey = deriveSharedKey(this.secretKey, publicKeyFromBase64(hello.publicKeyB64))
      this.receive(JSON.stringify({ type: 'e2ee_ready' }))
      return
    }
    const message = JSON.parse(decrypt(data, this.sharedKey)!) as Record<string, unknown>
    if (message.type === 'e2ee_auth') {
      this.receive(
        encrypt(
          JSON.stringify(
            message.deviceToken === this.acceptedToken
              ? { type: 'e2ee_authenticated' }
              : { type: 'e2ee_error' }
          ),
          this.sharedKey
        )
      )
      return
    }
    this.requests.push(message)
    const reply = this.responder(message)
    if (!reply) {
      queueMicrotask(() => this.onclose?.({ code: 1006 }))
      return
    }
    this.receive(
      encrypt(
        JSON.stringify({
          id: message.id,
          ...reply,
          _meta: { runtimeId: 'runtime-1' }
        }),
        this.sharedKey
      )
    )
  }

  close(): void {
    this.readyState = 3
    this.onclose?.({ code: 1000 })
  }

  private receive(data: string): void {
    queueMicrotask(() => this.onmessage?.({ data }))
  }
}

describe('fetchRuntimeStatus', () => {
  let offer: PairingOffer
  let serverSecretKey: Uint8Array

  beforeEach(() => {
    randomSeed = 0
    const server = generateKeyPair()
    serverSecretKey = server.secretKey
    offer = {
      v: 2,
      endpoint: 'ws://127.0.0.1:6768',
      deviceToken: 'watch-token',
      publicKeyB64: publicKeyToBase64(server.publicKey),
      scope: 'wear'
    }
  })

  it('authenticates with the existing E2EE protocol and reads status', async () => {
    await expect(
      fetchRuntimeStatus(offer, {
        createRequestId: () => 'request-1',
        createSocket: () => new FakeOrcaSocket(serverSecretKey, 'watch-token')
      })
    ).resolves.toEqual({
      runtimeId: 'runtime-1',
      appVersion: '1.4.178',
      graphStatus: 'ready',
      hostPlatform: 'win32',
      liveTabCount: 3
    })
  })

  it('fails closed when the runtime rejects the credential', async () => {
    await expect(
      fetchRuntimeStatus(offer, {
        createSocket: () => new FakeOrcaSocket(serverSecretKey, 'different-token')
      })
    ).rejects.toThrow('Orca rejected this pairing')
  })

  it('closes an aborted socket before open and sends no request frames', async () => {
    const abort = new AbortController()
    let socket: FakeOrcaSocket | undefined
    const pending = fetchRuntimeStatus(offer, {
      signal: abort.signal,
      createSocket: () => {
        socket = new FakeOrcaSocket(serverSecretKey, 'watch-token')
        return socket
      }
    })
    abort.abort()
    await expect(pending).rejects.toThrow('cancelled')
    await Promise.resolve()
    expect(socket).toBeDefined()
    expect(socket?.requests).toEqual([])
  })

  it('loads usage and agent inventory through one authenticated batch', async () => {
    let socket: FakeOrcaSocket
    const responder = (message: Record<string, unknown>): FakeReply => {
      if (message.method === 'status.get') {
        return {
          ok: true,
          result: { runtimeId: 'runtime-1', pairedDeviceId: 'device-1' }
        }
      }
      return {
        ok: true,
        result: {
          rateLimits: {
            claude: {
              session: { usedPercent: 25, resetsAt: null, resetDescription: 'in 2h' },
              weekly: null,
              updatedAt: 100,
              status: 'ok'
            }
          },
          snapshots: [
            {
              worktree: 'C:\\repo',
              publicationEpoch: 'epoch-a',
              snapshotVersion: 1,
              tabs: [
                {
                  type: 'terminal',
                  id: 'tab-1',
                  title: 'Agent',
                  status: 'ready',
                  terminal: 'terminal-1',
                  agentStatus: { state: 'working', agentType: 'codex', connectionId: null }
                }
              ]
            }
          ]
        }
      }
    }
    const dashboard = await fetchRuntimeDashboard(offer, {
      createSocket: () => {
        socket = new FakeOrcaSocket(serverSecretKey, 'watch-token', responder)
        return socket
      }
    })

    expect(dashboard.status.pairedDeviceId).toBe('device-1')
    expect(dashboard.usage[0]).toMatchObject({ provider: 'claude' })
    expect(dashboard.agents[0]).toMatchObject({ execution: 'local' })
    expect(socket!.requests.map((request) => request.method).sort()).toEqual([
      'status.get',
      'wear.dashboard.get'
    ])
  })

  it('reports an acknowledged send and preserves an ambiguous disconnect', async () => {
    const agent: WearAgentSession = {
      id: 'C:\\repo:tab-1',
      sessionTabId: 'tab-1',
      worktree: 'C:\\repo',
      worktreeLabel: 'repo',
      title: 'Agent',
      terminal: 'terminal-1',
      agent: 'codex',
      model: null,
      state: 'done',
      prompt: '',
      lastAssistantMessage: '',
      updatedAt: null,
      execution: 'local',
      sessionId: 'session-1',
      transcriptPath: null,
      kind: 'terminal',
      workspaceKind: 'worktree',
      publicationEpoch: 'epoch-a',
      snapshotVersion: 1
    }
    let acceptedSocket: FakeOrcaSocket
    await expect(
      sendAgentMessage(offer, agent, 'device-1', 'runtime-1', 'request-1', 120_000, 'continue', {
        createSocket: () => {
          acceptedSocket = new FakeOrcaSocket(serverSecretKey, 'watch-token', () => ({
            ok: true,
            result: { outcome: 'accepted' }
          }))
          return acceptedSocket
        }
      })
    ).resolves.toBe('accepted')
    expect(acceptedSocket!.requests[0]?.method).toBe('wear.terminal.send')
    expect(acceptedSocket!.requests[0]?.params).toMatchObject({
      bindingId: 'device-1',
      requestId: 'request-1',
      expiresAt: 120_000,
      target: { hostId: 'runtime-1', workspaceId: 'C:\\repo', sessionTabId: 'tab-1' },
      payload: { text: 'continue' }
    })
    await expect(
      sendAgentMessage(offer, agent, 'device-1', 'runtime-1', 'request-1', 120_000, 'continue', {
        createSocket: () => new FakeOrcaSocket(serverSecretKey, 'watch-token', () => null)
      })
    ).resolves.toBe('unknown')
  })

  it('reads a durable receipt without resending the action', async () => {
    let socket: FakeOrcaSocket
    const outcome = await fetchCommandReceipt(offer, 'device-1', 'request-1', {
      createSocket: () => {
        socket = new FakeOrcaSocket(serverSecretKey, 'watch-token', () => ({
          ok: true,
          result: { outcome: 'accepted' }
        }))
        return socket
      }
    })
    expect(outcome).toBe('accepted')
    expect(socket!.requests).toMatchObject([
      { method: 'wear.command.receipt', params: { bindingId: 'device-1', requestId: 'request-1' } }
    ])
  })
})
