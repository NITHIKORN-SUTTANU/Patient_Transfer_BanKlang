SET LOCAL search_path=patient_transfer,public;
DROP INDEX notifications_review_queue;
DROP TABLE notification_attempts;
DROP TRIGGER notification_revision ON notifications;
ALTER TABLE notifications DROP COLUMN first_attempt_at,DROP COLUMN last_attempt_at,DROP COLUMN revision,
 DROP COLUMN delivery_in_flight,
 DROP COLUMN claimed_by,DROP COLUMN claimed_at,DROP COLUMN reviewed_at,DROP COLUMN review_note,
 DROP COLUMN technical_claimed_by,DROP COLUMN technical_claimed_at,DROP COLUMN technical_reviewed_at,DROP COLUMN technical_review_note;
