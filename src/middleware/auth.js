const express = require('express');
const router  = express.Router();

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  res.redirect('/auth/login');
}

// GET /auth/login
router.get('/login', (req, res) => {
  if (req.session?.user) return res.redirect('/');
  res.render('login', { error: null, user: null });
});

// POST /auth/login — local auth mode
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};

  if (process.env.LOCAL_AUTH === 'true') {
    const isUser  = username === process.env.LOCAL_USERNAME  && password === process.env.LOCAL_PASSWORD;
    const isAdmin = username === process.env.ADMIN_USERNAME  && password === process.env.ADMIN_PASSWORD;

    if (isUser || isAdmin) {
      req.session.user = {
        username,
        name:  isAdmin ? (process.env.ADMIN_NAME || username) : username,
        role:  isAdmin ? 'admin' : 'user',
      };
      return req.session.save(() => res.redirect('/'));
    }
    return res.render('login', { error: 'Invalid username or password.', user: null });
  }

  // SSO mode — redirect to SSO authorize
  res.redirect('/auth/sso');
});

// GET /auth/sso — starts OAuth2 flow toward SSO portal
router.get('/sso', (req, res) => {
  const ssoUrl    = process.env.SSO_URL    || '';
  const clientId  = process.env.SSO_CLIENT_ID || '';
  const appUrl    = process.env.APP_URL    || '';
  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     clientId,
    redirect_uri:  `${appUrl}/auth/callback`,
    scope:         'openid profile',
  });
  res.redirect(`${ssoUrl}/oauth/authorize?${params}`);
});

// GET /auth/callback — exchanges OAuth2 code for session
router.get('/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/auth/login');

  const ssoUrl      = process.env.SSO_URL    || '';
  const clientId    = process.env.SSO_CLIENT_ID    || '';
  const clientSecret= process.env.SSO_CLIENT_SECRET || '';
  const appUrl      = process.env.APP_URL    || '';
  const redirectUri = `${appUrl}/auth/callback`;

  try {
    // Exchange code for tokens
    const tokenRes = await fetch(`${ssoUrl}/oauth/token`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        grant_type:    'authorization_code',
        code,
        redirect_uri:  redirectUri,
        client_id:     clientId,
        client_secret: clientSecret,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error('SSO token error:', err);
      return res.render('login', { error: 'SSO login failed — token exchange error.', user: null });
    }

    const tokens = await tokenRes.json();
    if (!tokens.access_token) {
      return res.render('login', { error: 'SSO login failed — no access token.', user: null });
    }

    // Fetch user info
    const userRes = await fetch(`${ssoUrl}/oauth/userinfo`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userRes.ok) {
      return res.render('login', { error: 'SSO login failed — userinfo error.', user: null });
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
    res.render('login', { error: 'SSO login failed. Please try again.', user: null });
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
