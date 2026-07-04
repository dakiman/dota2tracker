import { Hono } from 'hono'
import config from './routes/config.js'
import meta from './routes/meta.js'
import heroes from './routes/heroes.js'
import matches from './routes/matches.js'

export const app = new Hono()

app.route('/api/config', config)
app.route('/api/meta', meta)
app.route('/api/heroes', heroes)
app.route('/api/matches', matches)

app.get('/api/health', (c) => c.json({ ok: true }))
