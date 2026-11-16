SET LOCAL search_path=patient_transfer,public;
DROP TRIGGER bookings_preserve_intake_identity ON bookings;
DROP FUNCTION preserve_intake_identity();
DROP INDEX bookings_owner_intake_identity;
ALTER TABLE bookings DROP CONSTRAINT bookings_intake_identity,
  DROP COLUMN intake_request_id, DROP COLUMN intake_request_hash;
