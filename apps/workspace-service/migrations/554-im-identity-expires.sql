-- W1-15 · relay token TTL bookkeeping. Additive: expires_at on im.im_identity.
ALTER TABLE im.im_identity
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

CREATE INDEX IF NOT EXISTS im_identity_expires_at ON im.im_identity (expires_at)
  WHERE expires_at IS NOT NULL;
