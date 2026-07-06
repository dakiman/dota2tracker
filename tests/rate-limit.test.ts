import { describe, it, expect, afterAll } from 'vitest'
import { Hono } from 'hono'
import { rateLimit } from '../apps/api/src/middleware/rate-limit.js'
import { app } from '../apps/api/src/app.js'
import { pool } from '@friendtracker/db'

afterAll(async () => {
  await pool.end()
})

function makeApp(windowMs: number, max: number, clock: { t: number }) {
  const a = new Hono()
  a.use('*', rateLimit({ windowMs, max, now: () => clock.t }))
  a.get('/x', (c) => c.json({ ok: true }))
  return a
}

describe('rateLimit', () => {
  it('allows up to max requests then 429s with Retry-After', async () => {
    const clock = { t: 0 }
    const a = makeApp(60_000, 3, clock)
    for (let i = 0; i < 3; i++) {
      const res = await a.request('/x', { headers: { 'x-real-ip': '10.7.0.1' } })
      expect(res.status).toBe(200)
    }
    const res = await a.request('/x', { headers: { 'x-real-ip': '10.7.0.1' } })
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0)
  })

  it('resets after the window rolls over', async () => {
    const clock = { t: 0 }
    const a = makeApp(60_000, 1, clock)
    await a.request('/x', { headers: { 'x-real-ip': '10.7.0.2' } })
    expect((await a.request('/x', { headers: { 'x-real-ip': '10.7.0.2' } })).status).toBe(429)
    clock.t = 60_001
    expect((await a.request('/x', { headers: { 'x-real-ip': '10.7.0.2' } })).status).toBe(200)
  })

  it('tracks distinct IPs independently', async () => {
    const clock = { t: 0 }
    const a = makeApp(60_000, 1, clock)
    expect((await a.request('/x', { headers: { 'x-real-ip': '10.7.0.3' } })).status).toBe(200)
    expect((await a.request('/x', { headers: { 'x-real-ip': '10.7.0.4' } })).status).toBe(200)
    expect((await a.request('/x', { headers: { 'x-real-ip': '10.7.0.3' } })).status).toBe(429)
  })
})

describe('app wiring', () => {
  it('strictly limits /api/auth/* (11th request in a minute is rejected)', async () => {
    let last = 200
    for (let i = 0; i < 11; i++) {
      const res = await app.request('/api/auth/me', { headers: { 'x-real-ip': '10.7.1.1' } })
      last = res.status
    }
    expect(last).toBe(429)
  })

  it('leaves normal reads under the global ceiling untouched', async () => {
    const res = await app.request('/api/health', { headers: { 'x-real-ip': '10.7.1.2' } })
    expect(res.status).toBe(200)
  })
})
