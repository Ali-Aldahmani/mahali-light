-- Phase 7: PDF Generation & Printing.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS pdf_path VARCHAR(500);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS pdf_generated_at TIMESTAMPTZ;

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS pdf_path VARCHAR(500);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS pdf_generated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_invoices_pdf_generated_at ON invoices(pdf_generated_at);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_pdf_generated_at ON purchase_orders(pdf_generated_at);

-- Note: store-level settings (name, logo, TRN, footer) are read from
-- server/config/storeSettings.js until Phase 19 formalizes the settings table.
