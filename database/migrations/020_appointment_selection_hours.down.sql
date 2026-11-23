SET LOCAL search_path = patient_transfer, public;

-- Refuse rollback if a schedule has already used the new timing rule.
ALTER TABLE schedules
  ADD CONSTRAINT schedules_check6 CHECK ((departure_at AT TIME ZONE 'Asia/Bangkok')::date = (ready_at AT TIME ZONE 'Asia/Bangkok')::date),
  ADD CONSTRAINT schedules_departure_at_check CHECK ((departure_at AT TIME ZONE 'Asia/Bangkok')::time >= time '06:00'),
  ADD CONSTRAINT schedules_ready_at_check CHECK ((ready_at AT TIME ZONE 'Asia/Bangkok')::time <= time '16:00');

CREATE OR REPLACE FUNCTION guard_schedule_commit() RETURNS trigger LANGUAGE plpgsql
SET search_path = patient_transfer, public AS $$
DECLARE b bookings%ROWTYPE;
BEGIN
  IF NEW.committed AND NEW.released_at IS NULL THEN
    PERFORM 1 FROM vehicles WHERE id=NEW.vehicle_id FOR UPDATE;
    PERFORM 1 FROM drivers WHERE id=NEW.driver_id FOR UPDATE;
    SELECT * INTO b FROM bookings WHERE id=NEW.booking_id;
    IF b.appointment_at<>NEW.appointment_at OR b.hospital_id<>NEW.hospital_id THEN
      RAISE EXCEPTION 'Schedule snapshot does not match booking' USING ERRCODE='23514';
    END IF;
    IF EXISTS(SELECT 1 FROM service_closures WHERE active AND closed_on=(NEW.departure_at AT TIME ZONE 'Asia/Bangkok')::date) THEN
      RAISE EXCEPTION 'Service closed on trip date' USING ERRCODE='23514';
    END IF;
    IF EXISTS(SELECT 1 FROM resource_holds h WHERE (h.vehicle_id=NEW.vehicle_id OR h.driver_id=NEW.driver_id)
      AND tstzrange(h.starts_at,h.ends_at,'[)') && tstzrange(NEW.departure_at,NEW.ready_at,'[)')) THEN
      RAISE EXCEPTION 'Resource readiness hold blocks assignment' USING ERRCODE='23514';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM vehicles WHERE id=NEW.vehicle_id AND active AND b.mobility=ANY(capabilities))
      OR NOT EXISTS(SELECT 1 FROM drivers d JOIN users u ON u.id=d.user_id WHERE d.id=NEW.driver_id AND d.active AND u.active AND u.role='driver') THEN
      RAISE EXCEPTION 'Resources inactive or missing required capability' USING ERRCODE='23514';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM availability_windows WHERE driver_id=NEW.driver_id AND retired_at IS NULL AND starts_at<=NEW.departure_at AND ends_at>=NEW.ready_at) THEN
      RAISE EXCEPTION 'Trip outside resource availability' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION flag_closure_assignments() RETURNS trigger LANGUAGE plpgsql
SET search_path = patient_transfer, public AS $$
BEGIN
  UPDATE bookings b SET schedule_review_required=true,revision=revision+1
  WHERE b.started_at IS NULL AND b.status NOT IN ('COMPLETED','CANCELLED','REJECTED','ABORTED')
    AND (b.appointment_at AT TIME ZONE 'Asia/Bangkok')::date=NEW.closed_on;
  RETURN NEW;
END;
$$;
