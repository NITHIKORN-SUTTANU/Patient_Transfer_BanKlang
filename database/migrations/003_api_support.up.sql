SET LOCAL search_path = patient_transfer, public;
ALTER TABLE bookings ADD COLUMN cancellation_locked boolean NOT NULL DEFAULT false;
UPDATE bookings SET cancellation_locked=true WHERE started_at IS NOT NULL OR EXISTS
  (SELECT 1 FROM trip_events e WHERE e.booking_id=bookings.id AND e.command='DEPART_ORIGIN');
ALTER TABLE trip_events ADD COLUMN sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE;
CREATE INDEX resource_positions_vehicle ON resource_position_updates(vehicle_id, confirmed_at);
CREATE INDEX resource_positions_driver ON resource_position_updates(driver_id, confirmed_at);
CREATE UNIQUE INDEX resource_hold_open_vehicle ON resource_holds(booking_id,vehicle_id) WHERE ends_at IS NULL AND vehicle_id IS NOT NULL;
CREATE UNIQUE INDEX resource_hold_open_driver ON resource_holds(booking_id,driver_id) WHERE ends_at IS NULL AND driver_id IS NOT NULL;
