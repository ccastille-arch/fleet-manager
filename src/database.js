require('dotenv').config();
const knex = require('knex');
const path = require('path');

const isPostgres = !!process.env.DATABASE_URL;

const db = knex(
  isPostgres
    ? {
        client: 'pg',
        connection: { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } },
      }
    : {
        client: 'sqlite3',
        connection: { filename: path.join(__dirname, '../fleet.db') },
        useNullAsDefault: true,
      }
);

async function initDb() {
  const hasSessions = await db.schema.hasTable('sessions');
  if (!hasSessions) {
    await db.schema.createTable('sessions', t => {
      t.string('sid').primary();
      t.text('data').notNullable();
      t.bigInteger('expires').notNullable();
    });
  }

  const hasUploads = await db.schema.hasTable('fleet_uploads');
  if (!hasUploads) {
    await db.schema.createTable('fleet_uploads', t => {
      t.string('id').primary();
      t.string('original_name');
      t.bigInteger('uploaded_at');
      t.integer('row_count').defaultTo(0);
      t.integer('mapped_count').defaultTo(0);
      t.text('unmapped_headers');
      t.integer('inserted').defaultTo(0);
      t.integer('updated').defaultTo(0);
    });
  }

  const hasVehicles = await db.schema.hasTable('vehicles');
  if (!hasVehicles) {
    await db.schema.createTable('vehicles', t => {
      t.string('id').primary();
      t.string('source_upload_id');
      t.string('status').defaultTo('active');
      t.string('unit_number');
      t.string('vin');
      t.integer('year');
      t.string('make');
      t.string('model');
      t.string('trim');
      t.string('color');
      t.string('driver_name');
      t.string('driver_email');
      t.string('driver_phone');
      t.string('department');
      t.string('leasing_company');
      t.string('lease_start');
      t.string('lease_end');
      t.float('monthly_payment');
      t.float('total_lease_value');
      t.integer('mileage_allowance_annual');
      t.integer('mileage_allowance_total');
      t.integer('mileage_current');
      t.string('insurance_expiry');
      t.text('notes');
      t.bigInteger('created_at');
      t.bigInteger('updated_at');
    });
  }
}

module.exports = { db, initDb };
