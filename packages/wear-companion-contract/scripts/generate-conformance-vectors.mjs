import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const target = {
  hostId: 'host',
  workspaceId: 'folder',
  workspaceKind: 'folder',
  sessionTabId: 'tab'
}
function envelope(action, payload = {}, session = true, exactTarget = target) {
  return {
    schemaVersion: 1,
    bindingId: 'binding',
    requestId: 'request',
    expiresAt: 2000,
    action,
    target: exactTarget,
    publisherEpoch: 'phone',
    expectedRevision: 2,
    targetPublicationEpoch: session ? 'runtime' : null,
    targetSnapshotVersion: session ? 3 : null,
    payload
  }
}
const vectors = []
function add(name, value, accepted, now = 1000) {
  vectors.push({
    name,
    serialized: typeof value === 'string' ? value : JSON.stringify(value),
    now,
    accepted
  })
}
for (const action of ['openConversation', 'requestPhoneHandoff']) {
  add(action, envelope(action), true)
}
for (const action of ['renewConversation', 'closeConversation']) {
  add(action, envelope(action, { leaseId: 'lease' }), true)
}
for (const action of ['readHostPage', 'readUsagePage', 'readNotificationsPage']) {
  add(action, envelope(action, { cursor: null }, false, {}), true)
}
add('refresh', envelope('refresh', {}, false, {}), true)
add(
  'readHostAgents',
  envelope('readHostAgents', { cursor: 'cursor' }, false, { hostId: 'host' }),
  true
)
const send = (text) => envelope('sendAgentMessage', { text })
for (const [name, text] of [
  ['unicode', 'héllo 🙂 你好'],
  ['separators', 'a\u2028b\u2029c'],
  ['slashes', '/\\\"'],
  ['controls', '\0\b\f\n\r\t\u001fX'],
  ['nonblank-zero-width', '\u200b'],
  ['nonblank-next-line', '\u0085'],
  ['utf8-boundary', '🙂'.repeat(512)]
]) {
  add(name, send(text), true)
}
const blank =
  '\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'
add('blank-js-trim', send(blank), false)
add('message-overflow', send(`${'🙂'.repeat(512)}a`), false)
add('escaped-payload-overflow', send(`X${'\0'.repeat(800)}`), false)
add('lone-high', send('\ud800'), false)
add('lone-low', send('\udfff'), false)
add('expired-at-deadline', send('text'), false, 2000)
add('id-byte-limit', { ...send('text'), bindingId: 'é'.repeat(128) }, true)
add('id-byte-overflow', { ...send('text'), bindingId: 'é'.repeat(129) }, false)
add('max-safe-revision', { ...send('text'), expectedRevision: Number.MAX_SAFE_INTEGER }, true)
for (const revision of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, null, '2']) {
  add(`bad-revision-${revision}`, { ...send('text'), expectedRevision: revision }, false)
}
add('unknown-root', { ...send('text'), rpc: 'terminal.send' }, false)
add(
  'unknown-payload',
  { ...send('text'), payload: { text: 'text', method: 'terminal.send' } },
  false
)
add('missing-fence', { ...send('text'), targetPublicationEpoch: null }, false)
add('unknown-action', { ...send('text'), action: '__proto__' }, false)
const canonical = JSON.stringify(send('text'))
for (const [name, text] of [
  ['duplicate-key', canonical.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1')],
  ['leading-space', ` ${canonical}`],
  ['alternate-escape', canonical.replace('"text":"text"', '"text":"\\u0074ext"')],
  ['decimal-number', canonical.replace('"expectedRevision":2', '"expectedRevision":2.0')],
  ['array-root', '[]'],
  ['null-root', 'null'],
  ['oversize', 'x'.repeat(8193)]
]) {
  add(name, text, false)
}
const destination = new URL('../conformance/', import.meta.url)
mkdirSync(destination, { recursive: true })
const targetFile = new URL('action-vectors.json', destination)
const output = `${JSON.stringify(vectors, null, 2)}\n`
if (process.argv.includes('--check')) {
  if (readFileSync(targetFile, 'utf8').replaceAll('\r\n', '\n') !== output) {
    throw new Error('Action conformance vectors are stale')
  }
} else {
  writeFileSync(targetFile, output)
}
