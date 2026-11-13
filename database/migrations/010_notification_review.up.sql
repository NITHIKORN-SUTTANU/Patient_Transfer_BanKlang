SET LOCAL search_path=patient_transfer,public;
ALTER TABLE notifications ADD COLUMN first_attempt_at timestamptz, ADD COLUMN last_attempt_at timestamptz,
 ADD COLUMN delivery_in_flight boolean NOT NULL DEFAULT false,
 ADD COLUMN revision bigint NOT NULL DEFAULT 1,
 ADD COLUMN claimed_by uuid REFERENCES users(id), ADD COLUMN claimed_at timestamptz,
 ADD COLUMN reviewed_at timestamptz, ADD COLUMN review_note text,
 ADD COLUMN technical_claimed_by uuid REFERENCES users(id), ADD COLUMN technical_claimed_at timestamptz,
 ADD COLUMN technical_reviewed_at timestamptz, ADD COLUMN technical_review_note text;
CREATE TRIGGER notification_revision BEFORE UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION advance_master_revision();
CREATE TABLE notification_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),notification_id uuid NOT NULL REFERENCES notifications(id),
 attempt integer NOT NULL CHECK(attempt BETWEEN 1 AND 5),attempted_at timestamptz NOT NULL,
 outcome text NOT NULL CHECK(outcome IN ('ACCEPTED','TRANSIENT','PERMANENT')), failure_code text,
 next_attempt_at timestamptz, UNIQUE(notification_id,attempt),
 CHECK(next_attempt_at IS NULL OR (outcome='TRANSIENT' AND attempt<5 AND next_attempt_at>attempted_at))
);
CREATE TRIGGER notification_attempts_history BEFORE UPDATE OR DELETE ON notification_attempts FOR EACH ROW EXECUTE FUNCTION protect_history();
CREATE INDEX notifications_review_queue ON notifications(created_at DESC,id DESC) WHERE status='FAILED';
