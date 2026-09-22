function envInteger(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`)
  }
  return value
}

function httpUrl(value: string, name: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} must be a valid URL`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${name} must use http or https`)
  }
  return url
}

function allowedOrigins(): Set<string> {
  // Origin はスキーム・ホスト・ポートだけを含む。複数指定はカンマ区切り。
  const raw = process.env.WORKER_ALLOWED_ORIGINS
    ?? 'http://localhost:3001,http://127.0.0.1:3001'
  const origins = raw.split(',').map((origin) => origin.trim()).filter(Boolean)
  if (origins.length === 0) throw new Error('WORKER_ALLOWED_ORIGINS must not be empty')
  return new Set(origins.map((origin) => {
    const url = httpUrl(origin, 'WORKER_ALLOWED_ORIGINS')
    if (url.href !== `${url.origin}/`) {
      throw new Error('WORKER_ALLOWED_ORIGINS must contain origins, not paths')
    }
    return url.origin
  }))
}

export const config = {
  host: '0.0.0.0',
  port: envInteger('PORT', 3000, 1, 65535),
  // UI の描画領域とポインター座標にも同じサイズを使う。
  viewport: { width: 1280, height: 720 },
  fps: envInteger('WORKER_FPS', 30, 1, 60),
  jpegQuality: envInteger('WORKER_JPEG_QUALITY', 60, 1, 100),
  heartbeatMs: 15_000,
  initialUrl: httpUrl(
    process.env.WORKER_INITIAL_URL ?? 'https://en.wikipedia.org/wiki/Main_Page',
    'WORKER_INITIAL_URL',
  ).href,
  allowedOrigins: allowedOrigins(),
}
