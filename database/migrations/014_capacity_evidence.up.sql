SET LOCAL search_path=patient_transfer,public;
ALTER TABLE trip_events DROP CONSTRAINT trip_events_command_keys;
ALTER TABLE trip_events ADD CONSTRAINT trip_events_command_keys CHECK
 (command_data - ARRAY['type','vehicleId','driverId','reason','endedAt','location','disposition','target','physicalStateConfirmed','arrangement','hospitalId','rejectionKind','capacityCheckId'] = '{}'::jsonb);
CREATE TABLE capacity_checks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),booking_id uuid NOT NULL REFERENCES bookings(id),actor_id uuid NOT NULL REFERENCES users(id),
 recorded_at timestamptz NOT NULL,booking_revision bigint NOT NULL,fingerprint text NOT NULL,
 alternatives jsonb NOT NULL CHECK(jsonb_typeof(alternatives)='array' AND jsonb_array_length(alternatives)>0),
 explanation text NOT NULL CHECK(char_length(btrim(explanation)) BETWEEN 1 AND 1000),
 rejectable boolean NOT NULL
);
CREATE INDEX capacity_booking_history ON capacity_checks(booking_id,recorded_at DESC,id);
CREATE TRIGGER capacity_checks_append_only BEFORE UPDATE OR DELETE ON capacity_checks FOR EACH ROW EXECUTE FUNCTION protect_history();
CREATE TABLE capacity_rejections (
 event_id uuid PRIMARY KEY REFERENCES trip_events(id),source_check_id uuid NOT NULL REFERENCES capacity_checks(id),
 validated_check_id uuid NOT NULL REFERENCES capacity_checks(id)
);
CREATE TRIGGER capacity_rejections_append_only BEFORE UPDATE OR DELETE ON capacity_rejections FOR EACH ROW EXECUTE FUNCTION protect_history();
