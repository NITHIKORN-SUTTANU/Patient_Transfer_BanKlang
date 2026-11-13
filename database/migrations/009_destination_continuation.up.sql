SET LOCAL search_path = patient_transfer, public;
ALTER TABLE trip_events DROP CONSTRAINT trip_events_command_check;
ALTER TABLE trip_events ADD CONSTRAINT trip_events_command_check CHECK (command IN
 ('APPROVE','CONFIRM_SCHEDULE','ASSIGN','MODIFY_ASSIGNMENT','START_TRIP','UNDO_START','DEPART_ORIGIN','CONFIRM_PICKUP','DEPART_FOR_HOSPITAL','CONFIRM_HANDOVER','CANCEL','REJECT','FAILED_PICKUP','REPORT_INCIDENT','RESOLVE_INCIDENT','ABORT','CONFIRM_READY','CORRECT_MILESTONE','REVISE_DESTINATION'));
ALTER TABLE trip_events DROP CONSTRAINT trip_events_command_keys;
ALTER TABLE trip_events ADD CONSTRAINT trip_events_command_keys CHECK
 (command_data - ARRAY['type','vehicleId','driverId','reason','endedAt','location','disposition','target','physicalStateConfirmed','arrangement','hospitalId'] = '{}'::jsonb);
CREATE TABLE trip_route_legs (
 id uuid PRIMARY KEY REFERENCES trip_events(id) DEFERRABLE INITIALLY DEFERRED,
 booking_id uuid NOT NULL REFERENCES bookings(id), schedule_id uuid NOT NULL REFERENCES schedules(id),
 version integer NOT NULL CHECK(version>0), previous_leg_id uuid REFERENCES trip_route_legs(id),
 hospital_id uuid NOT NULL REFERENCES hospitals(id), hospital_location_id uuid NOT NULL REFERENCES locations(id), hospital_name text NOT NULL,
 origin_point geography(Point,4326) NOT NULL, origin_label text NOT NULL CHECK(length(btrim(origin_label))>0),
 confirmed_at timestamptz NOT NULL, recorded_at timestamptz NOT NULL, recorded_by uuid NOT NULL REFERENCES users(id),
 phase trip_status NOT NULL CHECK(phase IN ('PICKED_UP','IN_TRANSIT')),
 route_seconds integer NOT NULL CHECK(route_seconds>=0), routing_source text NOT NULL CHECK(length(btrim(routing_source))>0),
 arrival_at timestamptz NOT NULL, ready_at timestamptz NOT NULL,
 lateness_seconds integer NOT NULL CHECK(lateness_seconds>=0), appointment_lateness_seconds integer NOT NULL CHECK(appointment_lateness_seconds>=0),
 reason text NOT NULL CHECK(length(btrim(reason))>0), request_data jsonb NOT NULL,
 UNIQUE(booking_id,version),
 CHECK(confirmed_at<=recorded_at AND confirmed_at>=recorded_at-interval '5 minutes'),
 CHECK(arrival_at>=recorded_at AND ready_at>=arrival_at+interval '30 minutes')
);
CREATE INDEX route_legs_schedule ON trip_route_legs(schedule_id,version DESC);
CREATE TRIGGER route_legs_append_only BEFORE UPDATE OR DELETE ON trip_route_legs FOR EACH ROW EXECUTE FUNCTION protect_history();

-- Keep planned schedule rows intact. Effective reservations extend from their
-- original departure through the latest continuation's conservative readiness.
CREATE VIEW effective_reservations AS
 SELECT s.id,s.booking_id,s.vehicle_id,s.driver_id,s.origin_location_id,s.previous_booking_id,s.departure_at,
 coalesce(r.ready_at,s.ready_at) AS effective_ready_at,
 coalesce(r.hospital_location_id,s.hospital_location_snapshot) AS effective_hospital_location_id
 FROM schedules s LEFT JOIN LATERAL (SELECT ready_at,hospital_location_id FROM trip_route_legs
 WHERE schedule_id=s.id ORDER BY version DESC LIMIT 1) r ON true
 WHERE s.committed AND s.released_at IS NULL;
CREATE FUNCTION guard_continuation_reservations() RETURNS trigger LANGUAGE plpgsql
SET search_path = patient_transfer, public AS $$
DECLARE selected_schedule schedules%ROWTYPE; b bookings%ROWTYPE; prev trip_route_legs%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='trip_route_legs' THEN
  SELECT * INTO selected_schedule FROM schedules WHERE id=NEW.schedule_id;
 ELSE
  IF NOT NEW.committed OR NEW.released_at IS NOT NULL THEN RETURN NEW; END IF;
  selected_schedule:=NEW;
 END IF;
 PERFORM 1 FROM vehicles WHERE id=selected_schedule.vehicle_id FOR UPDATE;
 PERFORM 1 FROM drivers WHERE id=selected_schedule.driver_id FOR UPDATE;
 IF TG_TABLE_NAME='trip_route_legs' THEN
  SELECT * INTO b FROM bookings WHERE id=NEW.booking_id;
  SELECT * INTO prev FROM trip_route_legs WHERE booking_id=NEW.booking_id AND version<NEW.version ORDER BY version DESC LIMIT 1;
  IF selected_schedule.booking_id<>NEW.booking_id OR NOT selected_schedule.committed OR selected_schedule.released_at IS NOT NULL
    OR b.status NOT IN ('PICKED_UP','IN_TRANSIT') OR NEW.phase<>b.status OR b.started_at IS NULL
    OR NEW.confirmed_at<b.started_at OR NEW.ready_at<selected_schedule.ready_at
    OR NEW.version<>coalesce(prev.version,0)+1 OR NEW.previous_leg_id IS DISTINCT FROM prev.id
    OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.recorded_by AND role='dispatcher' AND active)
    OR NOT EXISTS(SELECT 1 FROM hospitals WHERE id=NEW.hospital_id AND active AND location_id=NEW.hospital_location_id)
    OR NOT EXISTS(SELECT 1 FROM trip_events WHERE id=NEW.id AND booking_id=b.id AND actor_id=NEW.recorded_by AND actor_role='dispatcher' AND command='REVISE_DESTINATION' AND from_status=b.status AND to_status=b.status)
    OR NOT EXISTS(SELECT 1 FROM trip_events WHERE booking_id=b.id AND command='CONFIRM_PICKUP' AND recorded_at<=NEW.confirmed_at) THEN
    RAISE EXCEPTION 'Invalid active continuation or route version' USING ERRCODE='23514';
  END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM effective_reservations a JOIN effective_reservations z ON a.id<>z.id
   AND (a.vehicle_id=z.vehicle_id OR a.driver_id=z.driver_id)
   AND tstzrange(a.departure_at,a.effective_ready_at,'[)') && tstzrange(z.departure_at,z.effective_ready_at,'[)')
   WHERE a.id=selected_schedule.id) THEN
  RAISE EXCEPTION 'Continuation conflicts with another committed resource interval' USING ERRCODE='23P01';
 END IF;
 IF EXISTS(SELECT 1 FROM effective_reservations a JOIN effective_reservations z ON z.previous_booking_id=a.booking_id
   WHERE (a.id=selected_schedule.id OR z.id=selected_schedule.id)
   AND (z.origin_location_id<>a.effective_hospital_location_id OR z.departure_at<a.effective_ready_at)) THEN
  RAISE EXCEPTION 'Continuation invalidates a downstream chained origin' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER route_leg_reservation_guard AFTER INSERT ON trip_route_legs FOR EACH ROW EXECUTE FUNCTION guard_continuation_reservations();
CREATE TRIGGER schedule_continuation_guard AFTER INSERT OR UPDATE ON schedules FOR EACH ROW EXECUTE FUNCTION guard_continuation_reservations();
CREATE FUNCTION protect_route_location() RETURNS trigger LANGUAGE plpgsql SET search_path=patient_transfer,public AS $$
BEGIN
 IF NOT ST_Equals(NEW.point::geometry,OLD.point::geometry) AND EXISTS(SELECT 1 FROM trip_route_legs WHERE hospital_location_id=OLD.id) THEN
 RAISE EXCEPTION 'Route destination geometry is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER route_location_immutable BEFORE UPDATE OF point ON locations FOR EACH ROW EXECUTE FUNCTION protect_route_location();
