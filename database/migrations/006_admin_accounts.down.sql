SET LOCAL search_path = patient_transfer, public;
ALTER TABLE audit_logs DROP COLUMN before_data, DROP COLUMN after_data;
DROP TRIGGER user_revision ON users;
DROP FUNCTION advance_user_revision();
ALTER TABLE users DROP COLUMN revision;
