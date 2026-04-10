/**
 * Smart fleet file parser — handles CSV and Excel from Enterprise, Ford Fleet, ARI, etc.
 * Maps common column names automatically to our internal schema.
 */

const { parse } = require('csv-parse/sync');
const XLSX = require('xlsx');

// Column alias map — keys are lowercase/normalized header names from source files
const ALIASES = {
  // Unit / fleet number
  'unit number': 'unit_number', 'unit #': 'unit_number', 'unit#': 'unit_number',
  'vehicle number': 'unit_number', 'fleet number': 'unit_number', 'asset number': 'unit_number',
  'asset #': 'unit_number', 'vehicle id': 'unit_number',

  // VIN
  'vin': 'vin', 'vin number': 'vin', 'vehicle identification number': 'vin',

  // Year / Make / Model
  'year': 'year', 'model year': 'year', 'yr': 'year',
  'make': 'make', 'manufacturer': 'make', 'vehicle make': 'make',
  'model': 'model', 'vehicle model': 'model',
  'trim': 'trim', 'style': 'trim',
  'color': 'color', 'exterior color': 'color',

  // Driver
  'driver': 'driver_name', 'driver name': 'driver_name', 'operator': 'driver_name',
  'assigned to': 'driver_name', 'employee': 'driver_name', 'employee name': 'driver_name',
  'driver email': 'driver_email', 'email': 'driver_email',
  'driver phone': 'driver_phone', 'phone': 'driver_phone',
  'department': 'department', 'dept': 'department', 'division': 'department',
  'cost center': 'department', 'cost centre': 'department',

  // Leasing company
  'leasing company': 'leasing_company', 'lessor': 'leasing_company',
  'fleet company': 'leasing_company', 'provider': 'leasing_company',

  // Dates
  'lease start': 'lease_start', 'start date': 'lease_start', 'lease start date': 'lease_start',
  'in-service date': 'lease_start', 'in service': 'lease_start',
  'lease end': 'lease_end', 'end date': 'lease_end', 'lease end date': 'lease_end',
  'expiration date': 'lease_end', 'maturity date': 'lease_end', 'return date': 'lease_end',
  'term end': 'lease_end',

  // Payments
  'monthly payment': 'monthly_payment', 'monthly cost': 'monthly_payment',
  'lease payment': 'monthly_payment', 'monthly charge': 'monthly_payment',
  'payment': 'monthly_payment', 'monthly rate': 'monthly_payment',
  'total lease value': 'total_lease_value', 'total cost': 'total_lease_value',

  // Mileage
  'mileage allowance': 'mileage_allowance_annual', 'allowed miles': 'mileage_allowance_annual',
  'annual mileage': 'mileage_allowance_annual', 'miles per year': 'mileage_allowance_annual',
  'annual miles': 'mileage_allowance_annual', 'mileage limit': 'mileage_allowance_annual',
  'contract miles': 'mileage_allowance_total', 'total miles allowed': 'mileage_allowance_total',
  'current mileage': 'mileage_current', 'odometer': 'mileage_current',
  'actual miles': 'mileage_current', 'miles': 'mileage_current', 'mileage': 'mileage_current',
  'current odometer': 'mileage_current',

  // Other
  'notes': 'notes', 'comments': 'notes', 'remarks': 'notes',
  'insurance expiry': 'insurance_expiry', 'insurance exp': 'insurance_expiry',
};

const FIELDS = [
  'unit_number','vin','year','make','model','trim','color',
  'driver_name','driver_email','driver_phone','department','leasing_company',
  'lease_start','lease_end','monthly_payment','total_lease_value',
  'mileage_allowance_annual','mileage_allowance_total','mileage_current',
  'insurance_expiry','notes',
];

function normalizeHeader(h) {
  return (h || '').toString().toLowerCase().trim().replace(/[_\-\/]/g, ' ').replace(/\s+/g, ' ');
}

function mapHeaders(rawHeaders) {
  // Returns { rawHeader: fieldName | null }
  const mapping = {};
  for (const raw of rawHeaders) {
    const norm = normalizeHeader(raw);
    mapping[raw] = ALIASES[norm] || null;
  }
  return mapping;
}

function cleanValue(val) {
  if (val == null) return null;
  const s = val.toString().trim();
  if (s === '' || s === '-' || s === 'N/A' || s === 'n/a' || s === 'NULL') return null;
  return s;
}

function parseDate(val) {
  if (!val) return null;
  const s = cleanValue(val);
  if (!s) return null;
  // Handle Excel date serial numbers
  if (!isNaN(s) && Number(s) > 10000) {
    const d = XLSX.SSF.parse_date_code(Number(s));
    if (d) return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
  }
  const d = new Date(s);
  if (!isNaN(d)) return d.toISOString().slice(0, 10);
  return null;
}

function parseMoney(val) {
  if (!val) return null;
  const n = parseFloat(val.toString().replace(/[$,\s]/g, ''));
  return isNaN(n) ? null : n;
}

function parseMiles(val) {
  if (!val) return null;
  const n = parseInt(val.toString().replace(/[,\s]/g, ''));
  return isNaN(n) ? null : n;
}

function rowToVehicle(row, mapping) {
  const v = {};
  for (const [rawHeader, fieldName] of Object.entries(mapping)) {
    if (!fieldName) continue;
    const raw = cleanValue(row[rawHeader]);
    if (raw == null) continue;

    if (['lease_start', 'lease_end', 'insurance_expiry'].includes(fieldName)) {
      v[fieldName] = parseDate(raw);
    } else if (['monthly_payment', 'total_lease_value'].includes(fieldName)) {
      v[fieldName] = parseMoney(raw);
    } else if (['mileage_current', 'mileage_allowance_annual', 'mileage_allowance_total'].includes(fieldName)) {
      v[fieldName] = parseMiles(raw);
    } else if (fieldName === 'year') {
      const yr = parseInt(raw);
      v[fieldName] = isNaN(yr) ? null : yr;
    } else {
      v[fieldName] = raw;
    }
  }
  return v;
}

function parseBuffer(buffer, mimetype, originalname) {
  const ext = (originalname || '').toLowerCase().split('.').pop();

  let rows = [];
  let headers = [];

  if (ext === 'csv' || mimetype === 'text/csv' || mimetype === 'application/csv') {
    // CSV parse
    const text = buffer.toString('utf8');
    const records = parse(text, { columns: true, skip_empty_lines: true, trim: true, bom: true });
    if (records.length === 0) throw new Error('CSV file appears to be empty.');
    headers = Object.keys(records[0]);
    rows = records;
  } else {
    // Excel parse
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    if (data.length < 2) throw new Error('Excel file has no data rows.');
    headers = data[0].map(h => h.toString());
    rows = data.slice(1).map(r => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = r[i] ?? ''; });
      return obj;
    });
    // Remove entirely blank rows
    rows = rows.filter(r => headers.some(h => r[h] && r[h].toString().trim()));
  }

  const mapping = mapHeaders(headers);
  const vehicles = rows.map(r => rowToVehicle(r, mapping));
  const mapped   = Object.values(mapping).filter(Boolean).length;
  const unmapped = headers.filter(h => !mapping[h]);

  return { vehicles, headers, mapping, mapped, unmapped, totalRows: rows.length };
}

module.exports = { parseBuffer, mapHeaders, FIELDS, ALIASES };
