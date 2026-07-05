import { Hono } from 'hono'
import config from './routes/config.js'
import meta from './routes/meta.js'
import heroes from './routes/heroes.js'
import matches from './routes/matches.js'
import together from './routes/together.js'
import auth from './routes/auth.js'
import { sessionMiddleware, type AuthEnv } from './middleware/session.js'

export const app = new Hono<AuthEnv>()

app.use('/api/*', sessionMiddleware)

app.route('/api/auth', auth)
app.route('/api/config', config)
app.route('/api/meta', meta)
app.route('/api/heroes', heroes)
app.route('/api/matches', matches)
app.route('/api/together', together)

app.get('/api/health', (c) => c.json({ ok: true }))
