-- Migration: add learning_logs column to shop_playbooks
-- Stores structured log entries from each learning run for live admin terminal display.
-- The column is reset to [] at the start of each run by the start-learning Edge Function.

ALTER TABLE public.shop_playbooks
  ADD COLUMN IF NOT EXISTS learning_logs JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.shop_playbooks.learning_logs IS
  'Array of {timestamp, level, message} log entries from the most recent learning run. '
  'Written fire-and-forget by the start-learning Edge Function. '
  'Levels: info | success | warning | error | dry_run';
