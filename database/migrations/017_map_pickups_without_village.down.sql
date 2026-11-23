SET LOCAL search_path TO patient_transfer, public;

ALTER TABLE patient_profiles
  ALTER COLUMN village_id SET NOT NULL,
  DROP CONSTRAINT profiles_pickup_has_village_or_point;

ALTER TABLE bookings
  ALTER COLUMN village_id SET NOT NULL,
  DROP CONSTRAINT bookings_pickup_has_village_or_point;
