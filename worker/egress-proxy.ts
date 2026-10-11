import { createEgressProxy } from './adapters/security/egress-proxy.ts'

createEgressProxy().listen(3128, '0.0.0.0', () => console.log('Egress proxy listening on port 3128'))
