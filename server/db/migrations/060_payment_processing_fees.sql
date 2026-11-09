-- Card payment processing fees.
--
-- A provider (card acquirer or terminal) has its own fee: a percentage, a fixed
-- amount, or both, charged on the card-paid part of a sale. The fee a sale
-- incurred is recorded once, with the rates used, so later rate changes never
-- rewrite history. The customer is always refunded in full; by default the
-- original fee is not given back to the store, and a provider can be set to
-- give it back in proportion and/or to charge for each refund.
--
-- Fees are an expense of their own (5017), taken off contribution profit, not
-- gross profit.

CREATE TABLE IF NOT EXISTS payment_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  bank_account_id UUID REFERENCES bank_accounts(id) ON DELETE SET NULL,
  fee_method VARCHAR(20) NOT NULL DEFAULT 'percent'
    CHECK (fee_method IN ('percent', 'fixed', 'percent_fixed')),
  fee_percent DECIMAL(7,4) NOT NULL DEFAULT 0 CHECK (fee_percent >= 0 AND fee_percent <= 100),
  fee_fixed DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (fee_fixed >= 0),
  refund_fee_policy VARCHAR(20) NOT NULL DEFAULT 'none'
    CHECK (refund_fee_policy IN ('none', 'proportional')),
  refund_charge_method VARCHAR(20) NOT NULL DEFAULT 'none'
    CHECK (refund_charge_method IN ('none', 'percent', 'fixed', 'percent_fixed')),
  refund_charge_percent DECIMAL(7,4) NOT NULL DEFAULT 0 CHECK (refund_charge_percent >= 0 AND refund_charge_percent <= 100),
  refund_charge_fixed DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (refund_charge_fixed >= 0),
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_provider_name ON payment_providers (lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_provider_default ON payment_providers ((true))
  WHERE is_default AND is_active;

-- Which provider took a card payment. NULL: the default provider at confirm,
-- or no fee when none is set up.
ALTER TABLE invoice_payments ADD COLUMN IF NOT EXISTS provider_id UUID REFERENCES payment_providers(id) ON DELETE SET NULL;

-- One row per fee event. kind 'charge': the fee on one card payment, at
-- confirm. kind 'refund': card money given back, with the part of the fee the
-- provider returned (fee_refunded) and what it charged for the refund
-- (refund_charge). amount is the change to fee expense: charge + refund_charge
-- - fee_refunded.
CREATE TABLE IF NOT EXISTS payment_fees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  invoice_payment_id UUID REFERENCES invoice_payments(id) ON DELETE SET NULL,
  provider_id UUID REFERENCES payment_providers(id) ON DELETE SET NULL,
  provider_name VARCHAR(100) NOT NULL,
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('charge', 'refund')),
  source_type VARCHAR(30) NOT NULL,
  source_id UUID NOT NULL,
  base_amount DECIMAL(12,2) NOT NULL CHECK (base_amount >= 0),
  fee_method VARCHAR(20),
  fee_percent DECIMAL(7,4) NOT NULL DEFAULT 0,
  fee_fixed DECIMAL(12,2) NOT NULL DEFAULT 0,
  fee_amount DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
  fee_refunded DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (fee_refunded >= 0),
  refund_charge DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (refund_charge >= 0),
  amount DECIMAL(12,2) NOT NULL,
  bank_account_id UUID REFERENCES bank_accounts(id) ON DELETE SET NULL,
  fee_date DATE NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- A payment's fee is charged once, and each refund event is recorded once per
-- card payment.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_fee_once
  ON payment_fees (kind, source_type, source_id, invoice_payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_fees_invoice ON payment_fees(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payment_fees_date ON payment_fees(fee_date);

INSERT INTO chart_of_accounts (code, name, type, is_system, description) VALUES
  ('5017', 'Card Processing Fees', 'expense', true,
   'Fees card providers keep from card sales, less any fee they give back on refunds.')
ON CONFLICT (code) DO NOTHING;
UPDATE chart_of_accounts SET parent_id = (SELECT id FROM chart_of_accounts WHERE code = '5000')
 WHERE code = '5017' AND parent_id IS NULL;

INSERT INTO permissions (key, label, module) VALUES
  ('finance.manage_payment_fees', 'Manage Card Fees', 'finance')
ON CONFLICT (key) DO NOTHING;
