import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import {
  steam64ToAccountId,
  buildLoginUrl,
  verifyAssertion,
} from '../apps/api/src/auth/openid.js'

const ORIGIN = 'http://localhost:5173'
let server: Server
let isValid = true

/** A structurally valid Steam assertion query for the given steam64. */
function assertionUrl(steam64: string, overrides: Record<string, string> = {}): URL {
  const p = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'id_res',
    'openid.op_endpoint': 'https://steamcommunity.com/openid/login',
    'openid.claimed_id': `https://steamcommunity.com/openid/id/${steam64}`,
    'openid.identity': `https://steamcommunity.com/openid/id/${steam64}`,
    'openid.return_to': `${ORIGIN}/api/auth/steam/return`,
    'openid.response_nonce': '2026-07-05T00:00:00Zabc',
    'openid.assoc_handle': 'h1',
    'openid.signed': 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',
    'openid.sig': 'ZmFrZXNpZw==',
    ...overrides,
  })
  return new URL(`${ORIGIN}/api/auth/steam/return?${p}`)
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      res.setHeader('content-type', 'text/plain')
      res.end(`ns:http://specs.openid.net/auth/2.0\nis_valid:${isValid}\n`)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  if (typeof addr === 'object' && addr) {
    process.env.OPENID_ENDPOINT = `http://127.0.0.1:${addr.port}/openid/login`
  }
})

afterAll(async () => {
  delete process.env.OPENID_ENDPOINT
  await new Promise((resolve) => server.close(resolve))
})

describe('steam64ToAccountId', () => {
  it('converts steam64 to the 32-bit account id', () => {
    expect(steam64ToAccountId('76561197960265839')).toBe('111')
  })
})

describe('buildLoginUrl', () => {
  it('points at the endpoint with realm/return_to derived from the origin', () => {
    const url = new URL(buildLoginUrl(ORIGIN))
    expect(url.searchParams.get('openid.mode')).toBe('checkid_setup')
    expect(url.searchParams.get('openid.realm')).toBe(ORIGIN)
    expect(url.searchParams.get('openid.return_to')).toBe(`${ORIGIN}/api/auth/steam/return`)
  })
})

describe('verifyAssertion', () => {
  it('returns the steam64 when Steam confirms the assertion', async () => {
    isValid = true
    await expect(verifyAssertion(assertionUrl('76561197960265839'), ORIGIN)).resolves.toBe(
      '76561197960265839'
    )
  })

  it('returns null when Steam rejects the assertion', async () => {
    isValid = false
    await expect(verifyAssertion(assertionUrl('76561197960265839'), ORIGIN)).resolves.toBeNull()
    isValid = true
  })

  it('rejects a wrong mode', async () => {
    const url = assertionUrl('76561197960265839', { 'openid.mode': 'cancel' })
    await expect(verifyAssertion(url, ORIGIN)).resolves.toBeNull()
  })

  it('rejects a non-Steam claimed_id', async () => {
    const url = assertionUrl('76561197960265839', {
      'openid.claimed_id': 'https://evil.example/openid/id/76561197960265839',
    })
    await expect(verifyAssertion(url, ORIGIN)).resolves.toBeNull()
  })

  it('rejects a tampered return_to', async () => {
    const url = assertionUrl('76561197960265839', {
      'openid.return_to': 'http://evil.example/api/auth/steam/return',
    })
    await expect(verifyAssertion(url, ORIGIN)).resolves.toBeNull()
  })

  it('rejects a signature that does not cover claimed_id', async () => {
    const url = assertionUrl('76561197960265839', {
      'openid.signed': 'signed,op_endpoint,identity,return_to,response_nonce,assoc_handle',
    })
    await expect(verifyAssertion(url, ORIGIN)).resolves.toBeNull()
  })
})
