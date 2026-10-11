import { resolve } from 'node:path'
import type { NextConfig } from 'next'

const repositoryRoot = resolve(process.cwd(), '..')
const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: repositoryRoot,
  turbopack: { root: repositoryRoot },
}

export default nextConfig
