SET LOCAL search_path=patient_transfer,public;
-- Existing outcomes/notes/timestamps remain unchanged, including unknown legacy values.
ALTER TABLE verification_logs ADD COLUMN revision bigint GENERATED ALWAYS AS IDENTITY,
 ADD COLUMN corrects_id uuid,
 ADD CONSTRAINT verification_outcome CHECK(outcome IN ('confirmed','correction_needed','unreachable','requester_declined')) NOT VALID,
 ADD CONSTRAINT verification_note_length CHECK(char_length(notes)<=1000) NOT VALID,
 ADD CONSTRAINT verification_identity UNIQUE(id,booking_id),
 ADD CONSTRAINT verification_same_booking FOREIGN KEY(corrects_id,booking_id) REFERENCES verification_logs(id,booking_id),
 ADD CONSTRAINT verification_not_self CHECK(corrects_id IS DISTINCT FROM id);
CREATE INDEX verification_booking_history ON verification_logs(booking_id,revision DESC);
CREATE TRIGGER verification_append_only BEFORE UPDATE OR DELETE ON verification_logs FOR EACH ROW EXECUTE FUNCTION protect_history();
