import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { decodeWearAction, encodeWearAction, type WearAction } from './action'
import { utf8Length } from './utf8'

const target = {
  hostId: 'host-a',
  workspaceId: 'folder-a',
  workspaceKind: 'folder' as const,
  sessionTabId: 'tab-a'
}
const common = {
  schemaVersion: 1 as const,
  bindingId: 'binding-a',
  requestId: 'request-a',
  expiresAt: 2000,
  publisherEpoch: 'phone-epoch',
  expectedRevision: 2
}
const fenced = {
  ...common,
  target,
  targetPublicationEpoch: 'runtime-epoch',
  targetSnapshotVersion: 3
}
const unfenced = {
  ...common,
  target: {},
  targetPublicationEpoch: null,
  targetSnapshotVersion: null
}
const send: WearAction = { ...fenced, action: 'sendAgentMessage', payload: { text: 'Hello 🙂' } }
const actions: WearAction[] = [
  { ...unfenced, action: 'readHostPage', payload: { cursor: null } },
  { ...unfenced, action: 'readUsagePage', payload: { cursor: 'start' } },
  {
    ...unfenced,
    action: 'readHostAgents',
    target: { hostId: 'host-a' },
    payload: { cursor: 'page-2' }
  },
  { ...unfenced, action: 'readNotificationsPage', payload: { cursor: null } },
  { ...fenced, action: 'openConversation', payload: {} },
  { ...fenced, action: 'renewConversation', payload: { leaseId: 'lease-a' } },
  { ...fenced, action: 'closeConversation', payload: { leaseId: 'lease-a' } },
  send,
  { ...fenced, action: 'requestPhoneHandoff', payload: {} },
  { ...unfenced, action: 'refresh', payload: {} }
]

function altered(change: (value: Record<string, unknown>) => void): string {
  const value = JSON.parse(encodeWearAction(send)) as Record<string, unknown>
  change(value)
  return JSON.stringify(value)
}

describe('closed Wear action admission', () => {
  it.each(actions)('round-trips $action without losing target identity', (action) => {
    const serialized = encodeWearAction(action)
    expect(decodeWearAction(serialized, 1000)).toEqual({ ok: true, action, canonical: serialized })
  })

  it('pins canonical order, preserves whitespace and Unicode in text', () => {
    const message = { ...send, payload: { text: '  héllo\n🙂  ' } } as WearAction
    expect(encodeWearAction(message)).toBe(
      '{"schemaVersion":1,"bindingId":"binding-a","requestId":"request-a","expiresAt":2000,"action":"sendAgentMessage","target":{"hostId":"host-a","workspaceId":"folder-a","workspaceKind":"folder","sessionTabId":"tab-a"},"publisherEpoch":"phone-epoch","expectedRevision":2,"targetPublicationEpoch":"runtime-epoch","targetSnapshotVersion":3,"payload":{"text":"  héllo\\n🙂  "}}'
    )
  })

  it.each([
    [
      'arbitrary RPC',
      (v: Record<string, unknown>) => {
        v.action = 'terminal.send'
      }
    ],
    [
      'credential field',
      (v: Record<string, unknown>) => {
        v.token = 'forbidden'
      }
    ],
    [
      'nested RPC',
      (v: Record<string, unknown>) => {
        v.payload = { text: 'Hello', method: 'terminal.send' }
      }
    ],
    [
      'target path',
      (v: Record<string, unknown>) => {
        v.target = { ...target, path: '/tmp/private' }
      }
    ],
    [
      'missing fence',
      (v: Record<string, unknown>) => {
        delete v.targetPublicationEpoch
      }
    ],
    [
      'missing target',
      (v: Record<string, unknown>) => {
        v.target = {}
      }
    ],
    [
      'missing message',
      (v: Record<string, unknown>) => {
        v.payload = {}
      }
    ],
    [
      'unsupported version',
      (v: Record<string, unknown>) => {
        v.schemaVersion = 2
      }
    ],
    [
      'noninteger revision',
      (v: Record<string, unknown>) => {
        v.expectedRevision = 1.5
      }
    ],
    [
      'unsafe revision',
      (v: Record<string, unknown>) => {
        v.expectedRevision = Number.MAX_SAFE_INTEGER + 1
      }
    ],
    [
      'negative revision',
      (v: Record<string, unknown>) => {
        v.targetSnapshotVersion = -1
      }
    ],
    [
      'string revision',
      (v: Record<string, unknown>) => {
        v.targetSnapshotVersion = '3'
      }
    ],
    [
      'null fence',
      (v: Record<string, unknown>) => {
        v.targetPublicationEpoch = null
      }
    ],
    [
      'empty id',
      (v: Record<string, unknown>) => {
        v.requestId = ''
      }
    ],
    [
      'blank text',
      (v: Record<string, unknown>) => {
        v.payload = { text: ' \n\t' }
      }
    ],
    [
      'array payload',
      (v: Record<string, unknown>) => {
        v.payload = []
      }
    ],
    [
      'prototype name',
      (v: Record<string, unknown>) => {
        v.action = '__proto__'
      }
    ],
    [
      'lone surrogate',
      (v: Record<string, unknown>) => {
        v.payload = { text: '\ud800' }
      }
    ]
  ])('rejects %s', (_name, change) => {
    expect(decodeWearAction(altered(change), 1000)).toEqual({ ok: false, reason: 'invalid-action' })
  })

  it('requires null session fences for non-session actions', () => {
    const refresh = JSON.parse(
      encodeWearAction(actions.find((action) => action.action === 'refresh')!)
    )
    refresh.targetPublicationEpoch = 'extra-authority'
    expect(decodeWearAction(JSON.stringify(refresh), 1000)).toEqual({
      ok: false,
      reason: 'invalid-action'
    })
  })

  it('expires at the exact deadline without grace', () => {
    const wire = encodeWearAction(send)
    expect(decodeWearAction(wire, 1999).ok).toBe(true)
    expect(decodeWearAction(wire, 2000)).toEqual({ ok: false, reason: 'expired' })
  })

  it('counts message and identifier limits in UTF-8 bytes', () => {
    for (const text of ['a'.repeat(2048), '🙂'.repeat(512)]) {
      expect(
        decodeWearAction(
          altered((v) => {
            v.payload = { text }
          }),
          1000
        ).ok
      ).toBe(true)
      expect(
        decodeWearAction(
          altered((v) => {
            v.payload = { text: `${text}a` }
          }),
          1000
        ).ok
      ).toBe(false)
    }
    expect(
      decodeWearAction(
        altered((v) => {
          v.requestId = 'é'.repeat(128)
        }),
        1000
      ).ok
    ).toBe(true)
    expect(
      decodeWearAction(
        altered((v) => {
          v.requestId = 'é'.repeat(129)
        }),
        1000
      ).ok
    ).toBe(false)
  })

  it('bounds escaped payload size separately from decoded message size', () => {
    expect(
      decodeWearAction(
        altered((v) => {
          v.payload = { text: `x${'\u0000'.repeat(700)}` }
        }),
        1000
      )
    ).toEqual({ ok: false, reason: 'invalid-action' })
  })

  it('rejects oversized input before parsing and malformed JSON', () => {
    expect(decodeWearAction('x'.repeat(8193), 1000)).toEqual({ ok: false, reason: 'too-large' })
    expect(decodeWearAction('{', 1000)).toEqual({ ok: false, reason: 'invalid-action' })
    for (const wire of ['null', '[]', 'true', '1', '"value"']) {
      expect(decodeWearAction(wire, 1000).ok).toBe(false)
    }
  })

  it('rejects duplicate keys, reordered fields and alternative escapes', () => {
    const wire = encodeWearAction(send)
    for (const changed of [
      wire.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'),
      wire.replace('"text":"Hello 🙂"', '"text":"old","text":"Hello 🙂"'),
      wire.replace('Hello', '\\u0048ello'),
      ` ${wire}`,
      JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(wire)).toReversed()))
    ]) {
      expect(decodeWearAction(changed, 1000)).toEqual({ ok: false, reason: 'noncanonical' })
    }
  })
})

describe('portable UTF-8 byte counts', () => {
  it('agrees with the Node encoder across Unicode boundaries', () => {
    for (const point of [0, 0x7f, 0x80, 0x7ff, 0x800, 0xd7ff, 0xe000, 0xffff, 0x10000, 0x10ffff]) {
      const text = `a${String.fromCodePoint(point)}é`
      expect(utf8Length(text)).toBe(Buffer.byteLength(text, 'utf8'))
    }
  })

  it('rejects unpaired surrogates rather than replacing them', () => {
    for (const text of ['\ud800', '\udc00', '\ud800x', '\ud800\ud800']) {
      expect(utf8Length(text)).toBe(Infinity)
    }
  })
})
