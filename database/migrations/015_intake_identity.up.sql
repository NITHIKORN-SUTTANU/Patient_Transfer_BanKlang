SET LOCAL search_path=patient_transfer,public;
ALTER TABLE bookings ADD COLUMN intake_request_id uuid,
  ADD COLUMN intake_request_hash text,
  ADD CONSTRAINT bookings_intake_identity CHECK (
    (intake_request_id IS NULL AND intake_request_hash IS NULL) OR
    (intake_request_id IS NOT NULL AND intake_request_hash IS NOT NULL AND intake_request_hash ~ '^[0-9a-f]{64}$'));
CREATE UNIQUE INDEX bookings_owner_intake_identity ON bookings(requester_id,intake_request_id)
  WHERE intake_request_id IS NOT NULL;
CREATE FUNCTION preserve_intake_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.intake_request_id,NEW.intake_request_hash) IS DISTINCT FROM ROW(OLD.intake_request_id,OLD.intake_request_hash) THEN
    RAISE EXCEPTION 'Intake identity is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bookings_preserve_intake_identity BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION preserve_intake_identity();
