// Tells every signed-in terminal that a customer's profile, balance or
// history changed. The payload carries only the id: each client re-fetches
// through the API, so what it sees stays governed by its own permissions.
// Call after the transaction has committed.
function emitCustomerChanged(io, customerId, reason) {
  if (!io || !customerId) return;
  io.emit('customer_changed', {
    customerId,
    reason,
    at: new Date().toISOString(),
  });
}

module.exports = { emitCustomerChanged };
