SET LOCAL search_path = patient_transfer, public;
DROP TABLE configuration_reviews;
DROP TRIGGER location_geometry_version ON locations;
DROP FUNCTION protect_location_geometry();
DROP TRIGGER schedule_location_snapshot ON schedules;
DROP FUNCTION capture_schedule_location();
DROP TRIGGER booking_location_snapshots ON bookings;
DROP FUNCTION capture_booking_locations();
ALTER TABLE schedules DROP COLUMN hospital_location_snapshot;
ALTER TABLE bookings DROP COLUMN hospital_location_snapshot,DROP COLUMN hospital_name_snapshot,DROP COLUMN depot_location_snapshot;
DROP TRIGGER settings_revision ON service_settings;
DROP TRIGGER closure_revision ON service_closures;
DROP TRIGGER village_revision ON service_villages;
DROP TRIGGER hospital_revision ON hospitals;
DROP FUNCTION advance_master_revision();
DROP TRIGGER initialize_depot_name ON service_settings;
DROP FUNCTION initialize_depot_name();
ALTER TABLE service_settings DROP COLUMN depot_name;
ALTER TABLE service_closures DROP COLUMN active,DROP COLUMN revision;
ALTER TABLE service_villages DROP COLUMN revision;
ALTER TABLE hospitals DROP COLUMN revision;
CREATE OR REPLACE FUNCTION flag_closure_assignments() RETURNS trigger LANGUAGE plpgsql
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

CREATE OR REPLACE FUNCTION guard_schedule_commit() RETURNS trigger LANGUAGE plpgsql
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
