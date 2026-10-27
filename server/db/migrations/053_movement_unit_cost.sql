-- Migration 053: each stock movement keeps its own cost (inventory audit
-- INV-007).
--
-- The movement history used to show quantity × the product's CURRENT cost,
-- so a later receipt or cost edit changed the value of every past movement,
-- while the journal entry posted at the time kept the old cost. Now every
-- movement stores the unit cost it happened at: the receipt cost for a
-- purchase, the booked cost for a sale or its cancellation, and the
-- product's cost at that moment otherwise (the same cost the adjustment
-- journal uses).
--
-- Older movements stay NULL and show "cost not recorded": guessing their
-- cost now would make history look more exact than it is.

ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS unit_cost DECIMAL(12,2);
