SET LOCAL search_path = patient_transfer, public;
-- Runner permits rollback only on an empty application schema.
DROP TABLE resource_position_updates;
ALTER TABLE schedules DROP CONSTRAINT schedules_pickup_with_waiting;
ALTER TABLE schedules ADD CONSTRAINT schedules_pickup_route_only CHECK (pickup_at=arrival_at-pickup_to_hospital_seconds*interval '1 second');
ALTER TABLE schedules DROP COLUMN pickup_waiting_seconds;
ALTER TABLE schedules DROP COLUMN change_reason;
ALTER TABLE bookings DROP COLUMN execution_version;
ALTER TABLE schedules DROP CONSTRAINT schedules_origin_previous;
ALTER TABLE schedules DROP CONSTRAINT schedules_origin_kind_check;
ALTER TABLE schedules ADD CONSTRAINT schedules_origin_kind_check CHECK (origin_kind IN ('depot','previous_hospital'));
ALTER TABLE schedules ADD CONSTRAINT schedules_origin_previous CHECK
  ((origin_kind='depot' AND previous_booking_id IS NULL) OR (origin_kind='previous_hospital' AND previous_booking_id IS NOT NULL AND previous_booking_id<>booking_id));
ALTER TABLE trip_events DROP CONSTRAINT trip_events_command_check;
ALTER TABLE trip_events ADD CONSTRAINT trip_events_command_check CHECK (command IN
  ('APPROVE','CONFIRM_SCHEDULE','ASSIGN','START_TRIP','UNDO_START','DEPART_ORIGIN','CONFIRM_PICKUP','DEPART_FOR_HOSPITAL','CONFIRM_HANDOVER','CANCEL','REJECT','FAILED_PICKUP','REPORT_INCIDENT','RESOLVE_INCIDENT','ABORT','CONFIRM_READY','CORRECT_MILESTONE'));
ALTER TABLE trip_events DROP CONSTRAINT trip_events_command_keys;
ALTER TABLE trip_events ADD CONSTRAINT trip_events_command_keys CHECK
  (command_data - ARRAY['type','vehicleId','driverId','reason','endedAt','location','disposition','target','physicalStateConfirmed'] = '{}'::jsonb);
