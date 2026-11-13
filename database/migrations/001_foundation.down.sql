-- The runner refuses rollback while any application table contains rows.
-- Extensions remain installed because other schemas may depend on them.
DROP SCHEMA patient_transfer CASCADE;
