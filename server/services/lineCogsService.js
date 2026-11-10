// The cost of goods sold of one sale line, and what comes back of it.
//
// invoice_items.cogs_value is what the line's sale removed from the books
// (weighted average, migration 061); cogs_returned is how much of that has
// come back through returns and cancels. Goods coming back re-enter stock at
// exactly the value they left at, so the journal that reverses the original
// COGS matches the stock that returns. Lines from before migration 061 have
// no cogs_value and use quantity x cost_price_at_time, as their COGS did.

function money(n) {
  n = Number(n) || 0;
  return n < 0 ? -Math.round(-n * 100 + 1e-9) / 100 : Math.round(n * 100 + 1e-9) / 100;
}

async function lockLine(client, itemId) {
  const { rows: [line] } = await client.query(
    `SELECT id, quantity, cost_price_at_time, cogs_value, cogs_returned
       FROM invoice_items WHERE id = $1 FOR UPDATE`,
    [itemId],
  );
  return line || null;
}

const lineTotal = (line) => (line.cogs_value != null
  ? Number(line.cogs_value)
  : money(Number(line.quantity) * Number(line.cost_price_at_time || 0)));

/**
 * The book value of `qty` units of a line coming back from the customer
 * (a return or a cancel). `final` when these are the last units of the line
 * still out, so the whole remainder comes back and no cent is left over.
 * Records it in cogs_returned. Returns null for a line that doesn't exist.
 */
async function takeReturnedCogs(client, itemId, qty, { final = false } = {}) {
  const line = await lockLine(client, itemId);
  if (!line) return null;
  const total = lineTotal(line);
  const open = money(total - Number(line.cogs_returned || 0));
  const share = money((total * Number(qty)) / Number(line.quantity || 1));
  const value = Math.max(0, final ? open : Math.min(open, share));
  await client.query(`UPDATE invoice_items SET cogs_returned = cogs_returned + $2 WHERE id = $1`, [itemId, value]);
  return value;
}

/**
 * The book value of `qty` units taken off a line by an edit, which shrinks
 * the line itself. `final` when the line goes to zero.
 */
async function takeShrunkCogs(client, itemId, qty, { final = false } = {}) {
  const line = await lockLine(client, itemId);
  if (!line) return null;
  const total = lineTotal(line);
  const open = money(total - Number(line.cogs_returned || 0));
  const value = Math.max(0, final ? open : Math.min(open, money((total * Number(qty)) / Number(line.quantity || 1))));
  await client.query(`UPDATE invoice_items SET cogs_value = $2 WHERE id = $1`, [itemId, money(total - value)]);
  return value;
}

/** Sets a line's COGS from what its sale removed, with the unit cost shown. */
async function setLineCogs(client, itemId, value, quantity) {
  const v = money(value);
  const unit = Number(quantity) > 0 ? money(v / Number(quantity)) : 0;
  await client.query(
    `UPDATE invoice_items SET cogs_value = $2, cost_price_at_time = $3 WHERE id = $1`,
    [itemId, v, unit],
  );
  return { cogsValue: v, unitCost: unit };
}

/** Adds what an edit's extra units removed to an existing line's COGS. */
async function addLineCogs(client, itemId, value) {
  const line = await lockLine(client, itemId);
  if (!line) return;
  await client.query(`UPDATE invoice_items SET cogs_value = $2 WHERE id = $1`, [itemId, money(lineTotal(line) + Number(value))]);
}

module.exports = { takeReturnedCogs, takeShrunkCogs, setLineCogs, addLineCogs, lineTotal, money };
