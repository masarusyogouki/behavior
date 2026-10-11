import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})
const sessionId = randomUUID()

function updateEnv(relativePath, examplePath, values) {
  const path = resolve(root, relativePath)
  let content = readFileSync(existsSync(path) ? path : resolve(root, examplePath), 'utf8')
  for (const [name, value] of Object.entries(values)) {
    const line = `${name}=${value.replace(/\r?\n/g, '\\n')}`
    const pattern = new RegExp(`^${name}=.*$`, 'gm')
    content = pattern.test(content) ? content.replace(pattern, () => line) : `${content.trimEnd()}\n${line}\n`
  }
  writeFileSync(path, content, { mode: 0o600 })
}

updateEnv('.env', '.env.example', {
  WORKER_SESSION_ID: sessionId,
  WORKER_SESSION_PUBLIC_KEY: publicKey,
  WORKER_SESSION_AUDIENCE: 'browser-worker',
  WORKER_ALLOWED_ORIGINS: 'http://localhost:3001,http://127.0.0.1:3001',
})
updateEnv('web/.env.local', 'web/.env.example', {
  WORKER_CONNECTION_MODE: 'local',
  WORKER_LOCAL_WS_URL: 'ws://127.0.0.1:3000',
  WORKER_SESSION_ID: sessionId,
  WORKER_SESSION_PRIVATE_KEY: privateKey,
})
console.log('Local JWT keys and session ID configured. Restart web and recreate the Worker container after running this command.')
console.log('Terminal 1: docker compose up --build --force-recreate worker')
console.log('Terminal 2: pnpm --dir web dev')
