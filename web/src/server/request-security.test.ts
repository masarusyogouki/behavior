import assert from 'node:assert/strict'
import test from 'node:test'

import { isSameOriginMutation } from './request-security.ts'

test('accepts only an explicit matching Origin for mutations', () => {
  assert.equal(isSameOriginMutation(new Request('https://web.example/api', {
    headers: { Origin: 'https://web.example' },
  })), true)
  assert.equal(isSameOriginMutation(new Request('https://web.example/api')), false)
  assert.equal(isSameOriginMutation(new Request('https://web.example/api', {
    headers: { Origin: 'https://attacker.example' },
  })), false)
})
