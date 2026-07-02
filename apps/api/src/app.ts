import { Hono } from 'hono'
import { cors } from 'hono/cors'
import config from './routes/config.js'
import meta from './routes/meta.js'
import heroes from './routes/heroes.js'

export const app = new Hono()

app.use(cors())

app.route('/api/config', config)
app.route('/api/meta', meta)
app.route('/api/heroes', heroes)

app.get('/api/health', (c) => c.json({ ok: true }))
