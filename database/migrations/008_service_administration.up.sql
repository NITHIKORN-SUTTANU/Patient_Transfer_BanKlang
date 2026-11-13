SET LOCAL search_path = patient_transfer, public;
ALTER TABLE hospitals ADD COLUMN revision bigint NOT NULL DEFAULT 1;
ALTER TABLE service_villages ADD COLUMN revision bigint NOT NULL DEFAULT 1;
ALTER TABLE service_closures ADD COLUMN revision bigint NOT NULL DEFAULT 1, ADD COLUMN active boolean NOT NULL DEFAULT true;
ALTER TABLE service_settings ADD COLUMN depot_name text;
UPDATE service_settings s SET depot_name=l.name FROM locations l WHERE l.id=s.depot_location_id;
ALTER TABLE service_settings ALTER COLUMN depot_name SET NOT NULL;
CREATE FUNCTION initialize_depot_name() RETURNS trigger LANGUAGE plpgsql
SET search_path = patient_transfer, public AS $$
BEGIN
  IF NEW.depot_name IS NULL OR NEW.depot_name='' THEN SELECT name INTO NEW.depot_name FROM locations WHERE id=NEW.depot_location_id; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER initialize_depot_name BEFORE INSERT ON service_settings FOR EACH ROW EXECUTE FUNCTION initialize_depot_name();
CREATE FUNCTION advance_master_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.revision:=OLD.revision+1; RETURN NEW; END;
$$;
CREATE TRIGGER hospital_revision BEFORE UPDATE ON hospitals FOR EACH ROW EXECUTE FUNCTION advance_master_revision();
CREATE TRIGGER village_revision BEFORE UPDATE ON service_villages FOR EACH ROW EXECUTE FUNCTION advance_master_revision();
CREATE TRIGGER closure_revision BEFORE UPDATE ON service_closures FOR EACH ROW EXECUTE FUNCTION advance_master_revision();
CREATE TRIGGER settings_revision BEFORE UPDATE ON service_settings FOR EACH ROW EXECUTE FUNCTION advance_master_revision();

ALTER TABLE bookings ADD COLUMN hospital_location_snapshot uuid REFERENCES locations(id), ADD COLUMN hospital_name_snapshot text,
  ADD COLUMN depot_location_snapshot uuid REFERENCES locations(id);
UPDATE bookings b SET hospital_location_snapshot=h.location_id,hospital_name_snapshot=h.name,
  depot_location_snapshot=(SELECT depot_location_id FROM service_settings) FROM hospitals h WHERE h.id=b.hospital_id;
ALTER TABLE bookings ALTER COLUMN hospital_location_snapshot SET NOT NULL, ALTER COLUMN hospital_name_snapshot SET NOT NULL, ALTER COLUMN depot_location_snapshot SET NOT NULL;
ALTER TABLE schedules ADD COLUMN hospital_location_snapshot uuid REFERENCES locations(id);
UPDATE schedules s SET hospital_location_snapshot=h.location_id FROM hospitals h WHERE h.id=s.hospital_id;
ALTER TABLE schedules ALTER COLUMN hospital_location_snapshot SET NOT NULL;

CREATE FUNCTION capture_booking_locations() RETURNS trigger LANGUAGE plpgsql
SET search_path = patient_transfer, public AS $$
BEGIN
  IF TG_OP='INSERT' OR NEW.hospital_id IS DISTINCT FROM OLD.hospital_id THEN
    SELECT location_id,name INTO NEW.hospital_location_snapshot,NEW.hospital_name_snapshot FROM hospitals WHERE id=NEW.hospital_id;
  END IF;
  IF TG_OP='INSERT' THEN SELECT depot_location_id INTO NEW.depot_location_snapshot FROM service_settings; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER booking_location_snapshots BEFORE INSERT OR UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION capture_booking_locations();
CREATE FUNCTION capture_schedule_location() RETURNS trigger LANGUAGE plpgsql
SET search_path = patient_transfer, public AS $$
BEGIN
  IF TG_OP='INSERT' THEN SELECT hospital_location_snapshot INTO NEW.hospital_location_snapshot FROM bookings WHERE id=NEW.booking_id; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER schedule_location_snapshot BEFORE INSERT ON schedules FOR EACH ROW EXECUTE FUNCTION capture_schedule_location();
CREATE FUNCTION protect_location_geometry() RETURNS trigger LANGUAGE plpgsql
SET search_path = patient_transfer, public AS $$
BEGIN
  IF NOT ST_Equals(NEW.point::geometry,OLD.point::geometry) AND (
    EXISTS(SELECT 1 FROM bookings WHERE hospital_location_snapshot=OLD.id OR depot_location_snapshot=OLD.id)
    OR EXISTS(SELECT 1 FROM schedules WHERE origin_location_id=OLD.id OR hospital_location_snapshot=OLD.id)
    OR EXISTS(SELECT 1 FROM vehicles WHERE location_id=OLD.id) OR EXISTS(SELECT 1 FROM drivers WHERE location_id=OLD.id)
    OR EXISTS(SELECT 1 FROM resource_position_updates WHERE location_id=OLD.id)) THEN
    RAISE EXCEPTION 'Referenced location geometry is immutable; create a new location version' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER location_geometry_version BEFORE UPDATE OF point ON locations FOR EACH ROW EXECUTE FUNCTION protect_location_geometry();

CREATE TABLE configuration_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), booking_id uuid NOT NULL REFERENCES bookings(id),
  entity_type text NOT NULL CHECK (entity_type IN ('hospital','village','depot','closure')),
  entity_id text NOT NULL, proposed_data jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL,
  accepted_by uuid REFERENCES users(id),accepted_at timestamptz,
  CHECK ((accepted_by IS NULL)=(accepted_at IS NULL))
);
CREATE INDEX pending_configuration_reviews ON configuration_reviews(booking_id) WHERE accepted_at IS NULL;

CREATE OR REPLACE FUNCTION flag_closure_assignments() RETURNS trigger LANGUAGE plpgsql
SET search_path = patient_transfer, public AS $$
BEGIN
  UPDATE bookings b SET schedule_review_required=true,revision=revision+1
  WHERE b.started_at IS NULL AND b.status NOT IN ('COMPLETED','CANCELLED','REJECTED','ABORTED')
    AND (b.appointment_at AT TIME ZONE 'Asia/Bangkok')::date=NEW.closed_on;
  RETURN NEW;
END;
$$;

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
      OR NOT EXISTS(SELECT 1 FROM drivers d JOIN users u ON u.id=d.user_id WHERE d.id=NEW.driver_id AND d.active AND u.active AND u.role='driver' AND b.mobility=ANY(d.capabilities)) THEN
      RAISE EXCEPTION 'Resources inactive or missing required capability' USING ERRCODE='23514';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM availability_windows WHERE vehicle_id=NEW.vehicle_id AND retired_at IS NULL AND starts_at<=NEW.departure_at AND ends_at>=NEW.ready_at)
      OR NOT EXISTS(SELECT 1 FROM availability_windows WHERE driver_id=NEW.driver_id AND retired_at IS NULL AND starts_at<=NEW.departure_at AND ends_at>=NEW.ready_at) THEN
      RAISE EXCEPTION 'Trip outside resource availability' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
