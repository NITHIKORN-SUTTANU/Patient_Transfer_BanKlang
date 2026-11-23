SET LOCAL search_path = patient_transfer, public;

-- Vehicles follow service hours, and driver eligibility is independent of mobility.
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

CREATE OR REPLACE FUNCTION protect_assignment_windows() RETURNS trigger LANGUAGE plpgsql
SET search_path = patient_transfer, public AS $$
DECLARE driver uuid;
BEGIN
  IF TG_OP='DELETE' THEN driver:=OLD.driver_id;
  ELSE driver:=NEW.driver_id; END IF;
  IF EXISTS(SELECT 1 FROM schedules s JOIN bookings b ON b.id=s.booking_id
    WHERE s.committed AND s.released_at IS NULL AND b.status NOT IN ('COMPLETED','CANCELLED','REJECTED','ABORTED')
    AND s.driver_id=driver
    AND NOT EXISTS(SELECT 1 FROM availability_windows w WHERE w.retired_at IS NULL
      AND w.driver_id=driver
      AND w.starts_at<=s.departure_at AND w.ends_at>=s.ready_at)) THEN
    RAISE EXCEPTION 'Availability change would uncover an unfinished assignment' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_active_schedule_windows() RETURNS trigger LANGUAGE plpgsql
SET search_path = patient_transfer, public AS $$
BEGIN
  IF NEW.committed AND NEW.released_at IS NULL AND (
    NOT EXISTS(SELECT 1 FROM availability_windows WHERE driver_id=NEW.driver_id AND retired_at IS NULL AND starts_at<=NEW.departure_at AND ends_at>=NEW.ready_at)) THEN
    RAISE EXCEPTION 'Trip outside active resource availability' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
