import { describe, it, expect } from 'vitest'
import { app } from '../apps/api/src/app.js'

describe('CORS', () => {
  it('emits no CORS headers — the API is same-origin only', async () => {
    const res = await app.request('/api/health', {
      headers: { Origin: 'https://evil.example' },
    })
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })
})
