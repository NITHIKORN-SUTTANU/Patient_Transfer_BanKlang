SET LOCAL search_path = patient_transfer, public;
ALTER TABLE bookings ADD COLUMN execution_version integer NOT NULL DEFAULT 0 CHECK (execution_version >= 0);
ALTER TABLE schedules ADD COLUMN pickup_waiting_seconds integer NOT NULL DEFAULT 0 CHECK (pickup_waiting_seconds >= 0);
ALTER TABLE schedules ADD COLUMN change_reason text;
DO $$
DECLARE constraint_name text;
BEGIN
  SELECT conname INTO STRICT constraint_name FROM pg_constraint
  WHERE conrelid = 'patient_transfer.schedules'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%(pickup_at =%';
  EXECUTE format('ALTER TABLE patient_transfer.schedules DROP CONSTRAINT %I', constraint_name);
END;
$$;
ALTER TABLE schedules ADD CONSTRAINT schedules_pickup_with_waiting
  CHECK (pickup_at = arrival_at - pickup_to_hospital_seconds * interval '1 second' - pickup_waiting_seconds * interval '1 second');
ALTER TABLE schedules DROP CONSTRAINT schedules_origin_kind_check;
ALTER TABLE schedules ADD CONSTRAINT schedules_origin_kind_check CHECK (origin_kind IN ('depot', 'previous_hospital', 'handoff'));
DO $$
DECLARE constraint_name text;
BEGIN
  SELECT conname INTO STRICT constraint_name FROM pg_constraint WHERE conrelid='patient_transfer.schedules'::regclass
    AND contype='c' AND pg_get_constraintdef(oid) LIKE '%previous_booking_id <> booking_id%';
  EXECUTE format('ALTER TABLE patient_transfer.schedules DROP CONSTRAINT %I', constraint_name);
END;
$$;
ALTER TABLE schedules ADD CONSTRAINT schedules_origin_previous
  CHECK ((origin_kind IN ('depot','handoff') AND previous_booking_id IS NULL) OR
    (origin_kind='previous_hospital' AND previous_booking_id IS NOT NULL AND previous_booking_id <> booking_id));
ALTER TABLE trip_events DROP CONSTRAINT trip_events_command_check;
ALTER TABLE trip_events ADD CONSTRAINT trip_events_command_check CHECK (command IN
  ('APPROVE','CONFIRM_SCHEDULE','ASSIGN','MODIFY_ASSIGNMENT','START_TRIP','UNDO_START','DEPART_ORIGIN','CONFIRM_PICKUP','DEPART_FOR_HOSPITAL','CONFIRM_HANDOVER','CANCEL','REJECT','FAILED_PICKUP','REPORT_INCIDENT','RESOLVE_INCIDENT','ABORT','CONFIRM_READY','CORRECT_MILESTONE'));
DO $$
DECLARE constraint_name text;
BEGIN
  SELECT conname INTO STRICT constraint_name FROM pg_constraint WHERE conrelid='patient_transfer.trip_events'::regclass
    AND contype='c' AND pg_get_constraintdef(oid) LIKE '%physicalStateConfirmed%';
  EXECUTE format('ALTER TABLE patient_transfer.trip_events DROP CONSTRAINT %I', constraint_name);
END;
$$;
ALTER TABLE trip_events ADD CONSTRAINT trip_events_command_keys CHECK
  (command_data - ARRAY['type','vehicleId','driverId','reason','endedAt','location','disposition','target','physicalStateConfirmed','arrangement'] = '{}'::jsonb);
CREATE TABLE resource_position_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid REFERENCES vehicles(id),
  driver_id uuid REFERENCES drivers(id),
  location_id uuid NOT NULL REFERENCES locations(id),
  confirmed_by uuid NOT NULL REFERENCES users(id),
  confirmed_at timestamptz NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  CHECK (num_nonnulls(vehicle_id,driver_id)=1)
);
