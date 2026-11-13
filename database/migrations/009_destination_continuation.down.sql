SET LOCAL search_path = patient_transfer, public;
DROP TRIGGER route_location_immutable ON locations;
DROP FUNCTION protect_route_location();
DROP TRIGGER schedule_continuation_guard ON schedules;
DROP TRIGGER route_leg_reservation_guard ON trip_route_legs;
DROP FUNCTION guard_continuation_reservations();
DROP VIEW effective_reservations;
DROP TABLE trip_route_legs;
ALTER TABLE trip_events DROP CONSTRAINT trip_events_command_check;
ALTER TABLE trip_events ADD CONSTRAINT trip_events_command_check CHECK (command IN
 ('APPROVE','CONFIRM_SCHEDULE','ASSIGN','MODIFY_ASSIGNMENT','START_TRIP','UNDO_START','DEPART_ORIGIN','CONFIRM_PICKUP','DEPART_FOR_HOSPITAL','CONFIRM_HANDOVER','CANCEL','REJECT','FAILED_PICKUP','REPORT_INCIDENT','RESOLVE_INCIDENT','ABORT','CONFIRM_READY','CORRECT_MILESTONE'));
ALTER TABLE trip_events DROP CONSTRAINT trip_events_command_keys;
ALTER TABLE trip_events ADD CONSTRAINT trip_events_command_keys CHECK
 (command_data - ARRAY['type','vehicleId','driverId','reason','endedAt','location','disposition','target','physicalStateConfirmed','arrangement'] = '{}'::jsonb);
