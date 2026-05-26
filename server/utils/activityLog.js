const { query } = require('../db/postgres');

async function logActivity({
  entityType,
  entityId = null,
  action,
  performedBy = null,
  oldValue = null,
  newValue = null,
  notes = null,
}) {
  try {
    await query(
      `INSERT INTO activity_log
         (entity_type, entity_id, action, performed_by, old_value, new_value, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        entityType,
        entityId,
        action,
        performedBy,
        oldValue ? JSON.stringify(oldValue) : null,
        newValue ? JSON.stringify(newValue) : null,
        notes,
      ],
    );
  } catch (err) {
    console.warn('[activity_log] failed to write entry', err.message);
  }
}

module.exports = { logActivity };
