SET LOCAL search_path = patient_transfer, public;

ALTER TABLE bookings
  ADD COLUMN booking_for text CHECK (booking_for IN ('self','other')),
  ADD COLUMN assistance text[] NOT NULL DEFAULT '{}';
ALTER TABLE patient_profiles
  ADD COLUMN landmark text NOT NULL DEFAULT '',
  ADD COLUMN assistance text[] NOT NULL DEFAULT '{}';

-- Existing relationships were not captured; NULL explicitly retains that uncertainty.
-- An assistance value is a set of the two approved transport-only codes.
ALTER TABLE bookings ADD CONSTRAINT bookings_assistance_codes CHECK (
  assistance <@ ARRAY['boarding_support','caregiver_accompanies']::text[]
  AND array_position(assistance,NULL) IS NULL
  AND cardinality(assistance) =
    (CASE WHEN 'boarding_support'=ANY(assistance) THEN 1 ELSE 0 END +
     CASE WHEN 'caregiver_accompanies'=ANY(assistance) THEN 1 ELSE 0 END));
ALTER TABLE patient_profiles ADD CONSTRAINT profiles_assistance_codes CHECK (
  assistance <@ ARRAY['boarding_support','caregiver_accompanies']::text[]
  AND array_position(assistance,NULL) IS NULL
  AND cardinality(assistance) =
    (CASE WHEN 'boarding_support'=ANY(assistance) THEN 1 ELSE 0 END +
     CASE WHEN 'caregiver_accompanies'=ANY(assistance) THEN 1 ELSE 0 END));
ALTER TABLE patient_profiles ADD CONSTRAINT profiles_landmark_length CHECK (char_length(landmark)<=1000);
