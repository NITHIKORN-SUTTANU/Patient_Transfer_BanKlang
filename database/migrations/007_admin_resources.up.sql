SET LOCAL search_path = patient_transfer, public;
ALTER TABLE vehicles ADD COLUMN revision bigint NOT NULL DEFAULT 1 CHECK (revision>0), ADD COLUMN vehicle_type text NOT NULL DEFAULT '';
ALTER TABLE drivers ADD COLUMN revision bigint NOT NULL DEFAULT 1 CHECK (revision>0), ADD COLUMN phone text NOT NULL DEFAULT '' CHECK (phone='' OR phone ~ '^0[0-9]{8,9}$');
ALTER TABLE availability_windows ADD COLUMN revision bigint NOT NULL DEFAULT 1 CHECK (revision>0), ADD COLUMN retired_at timestamptz;
CREATE FUNCTION advance_resource_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.revision:=OLD.revision+1; RETURN NEW; END;
$$;
CREATE TRIGGER vehicle_revision BEFORE UPDATE ON vehicles FOR EACH ROW EXECUTE FUNCTION advance_resource_revision();
CREATE TRIGGER driver_revision BEFORE UPDATE ON drivers FOR EACH ROW EXECUTE FUNCTION advance_resource_revision();
CREATE TRIGGER window_revision BEFORE UPDATE ON availability_windows FOR EACH ROW EXECUTE FUNCTION advance_resource_revision();

CREATE FUNCTION guard_resource_metadata() RETURNS trigger LANGUAGE plpgsql
SET search_path = patient_transfer, public AS $$
DECLARE critical boolean;
BEGIN
  critical := NOT (NEW.capabilities @> OLD.capabilities AND OLD.capabilities @> NEW.capabilities) OR (OLD.active AND NOT NEW.active)
    OR NEW.location_id IS DISTINCT FROM OLD.location_id OR NEW.available_at IS DISTINCT FROM OLD.available_at;
  IF TG_TABLE_NAME='drivers' THEN critical := critical OR NEW.user_id IS DISTINCT FROM OLD.user_id;
  ELSE critical := critical OR NEW.plate IS DISTINCT FROM OLD.plate; END IF;
  IF critical AND EXISTS(SELECT 1 FROM schedules s JOIN bookings b ON b.id=s.booking_id
    WHERE s.committed AND s.released_at IS NULL AND b.status NOT IN ('COMPLETED','CANCELLED','REJECTED','ABORTED')
    AND ((TG_TABLE_NAME='vehicles' AND s.vehicle_id=NEW.id) OR (TG_TABLE_NAME='drivers' AND s.driver_id=NEW.id))) THEN
    RAISE EXCEPTION 'Resource has unfinished operational work' USING ERRCODE='23514';
  END IF;
  IF (NEW.location_id IS DISTINCT FROM OLD.location_id OR NEW.available_at IS DISTINCT FROM OLD.available_at
      OR (TG_TABLE_NAME='drivers' AND to_jsonb(NEW)->>'user_id' IS DISTINCT FROM to_jsonb(OLD)->>'user_id'))
    AND EXISTS(SELECT 1 FROM resource_holds h WHERE h.ends_at IS NULL
      AND ((TG_TABLE_NAME='vehicles' AND h.vehicle_id=NEW.id) OR (TG_TABLE_NAME='drivers' AND h.driver_id=NEW.id))) THEN
    RAISE EXCEPTION 'Resource hold must be resolved before identity or base-position change' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER vehicle_metadata_guard BEFORE UPDATE ON vehicles FOR EACH ROW EXECUTE FUNCTION guard_resource_metadata();
CREATE TRIGGER driver_metadata_guard BEFORE UPDATE ON drivers FOR EACH ROW EXECUTE FUNCTION guard_resource_metadata();

CREATE FUNCTION revoke_roster_sessions() RETURNS trigger LANGUAGE plpgsql
SET search_path = patient_transfer, public AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    UPDATE auth_sessions SET revoked_at=coalesce(revoked_at,now()) WHERE user_id=NEW.user_id;
    UPDATE users SET access_version=access_version+1 WHERE id=NEW.user_id;
  ELSIF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.active IS DISTINCT FROM OLD.active THEN
    UPDATE auth_sessions SET revoked_at=coalesce(revoked_at,now()) WHERE user_id IN (OLD.user_id,NEW.user_id);
    UPDATE users SET access_version=access_version+1 WHERE id IN (OLD.user_id,NEW.user_id);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER driver_roster_sessions AFTER INSERT OR UPDATE ON drivers FOR EACH ROW EXECUTE FUNCTION revoke_roster_sessions();

CREATE FUNCTION lock_window_resource() RETURNS trigger LANGUAGE plpgsql
SET search_path = patient_transfer, public AS $$
DECLARE vehicle uuid; driver uuid;
BEGIN
  IF TG_OP='DELETE' THEN vehicle:=OLD.vehicle_id; driver:=OLD.driver_id;
  ELSE
    vehicle:=NEW.vehicle_id; driver:=NEW.driver_id;
    IF TG_OP='UPDATE' AND (NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id OR NEW.driver_id IS DISTINCT FROM OLD.driver_id) THEN
      RAISE EXCEPTION 'Window resource cannot change' USING ERRCODE='23514';
    END IF;
  END IF;
  IF vehicle IS NOT NULL THEN UPDATE vehicles SET revision=revision WHERE id=vehicle;
  ELSE UPDATE drivers SET revision=revision WHERE id=driver; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER window_resource_lock BEFORE INSERT OR UPDATE OR DELETE ON availability_windows FOR EACH ROW EXECUTE FUNCTION lock_window_resource();

CREATE FUNCTION protect_assignment_windows() RETURNS trigger LANGUAGE plpgsql
SET search_path = patient_transfer, public AS $$
DECLARE vehicle uuid; driver uuid;
BEGIN
  IF TG_OP='DELETE' THEN vehicle:=OLD.vehicle_id; driver:=OLD.driver_id;
  ELSE vehicle:=NEW.vehicle_id; driver:=NEW.driver_id; END IF;
  IF EXISTS(SELECT 1 FROM schedules s JOIN bookings b ON b.id=s.booking_id
    WHERE s.committed AND s.released_at IS NULL AND b.status NOT IN ('COMPLETED','CANCELLED','REJECTED','ABORTED')
    AND ((vehicle IS NOT NULL AND s.vehicle_id=vehicle) OR (driver IS NOT NULL AND s.driver_id=driver))
    AND NOT EXISTS(SELECT 1 FROM availability_windows w WHERE w.retired_at IS NULL
      AND ((vehicle IS NOT NULL AND w.vehicle_id=vehicle) OR (driver IS NOT NULL AND w.driver_id=driver))
      AND w.starts_at<=s.departure_at AND w.ends_at>=s.ready_at)) THEN
    RAISE EXCEPTION 'Availability change would uncover an unfinished assignment' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER window_assignment_guard AFTER UPDATE OR DELETE ON availability_windows FOR EACH ROW EXECUTE FUNCTION protect_assignment_windows();

CREATE FUNCTION guard_active_schedule_windows() RETURNS trigger LANGUAGE plpgsql
SET search_path = patient_transfer, public AS $$
BEGIN
  IF NEW.committed AND NEW.released_at IS NULL AND (
    NOT EXISTS(SELECT 1 FROM availability_windows WHERE vehicle_id=NEW.vehicle_id AND retired_at IS NULL AND starts_at<=NEW.departure_at AND ends_at>=NEW.ready_at)
    OR NOT EXISTS(SELECT 1 FROM availability_windows WHERE driver_id=NEW.driver_id AND retired_at IS NULL AND starts_at<=NEW.departure_at AND ends_at>=NEW.ready_at)) THEN
    RAISE EXCEPTION 'Trip outside active resource availability' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
-- Runs after the existing schedule_commit_guard has locked vehicle then driver.
CREATE TRIGGER schedule_window_guard BEFORE INSERT OR UPDATE ON schedules FOR EACH ROW EXECUTE FUNCTION guard_active_schedule_windows();
