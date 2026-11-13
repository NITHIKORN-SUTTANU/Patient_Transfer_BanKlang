SET LOCAL search_path = patient_transfer, public;
ALTER TABLE consent_records DROP COLUMN decision_order;
