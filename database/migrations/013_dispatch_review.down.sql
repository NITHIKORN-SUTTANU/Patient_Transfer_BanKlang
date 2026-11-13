SET LOCAL search_path=patient_transfer,public;
DROP TRIGGER verification_append_only ON verification_logs;
DROP INDEX verification_booking_history;
ALTER TABLE verification_logs DROP CONSTRAINT verification_same_booking,DROP CONSTRAINT verification_identity,
 DROP CONSTRAINT verification_outcome,DROP CONSTRAINT verification_note_length,DROP CONSTRAINT verification_not_self,
 DROP COLUMN corrects_id,DROP COLUMN revision;
