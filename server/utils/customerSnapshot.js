// The customer's details as an invoice was confirmed (migration 045). Called
// in the transaction that confirms an invoice, so the document keeps the
// name, phone and TRN it was issued to even if the customer is edited later.
async function snapshotInvoiceCustomer(client, invoiceId) {
  await client.query(
    `UPDATE invoices i
        SET customer_snapshot = jsonb_build_object(
              'name', c.name, 'phone', c.phone, 'company', c.company_name,
              'trn', c.trn_number, 'email', c.email, 'address', c.address)
       FROM customers c
      WHERE i.id = $1 AND c.id = i.customer_id`,
    [invoiceId],
  );
}

// SQL for reading a customer field from the snapshot, falling back to the
// live customer row (alias `c`) for invoices confirmed before migration 045.
function snapshotField(field, column) {
  return `COALESCE(i.customer_snapshot->>'${field}', c.${column})`;
}

module.exports = { snapshotInvoiceCustomer, snapshotField };
