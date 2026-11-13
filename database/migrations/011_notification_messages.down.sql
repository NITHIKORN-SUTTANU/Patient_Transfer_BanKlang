SET LOCAL search_path=patient_transfer,public;
DROP TABLE dispatcher_alert_receipts;
DROP TABLE dispatcher_alerts;
DROP TRIGGER notification_content_immutable ON notifications;
DROP FUNCTION freeze_notification_message();
DROP INDEX notification_event_recipient;
ALTER TABLE notifications DROP CONSTRAINT notification_message_fields;
ALTER TABLE notifications DROP COLUMN message_data,DROP COLUMN message_text,DROP COLUMN delivery_subject;
