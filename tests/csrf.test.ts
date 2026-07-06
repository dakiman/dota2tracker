import { describe, it, expect, afterAll } from 'vitest'
import { app } from '../apps/api/src/app.js'
import { pool } from '@friendtracker/db'

afterAll(async () => {
  await pool.end()
})

describe('csrf origin check', () => {
  it('403s a mutating request with no Origin header', async () => {
    const res = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { 'x-real-ip': '10.9.0.1' },
    })
    expect(res.status).toBe(403)
  })

  it('403s a disallowed Origin', async () => {
    const res = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { origin: 'https://evil.example', 'x-real-ip': '10.9.0.2' },
    })
    expect(res.status).toBe(403)
  })

  it('passes an allowlisted Origin', async () => {
    const res = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { origin: 'http://localhost:5173', 'x-real-ip': '10.9.0.3' },
    })
    expect(res.status).toBe(200)
  })

  it('leaves GETs alone', async () => {
    const res = await app.request('/api/auth/me', { headers: { 'x-real-ip': '10.9.0.4' } })
    expect(res.status).toBe(200)
  })
})
