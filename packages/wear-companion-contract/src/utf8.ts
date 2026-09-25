export function utf8Length(value: string): number {
  let bytes = 0
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code < 0x80) {
      bytes++
    } else if (code < 0x800) {
      bytes += 2
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index)
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return Infinity
      }
      bytes += 4
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return Infinity
    } else {
      bytes += 3
    }
  }
  return bytes
}
