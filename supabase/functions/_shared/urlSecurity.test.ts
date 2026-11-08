import { describe, it, expect } from 'vitest'
import {
  isPrivateOrReservedIpv4,
  isPrivateOrReservedIpv6,
  isUnsafeHostname,
  assertSafePublicUrl,
  safeFetchPublicUrl,
  checkImageUrl,
  pickVerifiedImageCandidates,
} from './urlSecurity'

describe('urlSecurity - SSRF & IP validation', () => {
  it('detects private, loopback, CGNAT, and metadata IPv4 ranges', () => {
    expect(isPrivateOrReservedIpv4('127.0.0.1')).toBe(true)
    expect(isPrivateOrReservedIpv4('10.0.0.5')).toBe(true)
    expect(isPrivateOrReservedIpv4('172.16.0.1')).toBe(true)
    expect(isPrivateOrReservedIpv4('172.31.255.254')).toBe(true)
    expect(isPrivateOrReservedIpv4('192.168.1.10')).toBe(true)
    expect(isPrivateOrReservedIpv4('169.254.169.254')).toBe(true)
    expect(isPrivateOrReservedIpv4('100.64.0.1')).toBe(true)
    expect(isPrivateOrReservedIpv4('0.0.0.0')).toBe(true)
    expect(isPrivateOrReservedIpv4('224.0.0.1')).toBe(true)

    expect(isPrivateOrReservedIpv4('8.8.8.8')).toBe(false)
    expect(isPrivateOrReservedIpv4('172.32.0.1')).toBe(false)
    expect(isPrivateOrReservedIpv4('151.101.1.1')).toBe(false)
  })

  it('detects loopback, link-local, unique-local, and IPv4-mapped IPv6 addresses', () => {
    expect(isPrivateOrReservedIpv6('::1')).toBe(true)
    expect(isPrivateOrReservedIpv6('[::1]')).toBe(true)
    expect(isPrivateOrReservedIpv6('::')).toBe(true)
    expect(isPrivateOrReservedIpv6('fe80::1')).toBe(true)
    expect(isPrivateOrReservedIpv6('fc00::1')).toBe(true)
    expect(isPrivateOrReservedIpv6('fd12:3456::1')).toBe(true)
    expect(isPrivateOrReservedIpv6('::ffff:127.0.0.1')).toBe(true)
    expect(isPrivateOrReservedIpv6('::ffff:7f00:1')).toBe(true)

    expect(isPrivateOrReservedIpv6('2606:4700:4700::1111')).toBe(false)
  })

  it('flags localhost, internal domains, single-label hosts, and obfuscated numeric IPs', () => {
    expect(isUnsafeHostname('localhost')).toBe(true)
    expect(isUnsafeHostname('metadata.google.internal')).toBe(true)
    expect(isUnsafeHostname('postgres.local')).toBe(true)
    expect(isUnsafeHostname('redis')).toBe(true)
    expect(isUnsafeHostname('2130706433')).toBe(true)
    expect(isUnsafeHostname('0x7f000001')).toBe(true)
    expect(isUnsafeHostname('0177.0.0.1')).toBe(true)

    expect(isUnsafeHostname('www.reinigungsberater.de')).toBe(false)
    expect(isUnsafeHostname('m.media-amazon.com')).toBe(false)
  })

  it('blocks unsafe schemes, internal hosts, credentials, and DNS rebinding targets', async () => {
    expect((await assertSafePublicUrl('')).safe).toBe(false)
    expect((await assertSafePublicUrl('file:///etc/passwd')).safe).toBe(false)
    expect((await assertSafePublicUrl('javascript:alert(1)')).safe).toBe(false)
    expect((await assertSafePublicUrl('http://127.0.0.1:5432/db.png')).safe).toBe(false)
    expect((await assertSafePublicUrl('http://169.254.169.254/latest/meta-data/')).safe).toBe(false)
    expect((await assertSafePublicUrl('https://user:secret@example.com/item')).safe).toBe(false)

    // DNS rebinding defense: public domain name resolving to private IP
    const rebindRes = await assertSafePublicUrl('https://evil.rebind.example/product', {
      dnsResolver: async () => ['169.254.169.254'],
    })
    expect(rebindRes.safe).toBe(false)

    const okRes = await assertSafePublicUrl('www.hygi.de/produkt-123', {
      dnsResolver: async () => ['104.18.10.20'],
    })
    expect(okRes.safe).toBe(true)
    expect(okRes.normalizedUrl).toBe('https://www.hygi.de/produkt-123')
  })

  it('follows safe public redirects and blocks redirects to internal hosts', async () => {
    const publicDns = async () => ['93.184.216.34']

    const evilRedirectFetch: typeof fetch = async () =>
      new Response(null, {
        status: 302,
        headers: { location: 'http://169.254.169.254/latest/meta-data/' },
      })

    await expect(
      safeFetchPublicUrl(
        'https://shop.example.com/item',
        {},
        { dnsResolver: publicDns, fetchImpl: evilRedirectFetch },
      ),
    ).rejects.toThrow(/blockiert|Unsafe/i)

    let calls = 0
    const safeRedirectFetch: typeof fetch = async (input) => {
      calls++
      if (calls === 1) {
        return new Response(null, {
          status: 301,
          headers: { location: 'https://www.shop.example.com/artikel-p-123' },
        })
      }
      expect(String(input)).toBe('https://www.shop.example.com/artikel-p-123')
      return new Response('<html>ok</html>', { status: 200 })
    }

    const res = await safeFetchPublicUrl(
      'https://shop.example.com/p/123',
      {},
      { dnsResolver: publicDns, fetchImpl: safeRedirectFetch },
    )
    expect(res.finalUrl).toBe('https://www.shop.example.com/artikel-p-123')
    expect(res.response.status).toBe(200)
  })
})

describe('urlSecurity - Image URL verification', () => {
  const publicDns = async () => ['93.184.216.34']

  it('accepts valid image/jpeg HEAD response and handles 405 with GET Range fallback', async () => {
    const validFetch: typeof fetch = async () =>
      new Response(null, { status: 200, headers: { 'content-type': 'image/jpeg' } })

    const r1 = await checkImageUrl('https://cdn.example.com/img.jpg', {
      dnsResolver: publicDns,
      fetchImpl: validFetch,
    })
    expect(r1.status).toBe('valid')

    const methods: string[] = []
    const methodFallbackFetch: typeof fetch = async (_url, init) => {
      methods.push(init?.method || 'GET')
      if (init?.method === 'HEAD') {
        return new Response(null, { status: 405 })
      }
      return new Response(new Uint8Array([0x89]), {
        status: 206,
        headers: { 'content-type': 'image/png' },
      })
    }

    const r2 = await checkImageUrl('https://cdn.example.com/img.png', {
      dnsResolver: publicDns,
      fetchImpl: methodFallbackFetch,
    })
    expect(methods).toEqual(['HEAD', 'GET'])
    expect(r2.status).toBe('valid')
  })

  it('rejects 404, 403, HTML pages, and internal SSRF image URLs as broken', async () => {
    const htmlFetch: typeof fetch = async () =>
      new Response(null, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
    const notFoundFetch: typeof fetch = async () => new Response(null, { status: 404 })

    expect(
      (await checkImageUrl('https://cdn.example.com/broken.jpg', { dnsResolver: publicDns, fetchImpl: htmlFetch }))
        .status,
    ).toBe('broken')
    expect(
      (await checkImageUrl('https://cdn.example.com/missing.jpg', { dnsResolver: publicDns, fetchImpl: notFoundFetch }))
        .status,
    ).toBe('broken')

    let fetchCalled = false
    const ssrfRes = await checkImageUrl('http://127.0.0.1/secret.png', {
      fetchImpl: async () => {
        fetchCalled = true
        return new Response(null, { status: 200 })
      },
    })
    expect(ssrfRes.status).toBe('broken')
    expect(fetchCalled).toBe(false)
  })

  it('pickVerifiedImageCandidates filters logos and broken URLs and prefers verified images', async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input)
      if (url.includes('404')) return new Response(null, { status: 404 })
      if (url.includes('html')) return new Response(null, { status: 200, headers: { 'content-type': 'text/html' } })
      return new Response(null, { status: 200, headers: { 'content-type': 'image/webp' } })
    }

    const result = await pickVerifiedImageCandidates(
      [
        'https://cdn.example.com/company-logo.png',
        'https://cdn.example.com/404.jpg',
        'https://cdn.example.com/html-redirect.jpg',
        'https://cdn.example.com/product-real.webp',
      ],
      { dnsResolver: publicDns, fetchImpl: mockFetch },
    )

    expect(result.bestImage).toBe('https://cdn.example.com/product-real.webp')
    expect(result.validAlternatives).toEqual(['https://cdn.example.com/product-real.webp'])
  })
})
