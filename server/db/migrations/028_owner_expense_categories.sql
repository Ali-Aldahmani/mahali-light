-- Migration 028: expense categories + funding source for the custom
-- "Monthly Summary" report (mirrors this shop's own Excel bookkeeping,
-- which tracks Investor Profit and Showroom Capital Return as their own
-- monthly expense lines, and separately tracks whether an expense was
-- paid from the showroom's own funds or personally by the owner).

INSERT INTO expense_categories (name, type, icon)
VALUES
  ('Investor Profit', 'one_time', '💼'),
  ('Showroom Capital Return', 'one_time', '🏦'),
  ('Salary', 'recurring', '👤'),
  ('Commission', 'one_time', '🤝')
ON CONFLICT (name) DO NOTHING;

ALTER TABLE one_time_expenses
  ADD COLUMN IF NOT EXISTS funding_source VARCHAR(20) NOT NULL DEFAULT 'showroom';
  -- 'showroom' (paid from the shop's own cash/bank) or 'owner' (paid
  -- personally by the owner, i.e. reimbursable) — matches the Excel
  -- Summary sheet's "(A) Paid From Showroom" vs "(B) Paid by Owner" split.
