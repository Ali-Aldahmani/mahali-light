const { pad } = require('./codes');

// Atomically advance the per-year sequence for a document type and return the
// next number. Uses INSERT ... ON CONFLICT to keep things race-safe even
// without an outer transaction.
//
// `docType` examples: 'PO' (purchase order), 'SR' (supplier return).
async function nextDocumentNumber(client, docType, year) {
  const yr = year ?? new Date().getFullYear();
  const { rows } = await client.query(
    `INSERT INTO document_sequences (doc_type, year, last_value)
     VALUES ($1, $2, 1)
     ON CONFLICT (doc_type, year)
     DO UPDATE SET last_value = document_sequences.last_value + 1
     RETURNING last_value, year`,
    [docType, yr],
  );
  const { last_value, year: y } = rows[0];
  return { sequence: last_value, year: y, formatted: `${docType}-${y}-${pad(last_value, 4)}` };
}

module.exports = { nextDocumentNumber };
