SET LOCAL search_path = patient_transfer, public;

ALTER TABLE schedules ADD COLUMN handover_at timestamptz;
ALTER TABLE schedules
  DROP CONSTRAINT schedules_check2,
  DROP CONSTRAINT schedules_check5,
  ADD CONSTRAINT schedules_check2 CHECK (ready_at IN (arrival_at, arrival_at + interval '30 minutes')),
  ADD CONSTRAINT schedules_check5 CHECK (departure_at <= arrival_at);
ALTER TABLE trip_route_legs DROP CONSTRAINT trip_route_legs_check1,
  ADD CONSTRAINT trip_route_legs_check1 CHECK (arrival_at >= recorded_at AND ready_at >= arrival_at);

-- Archive completion independently of the planned interval or assignment history.
DROP TRIGGER schedule_commit_guard ON schedules;
DROP TRIGGER schedule_window_guard ON schedules;
DROP TRIGGER schedule_continuation_guard ON schedules;
CREATE TRIGGER schedule_commit_guard BEFORE INSERT OR UPDATE ON schedules FOR EACH ROW
  WHEN (NEW.handover_at IS NULL) EXECUTE FUNCTION guard_schedule_commit();
CREATE TRIGGER schedule_window_guard BEFORE INSERT OR UPDATE ON schedules FOR EACH ROW
  WHEN (NEW.handover_at IS NULL) EXECUTE FUNCTION guard_active_schedule_windows();
CREATE TRIGGER schedule_continuation_guard AFTER INSERT OR UPDATE ON schedules FOR EACH ROW
  WHEN (NEW.handover_at IS NULL) EXECUTE FUNCTION guard_continuation_reservations();

UPDATE schedules s SET handover_at=e.recorded_at
FROM bookings b JOIN trip_events e ON e.booking_id=b.id AND e.command='CONFIRM_HANDOVER'
WHERE s.booking_id=b.id AND s.committed AND s.released_at IS NULL AND b.status='COMPLETED';

UPDATE resource_holds h SET ends_at=greatest(s.handover_at,h.starts_at+interval '1 microsecond')
FROM schedules s JOIN bookings b ON b.id=s.booking_id
WHERE h.booking_id=b.id AND s.handover_at IS NOT NULL AND NOT b.incident_open AND h.ends_at IS NULL
  AND (h.vehicle_id=s.vehicle_id OR h.driver_id=s.driver_id)
  AND h.reason='Hospital handover; turnaround/readiness pending' AND h.starts_at=s.handover_at;

CREATE FUNCTION guard_schedule_handover() RETURNS trigger LANGUAGE plpgsql
SET search_path = patient_transfer, public AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.handover_at IS NOT NULL AND NEW.handover_at IS DISTINCT FROM OLD.handover_at THEN
    RAISE EXCEPTION 'Recorded handover cannot be changed' USING ERRCODE='23514';
  END IF;
  IF NEW.handover_at IS NOT NULL AND (
    NOT NEW.committed OR NOT EXISTS (
      SELECT 1 FROM bookings b JOIN trip_events e ON e.booking_id=b.id
      WHERE b.id=NEW.booking_id AND b.status='COMPLETED' AND e.command='CONFIRM_HANDOVER' AND e.recorded_at=NEW.handover_at
    )
  ) THEN
    RAISE EXCEPTION 'Released occupancy requires recorded hospital handover' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER schedule_handover_guard BEFORE INSERT OR UPDATE OF handover_at ON schedules
  FOR EACH ROW EXECUTE FUNCTION guard_schedule_handover();

ALTER TABLE schedules DROP CONSTRAINT schedules_vehicle_no_overlap, DROP CONSTRAINT schedules_driver_no_overlap,
  ADD CONSTRAINT schedules_vehicle_no_overlap EXCLUDE USING gist
    (vehicle_id WITH =, tstzrange(departure_at,arrival_at,'[)') WITH &&)
    WHERE (committed AND released_at IS NULL AND handover_at IS NULL) DEFERRABLE INITIALLY IMMEDIATE,
  ADD CONSTRAINT schedules_driver_no_overlap EXCLUDE USING gist
    (driver_id WITH =, tstzrange(departure_at,arrival_at,'[)') WITH &&)
    WHERE (committed AND released_at IS NULL AND handover_at IS NULL) DEFERRABLE INITIALLY IMMEDIATE;

CREATE OR REPLACE VIEW effective_reservations AS
 SELECT s.id,s.booking_id,s.vehicle_id,s.driver_id,s.origin_location_id,s.previous_booking_id,s.departure_at,
 coalesce(r.arrival_at,s.arrival_at) AS effective_ready_at,
 coalesce(r.hospital_location_id,s.hospital_location_snapshot) AS effective_hospital_location_id
 FROM schedules s LEFT JOIN LATERAL (SELECT arrival_at,hospital_location_id FROM trip_route_legs
 WHERE schedule_id=s.id ORDER BY version DESC LIMIT 1) r ON true
 WHERE s.committed AND s.released_at IS NULL AND s.handover_at IS NULL;

CREATE OR REPLACE FUNCTION guard_continuation_reservations() RETURNS trigger LANGUAGE plpgsql
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
    OR NEW.confirmed_at<b.started_at
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
