import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import config from './routes/config.js'
import meta from './routes/meta.js'
import heroes from './routes/heroes.js'

const app = new Hono()

app.route('/api/config', config)
app.route('/api/meta', meta)
app.route('/api/heroes', heroes)

app.get('/api/health', (c) => c.json({ ok: true }))

const port = Number(process.env.PORT) || 3000
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API listening on http://localhost:${info.port}`)
})

export default app
