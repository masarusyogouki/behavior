import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'

type Address = { address: string; family: number }
type Resolver = (hostname: string) => Promise<Address[]>

const blocked = new BlockList()

const blockedIpv4Ranges = ([
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const).map(([network, prefix]) => ({ network: ipv4Number(network), prefix }))

for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['100::', 64],
  ['2001:2::', 48],
  ['2001:10::', 28],
  ['2001:20::', 28],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) blocked.addSubnet(network, prefix, 'ipv6')

function normalizedHostname(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}

function ipv4Number(address: string): number {
  return address.split('.').reduce((value, part) => ((value << 8) | Number(part)) >>> 0, 0)
}

function isBlockedIpv4(address: string): boolean {
  const value = ipv4Number(address)
  return blockedIpv4Ranges.some(({ network, prefix }) => {
    const mask = (0xffffffff << (32 - prefix)) >>> 0
    return (value & mask) >>> 0 === (network & mask) >>> 0
  })
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return !isBlockedIpv4(address)
  // IPv4-mapped IPv6を迂回路にせず、表記にかかわらず拒否する。
  if (family === 6 && address.toLowerCase().startsWith('::ffff:')) return false
  if (family === 6) return !blocked.check(address, 'ipv6')
  return false
}

const systemResolver: Resolver = async (hostname) => lookup(hostname, { all: true, verbatim: true })

export async function isBrowserUrlAllowed(rawUrl: string, resolver: Resolver = systemResolver): Promise<boolean> {
  let url: URL
  try { url = new URL(rawUrl) } catch { return false }
  if (url.protocol === 'about:' || url.protocol === 'data:' || url.protocol === 'blob:') return true
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false

  const hostname = normalizedHostname(url.hostname).toLowerCase().replace(/\.$/, '')
  if (
    hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname.endsWith('.internal')
    || hostname.endsWith('.home.arpa')
  ) return false

  const literalFamily = isIP(hostname)
  if (literalFamily !== 0) return isPublicAddress(hostname)
  try {
    const addresses = await resolver(hostname)
    return addresses.length > 0 && addresses.every(({ address }) => isPublicAddress(address))
  } catch {
    return false
  }
}
