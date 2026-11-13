CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE SCHEMA patient_transfer;
SET LOCAL search_path = patient_transfer, public;

CREATE TYPE user_role AS ENUM ('citizen', 'dispatcher', 'driver', 'admin');
CREATE TYPE mobility_type AS ENUM ('standard', 'wheelchair', 'stretcher');
CREATE TYPE trip_status AS ENUM ('REQUESTED', 'APPROVED', 'SCHEDULED', 'ASSIGNED', 'PICKING_UP', 'PICKED_UP', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED', 'REJECTED', 'ABORTED');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role user_role NOT NULL,
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  line_subject text UNIQUE,
  username text,
  password_hash text,
  active boolean NOT NULL DEFAULT true,
  access_version bigint NOT NULL DEFAULT 1 CHECK (access_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (password_hash IS NULL OR username IS NOT NULL)
);
CREATE UNIQUE INDEX users_username ON users (lower(username)) WHERE username IS NOT NULL;

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  token_hash text NOT NULL UNIQUE,
  access_version bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX auth_sessions_user ON auth_sessions(user_id);

CREATE TABLE consent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  notice_version text NOT NULL,
  accepted boolean NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id, accepted)
);

CREATE TABLE locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('depot', 'hospital', 'pickup')),
  point geography(Point, 4326) NOT NULL,
  address text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true
);
CREATE INDEX locations_point ON locations USING gist(point);

CREATE TABLE service_villages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  village_number smallint NOT NULL UNIQUE CHECK (village_number BETWEEN 1 AND 12),
  name text NOT NULL,
  boundary geography(MultiPolygon, 4326),
  center geography(Point, 4326),
  radius_metres numeric,
  active boolean NOT NULL DEFAULT true,
  CHECK ((boundary IS NOT NULL AND center IS NULL AND radius_metres IS NULL)
    OR (boundary IS NULL AND center IS NOT NULL AND radius_metres > 0 AND radius_metres IS NOT NULL)),
  CHECK (boundary IS NULL OR ST_IsValid(boundary::geometry))
);
CREATE INDEX service_villages_boundary ON service_villages USING gist(boundary);
CREATE INDEX service_villages_center ON service_villages USING gist(center);

CREATE TABLE hospitals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL UNIQUE REFERENCES locations(id),
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE service_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  depot_location_id uuid NOT NULL REFERENCES locations(id),
  timezone text NOT NULL DEFAULT 'Asia/Bangkok' CHECK (timezone = 'Asia/Bangkok'),
  opens_at time NOT NULL DEFAULT '06:00' CHECK (opens_at = time '06:00'),
  closes_at time NOT NULL DEFAULT '16:00' CHECK (closes_at = time '16:00'),
  revision bigint NOT NULL DEFAULT 1
);
CREATE TABLE service_closures (
  closed_on date PRIMARY KEY,
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE patient_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES users(id),
  patient_name text NOT NULL,
  contact_phone text NOT NULL CHECK (contact_phone ~ '^0[0-9]{9}$'),
  mobility mobility_type NOT NULL,
  village_id uuid NOT NULL REFERENCES service_villages(id),
  pickup_location_id uuid NOT NULL REFERENCES locations(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, requester_id)
);
CREATE INDEX patient_profiles_requester ON patient_profiles(requester_id);

CREATE TABLE vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plate text NOT NULL UNIQUE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  capabilities mobility_type[] NOT NULL DEFAULT ARRAY['standard']::mobility_type[],
  location_id uuid NOT NULL REFERENCES locations(id),
  available_at timestamptz NOT NULL,
  CHECK (cardinality(capabilities) > 0)
);
CREATE TABLE drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id),
  active boolean NOT NULL DEFAULT true,
  capabilities mobility_type[] NOT NULL DEFAULT ARRAY['standard']::mobility_type[],
  location_id uuid NOT NULL REFERENCES locations(id),
  available_at timestamptz NOT NULL,
  CHECK (cardinality(capabilities) > 0)
);
CREATE TABLE availability_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid REFERENCES vehicles(id),
  driver_id uuid REFERENCES drivers(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  CHECK (num_nonnulls(vehicle_id, driver_id) = 1),
  CHECK (ends_at > starts_at)
);
CREATE INDEX availability_vehicle ON availability_windows(vehicle_id, starts_at);
CREATE INDEX availability_driver ON availability_windows(driver_id, starts_at);

CREATE TABLE bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE,
  requester_id uuid NOT NULL REFERENCES users(id),
  patient_profile_id uuid,
  consent_id uuid NOT NULL,
  consent_accepted boolean NOT NULL DEFAULT true CHECK (consent_accepted),
  patient_name text NOT NULL,
  requester_name text NOT NULL,
  contact_phone text NOT NULL CHECK (contact_phone ~ '^0[0-9]{9}$'),
  pickup_address text NOT NULL,
  pickup_point geography(Point, 4326) NOT NULL,
  landmark text NOT NULL DEFAULT '',
  village_id uuid NOT NULL REFERENCES service_villages(id),
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  mobility mobility_type NOT NULL,
  additional_assistance text NOT NULL DEFAULT '',
  submitted_at timestamptz NOT NULL DEFAULT now(),
  appointment_at timestamptz NOT NULL,
  status trip_status NOT NULL DEFAULT 'REQUESTED',
  started_at timestamptz,
  incident_open boolean NOT NULL DEFAULT false,
  schedule_review_required boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  FOREIGN KEY (consent_id, requester_id, consent_accepted) REFERENCES consent_records(id, user_id, accepted),
  FOREIGN KEY (patient_profile_id, requester_id) REFERENCES patient_profiles(id, requester_id),
  CHECK (appointment_at >= submitted_at + interval '48 hours'),
  CHECK (started_at IS NULL OR status NOT IN ('REQUESTED', 'APPROVED', 'SCHEDULED', 'REJECTED')),
  CHECK (status NOT IN ('PICKING_UP', 'PICKED_UP', 'IN_TRANSIT', 'COMPLETED', 'ABORTED') OR started_at IS NOT NULL)
);
CREATE INDEX bookings_requester ON bookings(requester_id, appointment_at);
CREATE INDEX bookings_queue ON bookings(status, appointment_at);
CREATE INDEX bookings_pickup ON bookings USING gist(pickup_point);

CREATE TABLE schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id),
  driver_id uuid NOT NULL REFERENCES drivers(id),
  origin_location_id uuid NOT NULL REFERENCES locations(id),
  origin_kind text NOT NULL CHECK (origin_kind IN ('depot', 'previous_hospital')),
  previous_booking_id uuid REFERENCES bookings(id),
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  appointment_at timestamptz NOT NULL,
  departure_at timestamptz NOT NULL,
  pickup_at timestamptz NOT NULL,
  arrival_at timestamptz NOT NULL,
  ready_at timestamptz NOT NULL,
  origin_to_pickup_seconds numeric NOT NULL CHECK (origin_to_pickup_seconds >= 0),
  pickup_to_hospital_seconds numeric NOT NULL CHECK (pickup_to_hospital_seconds >= 0),
  routing_source text NOT NULL,
  routed_at timestamptz NOT NULL,
  committed boolean NOT NULL DEFAULT false,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((origin_kind = 'depot' AND previous_booking_id IS NULL) OR (origin_kind = 'previous_hospital' AND previous_booking_id IS NOT NULL AND previous_booking_id <> booking_id)),
  CHECK (arrival_at = appointment_at - interval '20 minutes'),
  CHECK (ready_at = arrival_at + interval '30 minutes'),
  CHECK (pickup_at = arrival_at - pickup_to_hospital_seconds * interval '1 second'),
  CHECK (departure_at = pickup_at - origin_to_pickup_seconds * interval '1 second'),
  CHECK (departure_at < ready_at),
  CHECK ((departure_at AT TIME ZONE 'Asia/Bangkok')::date = (ready_at AT TIME ZONE 'Asia/Bangkok')::date),
  CHECK ((departure_at AT TIME ZONE 'Asia/Bangkok')::time >= time '06:00'),
  CHECK ((ready_at AT TIME ZONE 'Asia/Bangkok')::time <= time '16:00'),
  CONSTRAINT schedules_vehicle_no_overlap EXCLUDE USING gist
    (vehicle_id WITH =, tstzrange(departure_at, ready_at, '[)') WITH &&)
    WHERE (committed AND released_at IS NULL) DEFERRABLE INITIALLY IMMEDIATE,
  CONSTRAINT schedules_driver_no_overlap EXCLUDE USING gist
    (driver_id WITH =, tstzrange(departure_at, ready_at, '[)') WITH &&)
    WHERE (committed AND released_at IS NULL) DEFERRABLE INITIALLY IMMEDIATE
);
CREATE UNIQUE INDEX schedules_current_booking ON schedules(booking_id) WHERE committed AND released_at IS NULL;
CREATE INDEX schedules_previous_booking ON schedules(previous_booking_id);

CREATE TABLE resource_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid REFERENCES bookings(id),
  vehicle_id uuid REFERENCES vehicles(id),
  driver_id uuid REFERENCES drivers(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  created_by uuid NOT NULL REFERENCES users(id),
  CHECK (num_nonnulls(vehicle_id, driver_id) = 1),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX resource_holds_vehicle ON resource_holds(vehicle_id, starts_at);
CREATE INDEX resource_holds_driver ON resource_holds(driver_id, starts_at);

CREATE TABLE trip_events (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES bookings(id),
  actor_id uuid NOT NULL REFERENCES users(id),
  actor_role user_role NOT NULL,
  command text NOT NULL CHECK (command IN ('APPROVE', 'CONFIRM_SCHEDULE', 'ASSIGN', 'START_TRIP', 'UNDO_START', 'DEPART_ORIGIN', 'CONFIRM_PICKUP', 'DEPART_FOR_HOSPITAL', 'CONFIRM_HANDOVER', 'CANCEL', 'REJECT', 'FAILED_PICKUP', 'REPORT_INCIDENT', 'RESOLVE_INCIDENT', 'ABORT', 'CONFIRM_READY', 'CORRECT_MILESTONE')),
  command_data jsonb NOT NULL CHECK (jsonb_typeof(command_data) = 'object'),
  from_status trip_status NOT NULL,
  to_status trip_status NOT NULL,
  recorded_at timestamptz NOT NULL,
  CHECK (command_data - ARRAY['type', 'vehicleId', 'driverId', 'reason', 'endedAt', 'location', 'disposition', 'target', 'physicalStateConfirmed'] = '{}'::jsonb),
  CHECK (command_data ? 'type' AND command_data->>'type' IS NOT NULL AND command_data->>'type' = command)
);
CREATE INDEX trip_events_booking ON trip_events(booking_id, recorded_at);

CREATE TABLE trip_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id),
  reported_by uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  reported_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES users(id),
  resolution text,
  CHECK ((resolved_at IS NULL AND resolved_by IS NULL AND resolution IS NULL) OR
    (resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND resolution IS NOT NULL AND length(btrim(resolution)) > 0 AND resolved_at >= reported_at))
);
CREATE TABLE trip_dispositions (
  booking_id uuid PRIMARY KEY REFERENCES bookings(id),
  recorded_by uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  ended_at timestamptz NOT NULL,
  end_location text NOT NULL CHECK (length(btrim(end_location)) > 0),
  patient_arrangement text NOT NULL CHECK (length(btrim(patient_arrangement)) > 0),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ended_at <= recorded_at)
);
CREATE TABLE verification_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id),
  actor_id uuid NOT NULL REFERENCES users(id),
  outcome text NOT NULL,
  notes text NOT NULL DEFAULT '',
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id),
  recipient_id uuid NOT NULL REFERENCES users(id),
  event_id uuid REFERENCES trip_events(id),
  deduplication_key text NOT NULL UNIQUE,
  channel text NOT NULL DEFAULT 'LINE' CHECK (channel = 'LINE'),
  template_key text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz,
  sent_at timestamptz,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_pending ON notifications(next_attempt_at) WHERE status IN ('PENDING', 'FAILED');
CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  reason text,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_actor ON audit_logs(actor_id, recorded_at);

CREATE FUNCTION protect_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'History is append-only; use an approved retention maintenance process' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER trip_events_append_only BEFORE UPDATE OR DELETE ON trip_events FOR EACH ROW EXECUTE FUNCTION protect_history();
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION protect_history();
CREATE TRIGGER consent_records_append_only BEFORE UPDATE OR DELETE ON consent_records FOR EACH ROW EXECUTE FUNCTION protect_history();
CREATE TRIGGER dispositions_append_only BEFORE UPDATE OR DELETE ON trip_dispositions FOR EACH ROW EXECUTE FUNCTION protect_history();

CREATE FUNCTION flag_closure_assignments() RETURNS trigger LANGUAGE plpgsql
SET search_path = patient_transfer, public AS $$
BEGIN
  UPDATE bookings b SET schedule_review_required = true, revision = revision + 1
  WHERE b.status NOT IN ('COMPLETED', 'CANCELLED', 'REJECTED', 'ABORTED') AND EXISTS (
    SELECT 1 FROM schedules s WHERE s.booking_id = b.id AND s.committed AND s.released_at IS NULL
      AND (s.departure_at AT TIME ZONE 'Asia/Bangkok')::date = NEW.closed_on
  );
  RETURN NEW;
END;
$$;
CREATE TRIGGER closure_review AFTER INSERT OR UPDATE ON service_closures FOR EACH ROW EXECUTE FUNCTION flag_closure_assignments();

CREATE FUNCTION guard_schedule_commit() RETURNS trigger LANGUAGE plpgsql
SET search_path = patient_transfer, public AS $$
DECLARE
  b bookings%ROWTYPE;
BEGIN
  IF NEW.committed AND NEW.released_at IS NULL THEN
    -- Lock shared resource rows in a consistent order. API uses these same locks
    -- when modifying resource holds or readiness, then reruns domain validation.
    PERFORM 1 FROM vehicles WHERE id = NEW.vehicle_id FOR UPDATE;
    PERFORM 1 FROM drivers WHERE id = NEW.driver_id FOR UPDATE;
    SELECT * INTO b FROM bookings WHERE id = NEW.booking_id;
    IF b.appointment_at <> NEW.appointment_at OR b.hospital_id <> NEW.hospital_id THEN
      RAISE EXCEPTION 'Schedule snapshot does not match booking' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM service_closures WHERE closed_on = (NEW.departure_at AT TIME ZONE 'Asia/Bangkok')::date) THEN
      RAISE EXCEPTION 'Service closed on trip date' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM resource_holds h WHERE
      (h.vehicle_id = NEW.vehicle_id OR h.driver_id = NEW.driver_id)
      AND tstzrange(h.starts_at, h.ends_at, '[)') && tstzrange(NEW.departure_at, NEW.ready_at, '[)')) THEN
      RAISE EXCEPTION 'Resource readiness hold blocks assignment' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vehicles WHERE id = NEW.vehicle_id AND active AND b.mobility = ANY(capabilities))
      OR NOT EXISTS (SELECT 1 FROM drivers d JOIN users u ON u.id = d.user_id WHERE d.id = NEW.driver_id AND d.active AND u.active AND u.role = 'driver' AND b.mobility = ANY(d.capabilities)) THEN
      RAISE EXCEPTION 'Resources inactive or missing required capability' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM availability_windows WHERE vehicle_id = NEW.vehicle_id AND starts_at <= NEW.departure_at AND ends_at >= NEW.ready_at)
      OR NOT EXISTS (SELECT 1 FROM availability_windows WHERE driver_id = NEW.driver_id AND starts_at <= NEW.departure_at AND ends_at >= NEW.ready_at) THEN
      RAISE EXCEPTION 'Trip outside resource availability' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER schedule_commit_guard BEFORE INSERT OR UPDATE ON schedules FOR EACH ROW EXECUTE FUNCTION guard_schedule_commit();

CREATE FUNCTION invalidate_user_sessions() RETURNS trigger LANGUAGE plpgsql
SET search_path = patient_transfer, public AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role OR (OLD.active AND NOT NEW.active) OR NEW.password_hash IS DISTINCT FROM OLD.password_hash THEN
    NEW.access_version := OLD.access_version + 1;
    UPDATE auth_sessions SET revoked_at = coalesce(revoked_at, now()) WHERE user_id = OLD.id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER user_access_change BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION invalidate_user_sessions();

CREATE FUNCTION guard_resource_deactivation() RETURNS trigger LANGUAGE plpgsql
SET search_path = patient_transfer, public AS $$
BEGIN
  IF OLD.active AND NOT NEW.active AND EXISTS (
    SELECT 1 FROM schedules s JOIN bookings b ON b.id = s.booking_id
    WHERE s.committed AND s.released_at IS NULL
      AND b.status NOT IN ('COMPLETED', 'CANCELLED', 'REJECTED', 'ABORTED')
      AND ((TG_TABLE_NAME = 'vehicles' AND s.vehicle_id = NEW.id)
        OR (TG_TABLE_NAME = 'drivers' AND s.driver_id = NEW.id))
  ) THEN
    RAISE EXCEPTION 'Cannot deactivate a resource with unfinished assignments' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER vehicle_deactivation BEFORE UPDATE ON vehicles FOR EACH ROW EXECUTE FUNCTION guard_resource_deactivation();
CREATE TRIGGER driver_deactivation BEFORE UPDATE ON drivers FOR EACH ROW EXECUTE FUNCTION guard_resource_deactivation();

CREATE FUNCTION validate_aborted_disposition() RETURNS trigger LANGUAGE plpgsql
SET search_path = patient_transfer, public AS $$
DECLARE
  current_booking bookings%ROWTYPE;
BEGIN
  SELECT * INTO current_booking FROM bookings WHERE id = NEW.id;
  IF current_booking.status = 'ABORTED' AND NOT EXISTS (
    SELECT 1 FROM trip_dispositions d WHERE d.booking_id = NEW.id
      AND d.ended_at >= current_booking.started_at
  ) THEN
    RAISE EXCEPTION 'ABORTED requires a recorded patient disposition after trip start' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER aborted_disposition_required AFTER INSERT OR UPDATE ON bookings
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_aborted_disposition();
