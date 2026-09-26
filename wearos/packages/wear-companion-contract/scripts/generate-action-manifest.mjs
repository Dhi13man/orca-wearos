import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const source = new URL('../action-manifest.json', import.meta.url)
const manifest = JSON.parse(readFileSync(source, 'utf8'))
const quote = (value) => JSON.stringify(value)
const list = (values) => `listOf(${values.map(quote).join(', ')})`
const fields = (schema) =>
  `linkedMapOf<String, List<String>>(${Object.entries(schema)
    .map(([name, rule]) => `${quote(name)} to ${list(Array.isArray(rule) ? rule : [rule])}`)
    .join(', ')})`
const kotlin = `// Generated from action-manifest.json; run pnpm generate.
package dev.orca.wear.contract

internal data class ActionSchema(val target: Map<String, List<String>>, val payload: Map<String, List<String>>, val sessionFenced: Boolean)
internal object ActionManifest {
    const val schemaVersion = ${manifest.schemaVersion}
${Object.entries(manifest.limits)
  .map(([name, value]) => `    const val ${name} = ${value}`)
  .join('\n')}
    val envelopeOrder = ${list(manifest.envelopeOrder)}
    val actions = mapOf(
${Object.entries(manifest.actions)
  .map(
    ([name, action]) =>
      `        ${quote(name)} to ActionSchema(${fields(action.target)}, ${fields(action.payload)}, ${action.sessionFenced})`
  )
  .join(',\n')}
    )
}
`
const outputs = [
  [
    '../src/action-manifest.ts',
    `// Generated from action-manifest.json; run pnpm generate.\nexport const actionManifest = ${JSON.stringify(manifest, null, 2)} as const\n`
  ],
  ['../android/src/main/kotlin/dev/orca/wear/contract/ActionManifest.kt', kotlin]
]
for (const [path, output] of outputs) {
  const target = new URL(path, import.meta.url)
  if (process.argv.includes('--check')) {
    if (readFileSync(target, 'utf8').replaceAll('\r\n', '\n') !== output) {
      throw new Error(`Generated action manifest is stale: ${path}`)
    }
  } else {
    mkdirSync(new URL('.', target), { recursive: true })
    writeFileSync(target, output)
  }
}
