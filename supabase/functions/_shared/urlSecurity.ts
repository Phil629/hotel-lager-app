export interface UrlSafetyResult {
  safe: boolean
  normalizedUrl?: string
  reason?: string
}

export type DnsResolverFn = (hostname: string) => Promise<string[]>

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
])

const BLOCKED_HOSTNAME_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.localdomain',
  '.home.arpa',
]

function parseIpv4Parts(ip: string): [number, number, number, number] | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  const nums: number[] = []
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const val = Number(part)
    if (val < 0 || val > 255) return null
    nums.push(val)
  }
  return nums as [number, number, number, number]
}

export function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = parseIpv4Parts(ip)
  if (!parts) return false
  const [a, b, c] = parts

  if (a === 0) return true // 0.0.0.0/8 ("this host on this network")
  if (a === 10) return true // 10.0.0.0/8 (RFC1918)
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 (CGNAT)
  if (a === 127) return true // 127.0.0.0/8 (loopback)
  if (a === 169 && b === 254) return true // 169.254.0.0/16 (link-local / cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12 (RFC1918)
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true // IETF protocol / TEST-NET-1
  if (a === 192 && b === 168) return true // 192.168.0.0/16 (RFC1918)
  if (a === 198 && (b === 18 || b === 19)) return true // benchmark 198.18.0.0/15
  if (a === 198 && b === 51 && c === 100) return true // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true // TEST-NET-3
  if (a >= 224) return true // multicast & reserved (224.0.0.0 - 255.255.255.255)

  return false
}

export function isPrivateOrReservedIpv6(rawIp: string): boolean {
  const ip = rawIp.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0]
  if (!ip.includes(':')) return false

  if (ip === '::' || ip === '::1') return true
  if (ip.startsWith('fe8') || ip.startsWith('fe9') || ip.startsWith('fea') || ip.startsWith('feb')) return true // fe80::/10 link-local
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true // fc00::/7 unique local
  if (ip.startsWith('ff')) return true // ff00::/8 multicast

  // IPv4-mapped IPv6: ::ffff:127.0.0.1 or ::ffff:7f00:1
  if (ip.startsWith('::ffff:')) {
    const rest = ip.slice('::ffff:'.length)
    if (parseIpv4Parts(rest)) {
      return isPrivateOrReservedIpv4(rest)
    }
    const hexMatch = rest.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i)
    if (hexMatch) {
      const hi = parseInt(hexMatch[1], 16)
      const lo = parseInt(hexMatch[2], 16)
      const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`
      return isPrivateOrReservedIpv4(ipv4)
    }
  }

  return false
}

function isObfuscatedNumericIpHostname(host: string): boolean {
  // Single integer (2130706433) or hex literal (0x7f000001) or dotted octal/hex segments
  if (/^\d+$/.test(host)) return true
  if (/^0x[0-9a-f]+$/i.test(host)) return true
  const segments = host.split('.')
  if (segments.length >= 2 && segments.length <= 4 && segments.every((s) => /^(0x[0-9a-f]+|0[0-7]+|\d+)$/i.test(s))) {
    // Allow normal dotted decimal only when checked explicitly via isPrivateOrReservedIpv4
    if (segments.length === 4 && segments.every((s) => /^(0|[1-9]\d{0,2})$/.test(s))) {
      return isPrivateOrReservedIpv4(host)
    }
    return true
  }
  return false
}

export function isUnsafeHostname(rawHost: string): boolean {
  const host = rawHost.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '').trim()
  if (!host) return true
  if (BLOCKED_HOSTNAMES.has(host)) return true
  if (BLOCKED_HOSTNAME_SUFFIXES.some((s) => host.endsWith(s))) return true
  if (host.includes(':')) return isPrivateOrReservedIpv6(host)
  if (isObfuscatedNumericIpHostname(host)) return true
  if (!host.includes('.')) return true // single-label internal hosts (e.g. "redis", "db", "metadata")
  return false
}

async function defaultDnsResolver(hostname: string): Promise<string[]> {
  const denoGlobal = (globalThis as any).Deno
  if (typeof denoGlobal?.resolveDns !== 'function') return []
  const ips: string[] = []
  try {
    const aRecords = await denoGlobal.resolveDns(hostname, 'A').catch(() => [])
    if (Array.isArray(aRecords)) ips.push(...aRecords)
    const aaaaRecords = await denoGlobal.resolveDns(hostname, 'AAAA').catch(() => [])
    if (Array.isArray(aaaaRecords)) ips.push(...aaaaRecords)
  } catch {
    // Ignore DNS helper errors; static checks still apply
  }
  return ips
}

export async function assertSafePublicUrl(
  rawUrl: string,
  options?: { dnsResolver?: DnsResolverFn; requireHttpsOrHttp?: boolean },
): Promise<UrlSafetyResult> {
  const trimmed = String(rawUrl || '').trim()
  if (!trimmed) {
    return { safe: false, reason: 'Leere URL' }
  }

  // Reject explicit non-HTTP schemes like file://, javascript:, ftp:// before normalization
  const explicitSchemeMatch = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/)
  if (explicitSchemeMatch) {
    const scheme = explicitSchemeMatch[1].toLowerCase()
    if (scheme !== 'http' && scheme !== 'https') {
      return { safe: false, reason: `Nicht erlaubtes Protokoll: ${scheme}` }
    }
  }

  const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    return { safe: false, reason: 'Ungültiges URL-Format' }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { safe: false, reason: `Nicht erlaubtes Protokoll: ${parsed.protocol}` }
  }
  if (parsed.username || parsed.password) {
    return { safe: false, reason: 'URL darf keine eingebetteten Zugangsdaten enthalten' }
  }

  const hostname = parsed.hostname
  if (isUnsafeHostname(hostname)) {
    return { safe: false, reason: 'Interne oder nicht öffentlich erreichbare Adresse blockiert' }
  }

  // Check DNS resolution against internal/loopback/metadata IP ranges (rebinding defense)
  const isLiteralIpv4 = !!parseIpv4Parts(hostname)
  const isLiteralIpv6 = hostname.includes(':')
  if (!isLiteralIpv4 && !isLiteralIpv6) {
    const resolver = options?.dnsResolver ?? defaultDnsResolver
    const resolvedIps = await resolver(hostname)
    for (const ip of resolvedIps) {
      if (isPrivateOrReservedIpv4(ip) || isPrivateOrReservedIpv6(ip)) {
        return { safe: false, reason: 'Ziel-Domain löst auf eine interne IP-Adresse auf' }
      }
    }
  }

  return { safe: true, normalizedUrl: parsed.href }
}

export async function safeFetchPublicUrl(
  rawUrl: string,
  init: RequestInit = {},
  options?: {
    maxRedirects?: number
    dnsResolver?: DnsResolverFn
    fetchImpl?: typeof fetch
  },
): Promise<{ response: Response; finalUrl: string }> {
  const maxRedirects = options?.maxRedirects ?? 4
  const fetchImpl = options?.fetchImpl ?? fetch
  let currentUrl = rawUrl

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const check = await assertSafePublicUrl(currentUrl, { dnsResolver: options?.dnsResolver })
    if (!check.safe || !check.normalizedUrl) {
      throw new Error(check.reason || 'Unsafe URL blocked')
    }

    const res = await fetchImpl(check.normalizedUrl, {
      ...init,
      redirect: 'manual',
    })

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      // Cancel unread redirect body
      try { await res.body?.cancel() } catch { /* ignore body cancel errors */ }
      if (!location || hop === maxRedirects) {
        throw new Error(`Too many or empty redirects from ${check.normalizedUrl}`)
      }
      currentUrl = new URL(location, check.normalizedUrl).href
      continue
    }

    return { response: res, finalUrl: check.normalizedUrl }
  }

  throw new Error('Max redirects exceeded')
}

export type ImageCheckStatus = 'valid' | 'broken' | 'uncertain'

export interface ImageCheckResult {
  url: string
  status: ImageCheckStatus
  contentType?: string
}

const IMAGE_EXTENSION_REGEX = /\.(?:jpg|jpeg|png|webp|gif|avif|svg)(?:\?.*)?$/i
const BROKEN_STATUS_CODES = new Set([400, 401, 403, 404, 410, 451])

export async function checkImageUrl(
  rawUrl: string,
  options?: {
    timeoutMs?: number
    dnsResolver?: DnsResolverFn
    fetchImpl?: typeof fetch
  },
): Promise<ImageCheckResult> {
  const timeoutMs = options?.timeoutMs ?? 2_000
  const check = await assertSafePublicUrl(rawUrl, { dnsResolver: options?.dnsResolver })
  if (!check.safe || !check.normalizedUrl) {
    return { url: rawUrl, status: 'broken' }
  }

  const probeHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
  }

  const runProbe = async (method: 'HEAD' | 'GET', extraHeaders?: Record<string, string>) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const { response, finalUrl } = await safeFetchPublicUrl(
        check.normalizedUrl!,
        {
          method,
          headers: { ...probeHeaders, ...(extraHeaders || {}) },
          signal: controller.signal,
        },
        { dnsResolver: options?.dnsResolver, fetchImpl: options?.fetchImpl, maxRedirects: 3 },
      )
      const contentType = (response.headers.get('content-type') || '').toLowerCase()
      try { await response.body?.cancel() } catch { /* ignore body cancel errors */ }
      return { ok: response.ok || response.status === 206, status: response.status, contentType, finalUrl }
    } finally {
      clearTimeout(timer)
    }
  }

  try {
    let probe = await runProbe('HEAD')
    if (probe.status === 405 || probe.status === 501) {
      probe = await runProbe('GET', { Range: 'bytes=0-0' })
    }

    if (BROKEN_STATUS_CODES.has(probe.status)) {
      return { url: check.normalizedUrl, status: 'broken', contentType: probe.contentType }
    }

    if (!probe.ok) {
      return {
        url: check.normalizedUrl,
        status: probe.status === 429 || probe.status >= 500 ? 'uncertain' : 'broken',
        contentType: probe.contentType,
      }
    }

    // Check Content-Type: explicitly reject HTML/JSON/XML masquerading as an image
    if (
      probe.contentType.includes('text/html') ||
      probe.contentType.includes('application/json') ||
      probe.contentType.includes('application/xhtml') ||
      probe.contentType.includes('text/plain')
    ) {
      return { url: probe.finalUrl || check.normalizedUrl, status: 'broken', contentType: probe.contentType }
    }

    if (probe.contentType.startsWith('image/')) {
      return { url: probe.finalUrl || check.normalizedUrl, status: 'valid', contentType: probe.contentType }
    }

    if (!probe.contentType || probe.contentType.includes('application/octet-stream')) {
      return {
        url: probe.finalUrl || check.normalizedUrl,
        status: IMAGE_EXTENSION_REGEX.test(probe.finalUrl || check.normalizedUrl) ? 'valid' : 'uncertain',
        contentType: probe.contentType,
      }
    }

    return { url: probe.finalUrl || check.normalizedUrl, status: 'uncertain', contentType: probe.contentType }
  } catch {
    return { url: check.normalizedUrl, status: 'uncertain' }
  }
}

export async function pickVerifiedImageCandidates(
  candidates: string[],
  options?: {
    timeoutMs?: number
    maxToProbe?: number
    dnsResolver?: DnsResolverFn
    fetchImpl?: typeof fetch
  },
): Promise<{ bestImage: string; validAlternatives: string[] }> {
  const unique = [...new Set(
    (candidates || [])
      .map((c) => String(c || '').trim())
      .filter((c) => c && !/manifest|favicon|icon[-_.]|apple-touch|logo/i.test(c)),
  )]
  if (unique.length === 0) {
    return { bestImage: '', validAlternatives: [] }
  }

  const maxToProbe = options?.maxToProbe ?? 5
  const toProbe = unique.slice(0, maxToProbe)
  const remaining = unique.slice(maxToProbe)

  const checks = await Promise.all(toProbe.map((u) => checkImageUrl(u, options)))
  const validUrls = checks.filter((r) => r.status === 'valid').map((r) => r.url)
  const uncertainUrls = checks.filter((r) => r.status === 'uncertain').map((r) => r.url)

  const combined = [...new Set([...validUrls, ...uncertainUrls, ...remaining])]
  return {
    bestImage: validUrls[0] || uncertainUrls[0] || '',
    validAlternatives: combined,
  }
}
