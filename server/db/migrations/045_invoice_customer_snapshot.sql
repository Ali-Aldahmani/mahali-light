-- Migration 045: an invoice keeps the customer's details as they were when
-- it was confirmed (invoice audit F11).
--
-- Invoices only stored customer_id, so a reprinted invoice showed whatever
-- the customer record says today (a new name, phone or TRN), and nothing
-- at all if the customer row was ever removed. customer_snapshot holds the
-- name, phone, company, TRN, email and address at confirmation; screens
-- and the PDF read it first and fall back to the live record.
--
-- Additive only. Existing invoices are left as they are (NULL): their
-- original details can't be recovered, and copying today's values in would
-- only pretend they were.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS customer_snapshot JSONB;
