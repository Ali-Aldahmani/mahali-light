const { pad } = require('./codes');

// Atomically advance the per-year (and optionally per-scope) sequence for a
// document type and return the next number. Uses INSERT ... ON CONFLICT to
// keep things race-safe even without an outer transaction.
//
// `docType` examples:
//   'PO'  (purchase order)         → PO-2026-0042
//   'SR'  (supplier return)        → SR-2026-0007
//   'INV' (invoice, per PC)        → INV-2026-P1-00042
//                                     pad width 5, scope = PC identifier
//
// Options:
//   scope   — string used to keep separate sequences for the same docType in
//             the same year (e.g. PC1, PC2). Empty string means a single
//             global sequence.
//   padWidth — sequence zero-pad width (default 4).
async function nextDocumentNumber(
  client,
  docType,
  year,
  { scope = '', padWidth = 4 } = {},
) {
  const yr = year ?? new Date().getFullYear();
  const { rows } = await client.query(
    `INSERT INTO document_sequences (doc_type, year, scope, last_value)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (doc_type, year, scope)
     DO UPDATE SET last_value = document_sequences.last_value + 1
     RETURNING last_value, year`,
    [docType, yr, scope],
  );
  const { last_value, year: y } = rows[0];
  const formatted = scope
    ? `${docType}-${y}-${scope}-${pad(last_value, padWidth)}`
    : `${docType}-${y}-${pad(last_value, padWidth)}`;
  return { sequence: last_value, year: y, scope, formatted };
}

module.exports = { nextDocumentNumber };
