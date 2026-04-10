const express = require('express');
const router = express.Router();
const { db } = require('../database');
const { enrichVehicle, formatCurrency, formatDate } = require('../lib/vehicle-utils');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const vehicles = await db('vehicles').select('*');
    const enriched = vehicles.map(enrichVehicle);

    const counts = {
      active: 0, expiring_30: 0, expiring_60: 0, expiring_90: 0,
      expired: 0, over_mileage: 0, near_mileage: 0, returned: 0,
    };
    let monthlyTotal = 0;

    for (const v of enriched) {
      if (counts[v.computed_status] !== undefined) counts[v.computed_status]++;
      if (v.monthly_payment) monthlyTotal += v.monthly_payment;
    }

    const expiringSoon  = enriched
      .filter(v => ['expiring_30', 'expiring_60', 'expiring_90', 'expired'].includes(v.computed_status))
      .sort((a, b) => (a.days_left ?? 9999) - (b.days_left ?? 9999))
      .slice(0, 10);

    const overMileage = enriched
      .filter(v => ['over_mileage', 'near_mileage'].includes(v.computed_status))
      .sort((a, b) => (b.mileage_pct || 0) - (a.mileage_pct || 0))
      .slice(0, 10);

    const topCost = [...enriched]
      .filter(v => v.monthly_payment && v.status !== 'returned')
      .sort((a, b) => b.monthly_payment - a.monthly_payment)
      .slice(0, 5);

    const recentUploads = await db('fleet_uploads').orderBy('uploaded_at', 'desc').limit(5);

    const flash = {
      uploaded: req.query.uploaded != null ? parseInt(req.query.uploaded) : null,
      updated:  req.query.updated  != null ? parseInt(req.query.updated)  : null,
    };

    res.render('dashboard', {
      user: req.session.user,
      counts,
      totalVehicles: vehicles.length,
      monthlyTotal,
      expiringSoon,
      overMileage,
      topCost,
      recentUploads,
      flash,
      formatCurrency,
      formatDate,
    });
  } catch (e) { next(e); }
});

module.exports = router;
