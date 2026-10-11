import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'

// Resolve through the actual vinext dependency chain so this checks the patch
// installed from the lockfile, rather than an unrelated copy of braces.
const vinextRequire = createRequire(import.meta.resolve('vinext'))
const commonjsRequire = createRequire(vinextRequire.resolve('vite-plugin-commonjs'))
const dynamicRequire = createRequire(commonjsRequire.resolve('vite-plugin-dynamic-import'))
const globRequire = createRequire(dynamicRequire.resolve('fast-glob'))
const matchRequire = createRequire(globRequire.resolve('micromatch'))
const braces = matchRequire('braces') as {
  compile(pattern: string): string
  expand(pattern: string): string[]
  stringify(pattern: string): string
}

test('patched braces rejects deeply nested patterns before recursive walkers exhaust the stack', () => {
  for (const [open, close] of [['{', '}'], ['(', ')']]) {
    const pattern = open.repeat(4000) + 'a,b' + close.repeat(4000)
    for (const operation of [braces.compile, braces.expand, braces.stringify]) assert.throws(() => operation(pattern), /nesting exceeds the safe limit/)
  }
  assert.deepEqual(braces.expand('file-{a,b}.ts'), ['file-a.ts', 'file-b.ts'])
})
