const express = require('express');
const router  = express.Router();

// Sensible defaults so SSO works without manually setting every env var
const SSO_URL         = () => process.env.SSO_URL         || 'https://askcody.up.railway.app';
const SSO_CLIENT_ID   = () => process.env.SSO_CLIENT_ID   || 'fleet-manager-app';
const SSO_CLIENT_SECRET = () => process.env.SSO_CLIENT_SECRET || 'fleet-sso-secret-v1-change-in-prod';

function getCallbackUrl(req) {
  // Self-detect — works on Railway (https) and localhost (http) without APP_URL
  const host     = req.get('host');
  const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  return `${protocol}://${host}/auth/callback`;
}

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  res.redirect('/auth/login');
}

// GET /auth/login
router.get('/login', (req, res) => {
  if (req.session?.user) return res.redirect('/');
  const error = req.query.error || null;
  res.render('login', { error, user: null });
});

// POST /auth/login — local auth fallback
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
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
  res.render('login', { error: 'Invalid username or password.', user: null });
});

// GET /auth/callback — handles OAuth2 code from SSO portal
// This is the primary entry point when coming from askcody.up.railway.app
router.get('/callback', async (req, res) => {
  const { code } = req.query;

  // No code — just show login page
  if (!code) return res.redirect('/auth/login');

  const redirectUri = getCallbackUrl(req);

  try {
    const tokenRes = await fetch(`${SSO_URL()}/oauth/token`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        grant_type:    'authorization_code',
        code,
        redirect_uri:  redirectUri,
        client_id:     SSO_CLIENT_ID(),
        client_secret: SSO_CLIENT_SECRET(),
      }),
    });

    const tokens = await tokenRes.json();

    if (!tokens.access_token) {
      console.error('SSO token exchange failed:', tokens);
      return res.redirect('/auth/login?error=sso_failed');
    }

    const userRes = await fetch(`${SSO_URL()}/oauth/userinfo`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userRes.ok) {
      return res.redirect('/auth/login?error=sso_failed');
    }

    const info = await userRes.json();

    req.session.user = {
      username: info.preferred_username || info.sub,
      name:     info.name || info.preferred_username || info.sub,
      role:     info.role || 'user',
    };

    req.session.save(() => res.redirect('/'));
  } catch (e) {
    console.error('SSO callback error:', e.message);
    res.redirect('/auth/login?error=sso_failed');
  }
});

// POST & GET /auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/auth/login'));
});
router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/auth/login'));
});

module.exports = router;
module.exports.requireAuth = requireAuth;
