SET LOCAL search_path=patient_transfer,public;
DROP TRIGGER assignment_labels ON schedules;
DROP FUNCTION capture_assignment_labels();
ALTER TABLE schedules DROP COLUMN driver_user_snapshot,DROP COLUMN driver_name_snapshot,DROP COLUMN vehicle_name_snapshot,
 DROP COLUMN vehicle_plate_snapshot,DROP COLUMN origin_name_snapshot,DROP COLUMN hospital_name_snapshot;
