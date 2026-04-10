const express = require('express');
const router = express.Router();
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../database');
const { parseBuffer } = require('../lib/parser');
const { requireAuth } = require('../middleware/auth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(csv|xlsx|xls)$/i.test(file.originalname);
    cb(null, ok);
  },
});

router.use(requireAuth);

router.get('/', (req, res) => {
  res.render('upload', { user: req.session.user, error: null, success: null });
});

router.post('/', upload.single('file'), async (req, res, next) => {
  if (!req.file) {
    return res.render('upload', {
      user: req.session.user,
      error: 'Please select a CSV or Excel file.',
      success: null,
    });
  }

  try {
    const result = parseBuffer(req.file.buffer, req.file.mimetype, req.file.originalname);
    const uploadId = uuidv4();
    const now = Date.now();
    let inserted = 0;
    let updated = 0;

    for (const vehicle of result.vehicles) {
      // Skip completely empty rows
      if (!vehicle.vin && !vehicle.unit_number && !vehicle.make) continue;

      let existing = null;
      if (vehicle.vin) {
        existing = await db('vehicles').where({ vin: vehicle.vin }).first();
      }
      if (!existing && vehicle.unit_number) {
        existing = await db('vehicles').where({ unit_number: vehicle.unit_number }).first();
      }

      if (existing) {
        const updateData = { ...vehicle, updated_at: now, source_upload_id: uploadId };
        // Preserve manual returned status
        if (existing.status === 'returned') delete updateData.status;
        // Preserve existing notes if upload has none
        if (existing.notes && !vehicle.notes) delete updateData.notes;
        delete updateData.id;
        delete updateData.created_at;
        await db('vehicles').where({ id: existing.id }).update(updateData);
        updated++;
      } else {
        await db('vehicles').insert({
          id: uuidv4(),
          source_upload_id: uploadId,
          status: 'active',
          ...vehicle,
          created_at: now,
          updated_at: now,
        });
        inserted++;
      }
    }

    await db('fleet_uploads').insert({
      id: uploadId,
      original_name: req.file.originalname,
      uploaded_at: now,
      row_count: result.totalRows,
      mapped_count: result.mapped,
      unmapped_headers: JSON.stringify(result.unmapped),
      inserted,
      updated,
    });

    res.redirect(`/?uploaded=${inserted}&updated=${updated}`);
  } catch (e) {
    res.render('upload', { user: req.session.user, error: e.message, success: null });
  }
});

module.exports = router;
