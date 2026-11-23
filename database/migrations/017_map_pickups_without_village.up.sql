SET LOCAL search_path TO patient_transfer, public;

ALTER TABLE bookings
  ALTER COLUMN village_id DROP NOT NULL,
  ADD CONSTRAINT bookings_pickup_has_village_or_point CHECK (village_id IS NOT NULL OR pickup_point IS NOT NULL);

ALTER TABLE patient_profiles
  ALTER COLUMN village_id DROP NOT NULL,
  ADD CONSTRAINT profiles_pickup_has_village_or_point CHECK (village_id IS NOT NULL OR pickup_location_id IS NOT NULL);
