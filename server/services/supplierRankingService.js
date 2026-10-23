const { query } = require('../db/postgres');

// =======================================================================
// Supplier rankings (Analytics -> Suppliers)
//
// Three independent rankings, each with a simple tier:
//   1. Delivery  - promised vs real delivery date   -> honest | mid | low
//   2. Price     - cost on the SAME items as others -> lowest | mid | expensive
//   3. Volume    - quantity actually delivered      -> more | mid | less
//
// Delivery and price tiers use fixed thresholds (an absolute judgement:
// "delivers on time 9 times out of 10"); volume is relative to the other
// suppliers, so it needs at least two of them.
// =======================================================================

const THRESHOLDS = Object.freeze({
  // A supplier needs this many evaluated deliveries before it gets a tier.
  minDeliveries: 3,
  honestOnTimePct: 90,
  midOnTimePct: 70,
  // Price index vs the average of other suppliers for the same items.
  cheaperPct: -3,
  pricierPct: 3,
});

const round1 = (n) => (n == null ? null : Math.round(Number(n) * 10) / 10);

function deliveryTier(evaluated, onTimePct) {
  if (evaluated < THRESHOLDS.minDeliveries) return 'insufficient';
  if (onTimePct >= THRESHOLDS.honestOnTimePct) return 'honest';
  if (onTimePct >= THRESHOLDS.midOnTimePct) return 'mid';
  return 'low';
}

function priceTier(pricePct) {
  if (pricePct <= THRESHOLDS.cheaperPct) return 'lowest';
  if (pricePct >= THRESHOLDS.pricierPct) return 'expensive';
  return 'mid';
}

// rows must already be sorted best-first. Top third "more", bottom third
// "less", the rest "mid" (2 suppliers -> one each; 1 supplier -> "single").
function relativeTiers(n) {
  if (n < 2) return Array(n).fill('single');
  const k = Math.max(1, Math.round(n / 3));
  return Array.from({ length: n }, (_, i) => (i < k ? 'more' : i >= n - k ? 'less' : 'mid'));
}

function rankDelivery(rows) {
  const out = rows.map((r) => {
    const evaluated = Number(r.evaluated);
    const onTime = Number(r.on_time);
    const onTimePct = evaluated > 0 ? (onTime / evaluated) * 100 : 0;
    return {
      supplierId: r.supplier_id,
      supplierName: r.supplier_name,
      evaluated,
      onTime,
      onTimePct: round1(onTimePct),
      avgDaysLate: round1(r.avg_days_late || 0),
      openLate: Number(r.open_late || 0),
      tier: deliveryTier(evaluated, onTimePct),
    };
  });
  // Rated suppliers first, then best on-time %, then least late.
  out.sort(
    (a, b) =>
      (a.tier === 'insufficient') - (b.tier === 'insufficient') ||
      b.onTimePct - a.onTimePct ||
      a.avgDaysLate - b.avgDaysLate ||
      b.evaluated - a.evaluated,
  );
  return out.map((r, i) => ({ rank: i + 1, ...r }));
}

function rankPrice(rows) {
  const out = rows
    .filter((r) => r.price_index != null)
    .map((r) => {
      const pricePct = (Number(r.price_index) - 1) * 100;
      return {
        supplierId: r.supplier_id,
        supplierName: r.supplier_name,
        sharedItems: Number(r.shared_items),
        cheapestOn: Number(r.cheapest_on),
        pricePct: round1(pricePct),
        tier: priceTier(pricePct),
      };
    });
  out.sort((a, b) => a.pricePct - b.pricePct || b.sharedItems - a.sharedItems);
  return out.map((r, i) => ({ rank: i + 1, ...r }));
}

function rankVolume(rows, { includeCost }) {
  const sorted = rows
    .map((r) => ({
      supplierId: r.supplier_id,
      supplierName: r.supplier_name,
      quantity: round1(r.quantity),
      products: Number(r.products),
      deliveries: Number(r.deliveries),
      ...(includeCost ? { value: Math.round(Number(r.value) * 100) / 100 } : {}),
    }))
    .sort((a, b) => b.quantity - a.quantity || b.products - a.products);
  const tiers = relativeTiers(sorted.length);
  return sorted.map((r, i) => ({ rank: i + 1, ...r, tier: tiers[i] }));
}

async function getSupplierRankings({ startDate, endDate, includeCost = false }) {
  const params = [startDate, endDate];

  // 1. Delivery. "Promised" = the PO's expected date, or (when none was
  // entered) confirmation/order date + the supplier's default lead time.
  // An order still not delivered after its promised date counts as late,
  // so a supplier can't look reliable by simply never delivering.
  const delivery = query(
    `WITH po AS (
       SELECT p.supplier_id, p.received_date,
              COALESCE(p.expected_date,
                       COALESCE(p.confirmed_at::date, p.order_date)
                         + COALESCE(s.default_lead_time_days, 3)) AS promised
         FROM purchase_orders p
         JOIN suppliers s ON s.id = p.supplier_id
        WHERE p.status NOT IN ('draft', 'cancelled')
          AND COALESCE(p.confirmed_at::date, p.order_date) BETWEEN $1::date AND $2::date
     ),
     ev AS (
       SELECT supplier_id,
              received_date IS NULL AS still_open,
              CASE WHEN received_date IS NOT NULL THEN received_date - promised
                   WHEN promised < CURRENT_DATE THEN CURRENT_DATE - promised
              END AS days_late
         FROM po
     )
     SELECT ev.supplier_id, s.name AS supplier_name,
            COUNT(*)::int AS evaluated,
            COUNT(*) FILTER (WHERE days_late <= 0)::int AS on_time,
            COUNT(*) FILTER (WHERE still_open)::int AS open_late,
            AVG(GREATEST(days_late, 0))::float8 AS avg_days_late
       FROM ev
       JOIN suppliers s ON s.id = ev.supplier_id
      WHERE days_late IS NOT NULL
      GROUP BY ev.supplier_id, s.name`,
    params,
  );

  // 2. Price, from what was actually received (product_cost_history).
  // Only items bought from 2+ suppliers in the period are comparable. Each
  // supplier's price on an item is compared to the average of all suppliers
  // for that item, weighted by how much was spent on it.
  const price = includeCost
    ? query(
        `WITH per AS (
           SELECT supplier_id, COALESCE(variant_id, product_id) AS item_id,
                  SUM(cost_price * quantity_bought) / NULLIF(SUM(quantity_bought), 0) AS avg_cost,
                  SUM(cost_price * quantity_bought) AS spend
             FROM product_cost_history
            WHERE supplier_id IS NOT NULL AND quantity_bought > 0
              AND date BETWEEN $1::date AND $2::date
            GROUP BY supplier_id, COALESCE(variant_id, product_id)
         ),
         shared AS (
           SELECT item_id, AVG(avg_cost) AS market, MIN(avg_cost) AS best
             FROM per
            GROUP BY item_id
           HAVING COUNT(*) >= 2
         )
         SELECT per.supplier_id, s.name AS supplier_name,
                COUNT(*)::int AS shared_items,
                COUNT(*) FILTER (WHERE per.avg_cost <= shared.best)::int AS cheapest_on,
                (SUM(per.avg_cost / NULLIF(shared.market, 0) * per.spend)
                   / NULLIF(SUM(per.spend), 0))::float8 AS price_index
           FROM per
           JOIN shared USING (item_id)
           JOIN suppliers s ON s.id = per.supplier_id
          GROUP BY per.supplier_id, s.name`,
        params,
      )
    : null;

  // 3. Volume actually delivered (received), not just ordered.
  const volume = query(
    `SELECT h.supplier_id, s.name AS supplier_name,
            SUM(h.quantity_bought)::float8 AS quantity,
            COUNT(DISTINCT h.product_id)::int AS products,
            COUNT(DISTINCT h.purchase_order_id)::int AS deliveries,
            SUM(h.cost_price * h.quantity_bought)::float8 AS value
       FROM product_cost_history h
       JOIN suppliers s ON s.id = h.supplier_id
      WHERE h.quantity_bought > 0
        AND h.date BETWEEN $1::date AND $2::date
      GROUP BY h.supplier_id, s.name`,
    params,
  );

  const [d, p, v] = await Promise.all([delivery, price, volume]);
  const volumeRows = rankVolume(v.rows, { includeCost });
  const priceRows = p ? rankPrice(p.rows) : null;
  const priced = new Set((priceRows || []).map((r) => r.supplierId));

  return {
    startDate,
    endDate,
    thresholds: THRESHOLDS,
    delivery: rankDelivery(d.rows),
    // null = caller may not see cost prices.
    price: priceRows,
    // Suppliers that delivered in the period but share no items with others.
    priceNotComparable: priceRows
      ? volumeRows.filter((r) => !priced.has(r.supplierId)).map((r) => r.supplierName)
      : null,
    volume: volumeRows,
  };
}

module.exports = {
  getSupplierRankings,
  // exported for unit tests
  THRESHOLDS,
  deliveryTier,
  priceTier,
  relativeTiers,
  rankDelivery,
  rankPrice,
  rankVolume,
};
