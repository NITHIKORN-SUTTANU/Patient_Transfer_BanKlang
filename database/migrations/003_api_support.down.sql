SET LOCAL search_path = patient_transfer, public;
ALTER TABLE bookings DROP COLUMN cancellation_locked;
DROP INDEX resource_hold_open_driver;
DROP INDEX resource_hold_open_vehicle;
DROP INDEX resource_positions_driver;
DROP INDEX resource_positions_vehicle;
ALTER TABLE trip_events DROP COLUMN sequence;
