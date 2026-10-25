-- Migration 049: tell "the app is connected" apart from "someone is using it"
-- (presence audit F08).
--
-- Heartbeats used to refresh last_activity_at every 30 seconds whether or
-- not anyone touched the till, so an unattended till never showed as idle.
-- Now a heartbeat always refreshes last_seen_at (the connection is alive),
-- and refreshes last_activity_at only when the screen reports real input.
-- The idle sweep reads last_activity_at; the 30-minute sign-out sweep reads
-- last_seen_at, so it still only signs out sessions whose app has gone away.
--
-- Additive only; NULL falls back to last_activity_at.

ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
