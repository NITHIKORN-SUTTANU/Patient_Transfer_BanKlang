SET LOCAL search_path TO patient_transfer, public;

ALTER TABLE trip_events DROP CONSTRAINT trip_events_command_keys;
ALTER TABLE trip_events ADD CONSTRAINT trip_events_command_keys CHECK (
  command_data - ARRAY['type','vehicleId','driverId','reason','endedAt','location','disposition','target',
    'physicalStateConfirmed','arrangement','hospitalId','rejectionKind','capacityCheckId'] = '{}'::jsonb);

ALTER TABLE patient_profiles
  ALTER COLUMN pickup_location_id SET NOT NULL,
  DROP CONSTRAINT profile_pickup_address_or_location,
  DROP COLUMN pickup_address;

ALTER TABLE bookings
  ALTER COLUMN pickup_point SET NOT NULL,
  DROP CONSTRAINT booking_pickup_required_for_service;
