SET LOCAL search_path = patient_transfer, public;
ALTER TABLE users ADD COLUMN revision bigint NOT NULL DEFAULT 1 CHECK (revision>0);
CREATE FUNCTION advance_user_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.revision := OLD.revision + 1;
  RETURN NEW;
END;
$$;
CREATE TRIGGER user_revision BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION advance_user_revision();
ALTER TABLE audit_logs ADD COLUMN before_data jsonb, ADD COLUMN after_data jsonb;
