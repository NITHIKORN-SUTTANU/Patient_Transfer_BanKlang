SET LOCAL search_path = patient_transfer, public;
CREATE SEQUENCE consent_decision_order_seq;
ALTER TABLE consent_records ADD COLUMN decision_order bigint;
-- Only new ordering metadata is backfilled; recorded decisions/timestamps stay intact.
-- For indistinguishable historical timestamps, refusal wins conservatively.
ALTER TABLE consent_records DISABLE TRIGGER consent_records_append_only;
WITH ordered AS (
  SELECT id,row_number() OVER (ORDER BY recorded_at,accepted DESC,id) AS position FROM consent_records
) UPDATE consent_records c SET decision_order=o.position FROM ordered o WHERE o.id=c.id;
ALTER TABLE consent_records ENABLE TRIGGER consent_records_append_only;
SELECT setval('consent_decision_order_seq',greatest(coalesce(max(decision_order),0),1),count(*)>0) FROM consent_records;
ALTER TABLE consent_records ALTER COLUMN decision_order SET DEFAULT nextval('consent_decision_order_seq'),
  ALTER COLUMN decision_order SET NOT NULL;
ALTER SEQUENCE consent_decision_order_seq OWNED BY consent_records.decision_order;
CREATE UNIQUE INDEX consent_decision_order_unique ON consent_records(decision_order);
CREATE INDEX consent_current_decision ON consent_records(user_id,notice_version,decision_order DESC);
