// Composition root for the long-lived Node.js Worker runtime.
import { config } from './config.ts'
import { createRemoteSession } from './composition.ts'
import { createWorkerServer } from './adapters/websocket-server.ts'
import { SessionTokenVerifier } from './adapters/security/session-auth.ts'

const auth = config.sessionAuth
const tokenVerifier = auth.sessionId && auth.publicKeyPem ? new SessionTokenVerifier(auth) : undefined
const server = createWorkerServer({ config, tokenVerifier, createSession: createRemoteSession })

server.listen(config.port, config.host, () => {
  console.log(`VNC server listening on ws://${config.host}:${config.port}`)
})
