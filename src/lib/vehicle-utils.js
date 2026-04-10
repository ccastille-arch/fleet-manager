/**
 * Fleet vehicle utility functions — status calculation, cost analysis, projections
 */

const STATUS = {
  ACTIVE:        'active',
  EXPIRING_30:   'expiring_30',
  EXPIRING_60:   'expiring_60',
  EXPIRING_90:   'expiring_90',
  EXPIRED:       'expired',
  OVER_MILEAGE:  'over_mileage',
  NEAR_MILEAGE:  'near_mileage',   // >90% mileage used
  RETURNED:      'returned',
};

const STATUS_LABELS = {
  active:        'Active',
  expiring_30:   'Expiring < 30 days',
  expiring_60:   'Expiring < 60 days',
  expiring_90:   'Expiring < 90 days',
  expired:       'Expired',
  over_mileage:  'Over Mileage',
  near_mileage:  'Near Mileage Limit',
  returned:      'Returned',
};

const STATUS_COLORS = {
  active:       '#00d4a0',
  expiring_30:  '#ff3355',
  expiring_60:  '#ff6b00',
  expiring_90:  '#ffd60a',
  expired:      '#ff3355',
  over_mileage: '#ff3355',
  near_mileage: '#ffd60a',
  returned:     '#4a6080',
};

function calcStatus(vehicle) {
  if (vehicle.status === 'returned') return STATUS.RETURNED;

  const now      = new Date();
  const leaseEnd = vehicle.lease_end ? new Date(vehicle.lease_end) : null;

  const daysLeft = leaseEnd
    ? Math.ceil((leaseEnd - now) / 86400000)
    : null;

  // Mileage check
  const totalAllowance = vehicle.mileage_allowance_total ||
    (vehicle.mileage_allowance_annual && vehicle.lease_start && leaseEnd
      ? vehicle.mileage_allowance_annual * ((leaseEnd - new Date(vehicle.lease_start)) / (365.25 * 86400000))
      : null);

  const mileagePct = (totalAllowance && vehicle.mileage_current)
    ? (vehicle.mileage_current / totalAllowance) * 100
    : null;

  if (daysLeft !== null && daysLeft < 0) return STATUS.EXPIRED;
  if (mileagePct !== null && mileagePct >= 100) return STATUS.OVER_MILEAGE;
  if (mileagePct !== null && mileagePct >= 90)  return STATUS.NEAR_MILEAGE;
  if (daysLeft !== null && daysLeft <= 30) return STATUS.EXPIRING_30;
  if (daysLeft !== null && daysLeft <= 60) return STATUS.EXPIRING_60;
  if (daysLeft !== null && daysLeft <= 90) return STATUS.EXPIRING_90;
  return STATUS.ACTIVE;
}

function enrichVehicle(v) {
  const now      = new Date();
  const leaseEnd = v.lease_end  ? new Date(v.lease_end)  : null;
  const leaseStart = v.lease_start ? new Date(v.lease_start) : null;

  const daysLeft = leaseEnd ? Math.ceil((leaseEnd - now) / 86400000) : null;
  const totalLeaseDays = (leaseStart && leaseEnd) ? Math.ceil((leaseEnd - leaseStart) / 86400000) : null;
  const daysElapsed    = (leaseStart) ? Math.ceil((now - leaseStart) / 86400000) : null;
  const timePct = (totalLeaseDays && daysElapsed) ? Math.min(100, Math.round(daysElapsed / totalLeaseDays * 100)) : null;

  const totalAllowance = v.mileage_allowance_total ||
    (v.mileage_allowance_annual && leaseStart && leaseEnd
      ? Math.round(v.mileage_allowance_annual * ((leaseEnd - leaseStart) / (365.25 * 86400000)))
      : null);

  const mileagePct = (totalAllowance && v.mileage_current)
    ? Math.min(200, Math.round(v.mileage_current / totalAllowance * 100))
    : null;

  // Cost analysis
  const monthsElapsed = daysElapsed ? daysElapsed / 30.44 : null;
  const costToDate    = (monthsElapsed && v.monthly_payment) ? Math.round(monthsElapsed * v.monthly_payment) : null;
  const costPerMile   = (costToDate && v.mileage_current && v.mileage_current > 0)
    ? (costToDate / v.mileage_current).toFixed(2) : null;

  // Projected mileage at lease end
  const milesPerDay     = (daysElapsed && v.mileage_current && daysElapsed > 0) ? v.mileage_current / daysElapsed : null;
  const projectedFinal  = (milesPerDay && daysLeft && daysLeft > 0) ? Math.round(v.mileage_current + milesPerDay * daysLeft) : null;
  const projectedOverage = (projectedFinal && totalAllowance) ? Math.max(0, projectedFinal - totalAllowance) : null;

  const computedStatus = calcStatus(v);

  return {
    ...v,
    computed_status:    computedStatus,
    status_label:       STATUS_LABELS[computedStatus] || computedStatus,
    status_color:       STATUS_COLORS[computedStatus] || '#4a6080',
    days_left:          daysLeft,
    time_pct:           timePct,
    total_allowance:    totalAllowance,
    mileage_pct:        mileagePct,
    cost_to_date:       costToDate,
    cost_per_mile:      costPerMile,
    projected_final:    projectedFinal,
    projected_overage:  projectedOverage,
  };
}

function formatCurrency(n) {
  if (n == null) return '—';
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

module.exports = { STATUS, STATUS_LABELS, STATUS_COLORS, calcStatus, enrichVehicle, formatCurrency, formatDate };
