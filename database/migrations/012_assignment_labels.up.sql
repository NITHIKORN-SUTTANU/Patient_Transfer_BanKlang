SET LOCAL search_path=patient_transfer,public;
-- Do not invent historical labels or crew-account identity for old assignments.
ALTER TABLE schedules ADD COLUMN driver_user_snapshot uuid REFERENCES users(id),
 ADD COLUMN driver_name_snapshot text,ADD COLUMN vehicle_name_snapshot text,ADD COLUMN vehicle_plate_snapshot text,
 ADD COLUMN origin_name_snapshot text,ADD COLUMN hospital_name_snapshot text;
CREATE FUNCTION capture_assignment_labels() RETURNS trigger LANGUAGE plpgsql
SET search_path=patient_transfer,public AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  SELECT u.id,u.display_name INTO NEW.driver_user_snapshot,NEW.driver_name_snapshot FROM drivers d JOIN users u ON u.id=d.user_id WHERE d.id=NEW.driver_id;
  SELECT name,plate INTO NEW.vehicle_name_snapshot,NEW.vehicle_plate_snapshot FROM vehicles WHERE id=NEW.vehicle_id;
  SELECT name INTO NEW.origin_name_snapshot FROM locations WHERE id=NEW.origin_location_id;
  SELECT hospital_name_snapshot INTO NEW.hospital_name_snapshot FROM bookings WHERE id=NEW.booking_id;
 ELSIF (NEW.driver_user_snapshot,NEW.driver_name_snapshot,NEW.vehicle_name_snapshot,NEW.vehicle_plate_snapshot,NEW.origin_name_snapshot,NEW.hospital_name_snapshot)
   IS DISTINCT FROM (OLD.driver_user_snapshot,OLD.driver_name_snapshot,OLD.vehicle_name_snapshot,OLD.vehicle_plate_snapshot,OLD.origin_name_snapshot,OLD.hospital_name_snapshot) THEN
  RAISE EXCEPTION 'Assignment labels are immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER assignment_labels BEFORE INSERT OR UPDATE ON schedules FOR EACH ROW EXECUTE FUNCTION capture_assignment_labels();
