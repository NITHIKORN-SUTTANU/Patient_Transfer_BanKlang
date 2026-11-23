SET LOCAL search_path TO patient_transfer, public;

ALTER TABLE bookings
  ALTER COLUMN pickup_point DROP NOT NULL,
  ADD CONSTRAINT booking_pickup_required_for_service
    CHECK (pickup_point IS NOT NULL OR status IN ('REQUESTED', 'CANCELLED', 'REJECTED'));

ALTER TABLE patient_profiles
  ALTER COLUMN pickup_location_id DROP NOT NULL,
  ADD COLUMN pickup_address text,
  ADD CONSTRAINT profile_pickup_address_or_location
    CHECK ((pickup_location_id IS NOT NULL AND pickup_address IS NULL)
      OR (pickup_location_id IS NULL AND pickup_address IS NOT NULL
        AND char_length(btrim(pickup_address)) BETWEEN 1 AND 1000));

ALTER TABLE trip_events DROP CONSTRAINT trip_events_command_keys;
ALTER TABLE trip_events ADD CONSTRAINT trip_events_command_keys CHECK (
  command_data - ARRAY['type','vehicleId','driverId','reason','endedAt','location','disposition','target',
    'physicalStateConfirmed','arrangement','hospitalId','rejectionKind','capacityCheckId','pickup'] = '{}'::jsonb
  AND (NOT (command_data ? 'pickup') OR command = 'APPROVE'));
