const { query } = require('../db/postgres');

const INSERT_SQL = `INSERT INTO activity_log
     (entity_type, entity_id, action, performed_by, performed_by_name,
      old_value, new_value, notes)
   VALUES ($1,$2,$3,$4,(SELECT username FROM users WHERE id = $4),$5,$6,$7)`;

// Best-effort by default: a failed write only warns. Pass `client` (the
// caller's transaction) to make the entry required — a failure then throws
// and rolls the business change back with it.
async function logActivity({
  entityType,
  entityId = null,
  action,
  performedBy = null,
  oldValue = null,
  newValue = null,
  notes = null,
  client = null,
}) {
  const params = [
    entityType,
    entityId,
    action,
    performedBy,
    oldValue ? JSON.stringify(oldValue) : null,
    newValue ? JSON.stringify(newValue) : null,
    notes,
  ];
  if (client) {
    await client.query(INSERT_SQL, params);
    return;
  }
  try {
    await query(INSERT_SQL, params);
  } catch (err) {
    console.warn('[activity_log] failed to write entry', err.message);
  }
}

module.exports = { logActivity };
