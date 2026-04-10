require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const methodOverride = require('method-override');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { db, initDb } = require('./database');

const app = express();
const PORT = process.env.PORT || 3002;

app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net'],
      styleSrc: ["'self'", "'unsafe-inline'", 'fonts.googleapis.com'],
      fontSrc: ["'self'", 'fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
    }
  }
}));

class DbSessionStore extends session.Store {
  async get(sid, cb) {
    try {
      const row = await db('sessions').where({ sid }).first();
      if (!row || row.expires < Date.now()) return cb(null, null);
      cb(null, JSON.parse(row.data));
    } catch (e) { cb(e); }
  }
  async set(sid, sess, cb) {
    try {
      const expires = sess.cookie?.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + 86400000;
      const data = JSON.stringify(sess);
      const existing = await db('sessions').where({ sid }).first();
      if (existing) await db('sessions').where({ sid }).update({ data, expires });
      else await db('sessions').insert({ sid, data, expires });
      cb(null);
    } catch (e) { cb(e); }
  }
  async destroy(sid, cb) {
    try { await db('sessions').where({ sid }).delete(); cb(null); }
    catch (e) { cb(e); }
  }
  async touch(sid, sess, cb) {
    try {
      const expires = sess.cookie?.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + 86400000;
      await db('sessions').where({ sid }).update({ expires });
      cb(null);
    } catch (e) { cb(e); }
  }
}

app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false }));
app.use(session({
  store: new DbSessionStore(),
  secret: process.env.SESSION_SECRET || 'fleet-dev-secret-change-in-prod',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  },
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));
app.use(express.static(path.join(__dirname, '../public')));

app.get('/healthz', (req, res) => res.json({ ok: true }));

const authRouter = require('./middleware/auth');
const homeRouter = require('./routes/home');
const vehiclesRouter = require('./routes/vehicles');
const uploadRouter = require('./routes/upload');

app.use('/auth', authRouter);
app.use('/upload', uploadRouter);
app.use('/vehicles', vehiclesRouter);
app.use('/', homeRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', {
    error: err.message || 'Internal Server Error',
    stack: process.env.NODE_ENV !== 'production' ? err.stack : null,
    user: req.session?.user || null,
  });
});

initDb().then(() => {
  app.listen(PORT, () => console.log(`Fleet Manager running on http://localhost:${PORT}`));
}).catch(err => {
  console.error('DB init failed:', err);
  process.exit(1);
});
