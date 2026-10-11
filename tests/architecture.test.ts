import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, resolve, relative } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..')
const contracts = resolve(root, 'shared/contracts')
const cores = [
  resolve(root, 'web/src/features/environments/application'),
  resolve(root, 'web/src/features/environments/domain'),
  resolve(root, 'worker/application'),
]

function inside(path: string, directory: string): boolean {
  const rel = relative(directory, path)
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'))
}

async function sources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const lists = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? sources(path) : path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : []
  }))
  return lists.flat()
}

test('application/domain modules depend only on their own core and shared contracts', async () => {
  for (const core of cores) {
    const allowedCore = core === cores[0] ? cores.slice(0, 2) : [core]
    for (const path of await sources(core)) {
      const source = await readFile(path, 'utf8')
      for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)(['"])([^'"]+)\1/g)) {
        const specifier = match[2]
        const target = resolve(dirname(path), specifier)
        assert.ok(specifier.startsWith('.') && [...allowedCore, contracts].some((directory) => inside(target, directory)),
          `${relative(root, path)} depends on external implementation ${specifier}`)
      }
      assert.doesNotMatch(source, /\bprocess\.|\bfetch\s*\(/, `${relative(root, path)} accesses the runtime directly`)
    }
  }
})

test('shared contracts have no runtime or application dependencies', async () => {
  for (const path of await sources(contracts)) {
    const source = await readFile(path, 'utf8')
    for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)(['"])([^'"]+)\1/g)) {
      assert.ok(match[2].startsWith('.') && inside(resolve(dirname(path), match[2]), contracts))
    }
    assert.doesNotMatch(source, /\bprocess\.|\bBuffer\b|\bfetch\s*\(/)
  }
})
