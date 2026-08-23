-- Add a per-user secret token for secure inbound email routing.
-- Email address format changes from in-[USER_ID]@ to in-[USER_ID]-[SECRET]@
-- The secret prevents spoofed emails from injecting data into arbitrary accounts.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS inbound_email_secret TEXT;

-- Generate 32-char hex secrets for all existing users
UPDATE profiles
SET inbound_email_secret = md5(random()::text)
WHERE inbound_email_secret IS NULL;

-- Make non-null with auto-generated default for new users
ALTER TABLE profiles
  ALTER COLUMN inbound_email_secret SET DEFAULT md5(random()::text),
  ALTER COLUMN inbound_email_secret SET NOT NULL;
