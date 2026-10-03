-- Local account/session bootstrap extends the existing canonical principal alias.
-- Apply after 01-domain-contract.sql through the checksum-recording migrator.
ALTER TABLE auth_subject_alias ADD CONSTRAINT auth_subject_alias_bound_principal
  UNIQUE (issuer, subject, principal_id);

CREATE FUNCTION bootstrap_auth_immutable_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'AUTH_IDENTITY_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF NEW.issuer IS DISTINCT FROM OLD.issuer OR NEW.subject IS DISTINCT FROM OLD.subject
    OR NEW.principal_id IS DISTINCT FROM OLD.principal_id THEN
    RAISE EXCEPTION 'AUTH_IDENTITY_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER bootstrap_auth_alias_identity BEFORE UPDATE OF issuer, subject, principal_id OR DELETE
  ON auth_subject_alias FOR EACH ROW EXECUTE FUNCTION bootstrap_auth_immutable_identity();

CREATE TABLE bootstrap_auth_credential (
  issuer text NOT NULL,
  subject text NOT NULL,
  principal_id uuid NOT NULL,
  login text NOT NULL CHECK (length(btrim(login)) BETWEEN 1 AND 320),
  password_hash text NOT NULL CHECK (password_hash LIKE '$argon2id$%'),
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (issuer, subject),
  UNIQUE (issuer, login),
  FOREIGN KEY (issuer, subject, principal_id) REFERENCES auth_subject_alias(issuer, subject, principal_id)
);
CREATE TRIGGER bootstrap_auth_credential_identity BEFORE UPDATE OF issuer, subject, principal_id OR DELETE
  ON bootstrap_auth_credential FOR EACH ROW EXECUTE FUNCTION bootstrap_auth_immutable_identity();

CREATE TABLE bootstrap_auth_session (
  session_id uuid PRIMARY KEY,
  token_id uuid NOT NULL UNIQUE,
  issuer text NOT NULL,
  subject text NOT NULL,
  principal_id uuid NOT NULL,
  device_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (expires_at > created_at),
  FOREIGN KEY (issuer, subject, principal_id) REFERENCES auth_subject_alias(issuer, subject, principal_id)
);
CREATE INDEX bootstrap_auth_session_account ON bootstrap_auth_session(issuer, subject);
CREATE TRIGGER bootstrap_auth_session_identity BEFORE UPDATE OF issuer, subject, principal_id OR DELETE
  ON bootstrap_auth_session FOR EACH ROW EXECUTE FUNCTION bootstrap_auth_immutable_identity();

CREATE FUNCTION bootstrap_auth_immutable_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.session_id IS DISTINCT FROM OLD.session_id OR NEW.token_id IS DISTINCT FROM OLD.token_id
    OR NEW.device_id IS DISTINCT FROM OLD.device_id THEN
    RAISE EXCEPTION 'AUTH_SESSION_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER bootstrap_auth_session_binding BEFORE UPDATE OF session_id, token_id, device_id
  ON bootstrap_auth_session FOR EACH ROW EXECUTE FUNCTION bootstrap_auth_immutable_session();
