SET LOCAL search_path=patient_transfer,public;
ALTER TABLE notifications ADD COLUMN message_data jsonb,ADD COLUMN message_text text,ADD COLUMN delivery_subject text;
ALTER TABLE notifications ADD CONSTRAINT notification_message_fields CHECK(message_data IS NULL OR
 (jsonb_typeof(message_data)='object' AND message_data-ARRAY['version','event','audience','reference','status','pickupAt','arrivalAt','readyAt','meaning','linkPath','recordedAt']='{}'::jsonb
 AND message_data->>'audience' IN ('citizen','driver')));
CREATE UNIQUE INDEX notification_event_recipient ON notifications(event_id,recipient_id) WHERE event_id IS NOT NULL AND message_data IS NOT NULL;
CREATE FUNCTION freeze_notification_message() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.message_data IS DISTINCT FROM OLD.message_data OR
 (OLD.message_text IS NOT NULL AND NEW.message_text IS DISTINCT FROM OLD.message_text) OR
 (OLD.delivery_subject IS NOT NULL AND NEW.delivery_subject IS DISTINCT FROM OLD.delivery_subject) THEN
 RAISE EXCEPTION 'Notification snapshot and prepared delivery are immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER notification_content_immutable BEFORE UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION freeze_notification_message();
CREATE TABLE dispatcher_alerts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),booking_id uuid NOT NULL REFERENCES bookings(id),event_id uuid REFERENCES trip_events(id),
 deduplication_key text NOT NULL UNIQUE,message_data jsonb NOT NULL,
 created_at timestamptz NOT NULL,
 CHECK(jsonb_typeof(message_data)='object' AND message_data-ARRAY['version','event','audience','reference','status','pickupAt','arrivalAt','readyAt','meaning','linkPath','recordedAt']='{}'::jsonb)
);
CREATE TABLE dispatcher_alert_receipts (
 alert_id uuid NOT NULL REFERENCES dispatcher_alerts(id),user_id uuid NOT NULL REFERENCES users(id),recorded_at timestamptz NOT NULL,
 PRIMARY KEY(alert_id,user_id)
);
CREATE TRIGGER dispatcher_alert_history BEFORE UPDATE OR DELETE ON dispatcher_alerts FOR EACH ROW EXECUTE FUNCTION protect_history();
CREATE TRIGGER dispatcher_receipt_history BEFORE UPDATE OR DELETE ON dispatcher_alert_receipts FOR EACH ROW EXECUTE FUNCTION protect_history();
CREATE INDEX dispatcher_alert_order ON dispatcher_alerts(created_at DESC,id DESC);
