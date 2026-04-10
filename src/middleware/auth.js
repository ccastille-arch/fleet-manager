const express = require('express');
const router = express.Router();

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  res.redirect('/auth/login');
}

// GET /auth/login
router.get('/login', (req, res) => {
  if (req.session?.user) return res.redirect('/');
  res.render('login', { error: null, user: null });
});

// POST /auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};

  if (process.env.LOCAL_AUTH === 'true') {
    const isUser  = username === process.env.LOCAL_USERNAME  && password === process.env.LOCAL_PASSWORD;
    const isAdmin = username === process.env.ADMIN_USERNAME  && password === process.env.ADMIN_PASSWORD;

    if (isUser || isAdmin) {
      req.session.user = {
        username,
        name: isAdmin ? (process.env.ADMIN_NAME || username) : username,
        role: isAdmin ? 'admin' : 'user',
      };
      return req.session.save(() => res.redirect('/'));
    }
    return res.render('login', { error: 'Invalid username or password.', user: null });
  }

  // SSO mode — redirect to SSO authorize
  res.redirect('/auth/sso');
});

// GET /auth/sso — kicks off OAuth2 authorization code flow
router.get('/sso', (req, res) => {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.SSO_CLIENT_ID || '',
    redirect_uri: `${process.env.APP_URL || ''}/auth/callback`,
    scope: 'openid profile',
  });
  res.redirect(`${process.env.SSO_URL}/oauth/authorize?${params}`);
});

// GET /auth/callback — OAuth2 code exchange
router.get('/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/auth/login');

  try {
    const https = require('https');
    const http  = require('http');
    const url   = require('url');

    async function fetchJSON(reqUrl, options = {}, body = null) {
      return new Promise((resolve, reject) => {
        const parsed = new url.URL(reqUrl);
        const lib = parsed.protocol === 'https:' ? https : http;
        const reqOptions = {
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname + parsed.search,
          method: options.method || 'GET',
          headers: options.headers || {},
        };
        const req = lib.request(reqOptions, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try { resolve(JSON.parse(data)); } catch (e) { resolve(data); }
          });
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
      });
    }

    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${process.env.APP_URL}/auth/callback`,
      client_id: process.env.SSO_CLIENT_ID,
      client_secret: process.env.SSO_CLIENT_SECRET,
    }).toString();

    const tokens = await fetchJSON(`${process.env.SSO_URL}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(tokenBody) },
    }, tokenBody);

    if (!tokens.access_token) throw new Error('No access token from SSO');

    const userInfo = await fetchJSON(`${process.env.SSO_URL}/oauth/userinfo`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    req.session.user = {
      username: userInfo.username || userInfo.preferred_username || userInfo.sub,
      name: userInfo.name || userInfo.username,
      role: userInfo.role || 'user',
    };
    req.session.save(() => res.redirect('/'));
  } catch (e) {
    console.error('SSO callback error:', e.message);
    res.render('login', { error: 'SSO login failed. Please try again.', user: null });
  }
});

// POST /auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/auth/login'));
});

// GET /auth/logout (for nav link)
router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/auth/login'));
});

module.exports = router;
module.exports.requireAuth = requireAuth;
