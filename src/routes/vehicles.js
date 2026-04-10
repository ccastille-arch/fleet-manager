const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { db } = require('../database');
const { enrichVehicle, formatCurrency, formatDate, STATUS_LABELS, STATUS_COLORS } = require('../lib/vehicle-utils');
const { requireAuth } = require('../middleware/auth');

const EDITABLE_FIELDS = [
  'unit_number','vin','year','make','model','trim','color',
  'driver_name','driver_email','driver_phone','department','leasing_company',
  'lease_start','lease_end','monthly_payment','total_lease_value',
  'mileage_allowance_annual','mileage_allowance_total','mileage_current',
  'insurance_expiry','notes',
];

router.use(requireAuth);

// GET /vehicles
router.get('/', async (req, res, next) => {
  try {
    const all = await db('vehicles').select('*');
    let enriched = all.map(enrichVehicle);

    const statusFilter = req.query.status || '';
    const q = (req.query.q || '').toLowerCase();

    if (statusFilter) enriched = enriched.filter(v => v.computed_status === statusFilter);
    if (q) {
      enriched = enriched.filter(v =>
        [v.unit_number, v.vin, v.make, v.model, v.driver_name, v.department, v.leasing_company]
          .some(f => f && f.toLowerCase().includes(q))
      );
    }

    const statusOrder = { expired: 0, over_mileage: 1, expiring_30: 2, near_mileage: 3, expiring_60: 4, expiring_90: 5, active: 6, returned: 7 };
    enriched.sort((a, b) => (statusOrder[a.computed_status] ?? 9) - (statusOrder[b.computed_status] ?? 9));

    res.render('vehicles', {
      user: req.session.user,
      vehicles: enriched,
      STATUS_LABELS,
      STATUS_COLORS,
      q: req.query.q || '',
      statusFilter,
      formatCurrency,
      formatDate,
    });
  } catch (e) { next(e); }
});

// GET /vehicles/new
router.get('/new', (req, res) => {
  res.render('vehicle-form', { user: req.session.user, v: {}, error: null, isNew: true });
});

// POST /vehicles/new
router.post('/new', async (req, res, next) => {
  try {
    const v = buildVehicleFromBody(req.body);
    v.id = uuidv4();
    v.status = 'active';
    v.created_at = Date.now();
    v.updated_at = Date.now();
    await db('vehicles').insert(v);
    res.redirect(`/vehicles/${v.id}`);
  } catch (e) { next(e); }
});

// GET /vehicles/:id
router.get('/:id', async (req, res, next) => {
  try {
    const v = await db('vehicles').where({ id: req.params.id }).first();
    if (!v) return res.status(404).render('error', { error: 'Vehicle not found', stack: null, user: req.session.user });
    res.render('vehicle', { user: req.session.user, v: enrichVehicle(v), formatCurrency, formatDate });
  } catch (e) { next(e); }
});

// GET /vehicles/:id/edit
router.get('/:id/edit', async (req, res, next) => {
  try {
    const v = await db('vehicles').where({ id: req.params.id }).first();
    if (!v) return res.status(404).render('error', { error: 'Vehicle not found', stack: null, user: req.session.user });
    res.render('vehicle-form', { user: req.session.user, v, error: null, isNew: false });
  } catch (e) { next(e); }
});

// PUT /vehicles/:id
router.put('/:id', async (req, res, next) => {
  try {
    const update = buildVehicleFromBody(req.body);
    update.updated_at = Date.now();
    await db('vehicles').where({ id: req.params.id }).update(update);
    res.redirect(`/vehicles/${req.params.id}`);
  } catch (e) { next(e); }
});

// DELETE /vehicles/:id
router.delete('/:id', async (req, res, next) => {
  try {
    await db('vehicles').where({ id: req.params.id }).delete();
    res.redirect('/vehicles');
  } catch (e) { next(e); }
});

// POST /vehicles/:id/return
router.post('/:id/return', async (req, res, next) => {
  try {
    await db('vehicles').where({ id: req.params.id }).update({ status: 'returned', updated_at: Date.now() });
    res.redirect(`/vehicles/${req.params.id}`);
  } catch (e) { next(e); }
});

// POST /vehicles/:id/activate (undo return)
router.post('/:id/activate', async (req, res, next) => {
  try {
    await db('vehicles').where({ id: req.params.id }).update({ status: 'active', updated_at: Date.now() });
    res.redirect(`/vehicles/${req.params.id}`);
  } catch (e) { next(e); }
});

function buildVehicleFromBody(body) {
  const v = {};
  for (const f of EDITABLE_FIELDS) {
    const raw = body[f];
    if (raw === undefined) continue;
    if (raw === '' || raw === null) { v[f] = null; continue; }
    if (['year', 'mileage_allowance_annual', 'mileage_allowance_total', 'mileage_current'].includes(f)) {
      const n = parseInt(raw);
      v[f] = isNaN(n) ? null : n;
    } else if (['monthly_payment', 'total_lease_value'].includes(f)) {
      const n = parseFloat(raw.toString().replace(/[$,]/g, ''));
      v[f] = isNaN(n) ? null : n;
    } else {
      v[f] = raw.toString().trim() || null;
    }
  }
  return v;
}

module.exports = router;
