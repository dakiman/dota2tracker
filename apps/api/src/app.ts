import { Hono } from 'hono'
import config from './routes/config.js'
import meta from './routes/meta.js'
import heroes from './routes/heroes.js'
import matches from './routes/matches.js'
import together from './routes/together.js'
import auth from './routes/auth.js'
import { sessionMiddleware, type AuthEnv } from './middleware/session.js'
import { rateLimit } from './middleware/rate-limit.js'
import { csrfMiddleware } from './middleware/csrf.js'

export const app = new Hono<AuthEnv>()

app.use('/api/auth/*', rateLimit({ windowMs: 60_000, max: 10 }))
app.use('/api/*', rateLimit({ windowMs: 60_000, max: 300 }))
app.use('/api/*', csrfMiddleware)
app.use('/api/*', sessionMiddleware)

app.route('/api/auth', auth)
app.route('/api/config', config)
app.route('/api/meta', meta)
app.route('/api/heroes', heroes)
app.route('/api/matches', matches)
app.route('/api/together', together)

app.get('/api/health', (c) => c.json({ ok: true }))
