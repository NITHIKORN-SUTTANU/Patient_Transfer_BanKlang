-- Fictional development fixtures only. No passwords, real LINE subjects or patients.
SET LOCAL search_path = patient_transfer, public;
INSERT INTO users(id, role, display_name, username) VALUES
  ('00000000-0000-4000-8000-000000000001', 'citizen', 'Synthetic requester', 'synthetic-citizen'),
  ('00000000-0000-4000-8000-000000000002', 'dispatcher', 'Synthetic dispatcher', 'synthetic-dispatcher'),
  ('00000000-0000-4000-8000-000000000003', 'driver', 'Synthetic driver', 'synthetic-driver'),
  ('00000000-0000-4000-8000-000000000004', 'admin', 'Synthetic administrator', 'synthetic-admin')
ON CONFLICT (id) DO NOTHING;
INSERT INTO consent_records(id, user_id, notice_version, accepted, recorded_at) VALUES
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'synthetic-notice-v1', true, '2029-01-01T00:00:00Z')
ON CONFLICT (id) DO NOTHING;
INSERT INTO locations(id, name, kind, point) VALUES
  ('20000000-0000-4000-8000-000000000001', 'Synthetic depot', 'depot', ST_SetSRID(ST_MakePoint(99.04, 18.58), 4326)::geography),
  ('20000000-0000-4000-8000-000000000002', 'Synthetic hospital', 'hospital', ST_SetSRID(ST_MakePoint(99.06, 18.60), 4326)::geography),
  ('20000000-0000-4000-8000-000000000003', 'Synthetic pickup', 'pickup', ST_SetSRID(ST_MakePoint(99.05, 18.59), 4326)::geography)
ON CONFLICT (id) DO NOTHING;
INSERT INTO service_villages(id, village_number, name, center, radius_metres)
SELECT ('30000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, n,
  'Synthetic village ' || n, ST_SetSRID(ST_MakePoint(99.05, 18.59), 4326)::geography, 500
FROM generate_series(1, 12) n ON CONFLICT (id) DO NOTHING;
INSERT INTO hospitals(id, location_id, name) VALUES
  ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'Synthetic hospital')
ON CONFLICT (id) DO NOTHING;
INSERT INTO service_settings(depot_location_id) VALUES ('20000000-0000-4000-8000-000000000001') ON CONFLICT DO NOTHING;
INSERT INTO vehicles(id, plate, name, location_id, available_at, capabilities) VALUES
  ('50000000-0000-4000-8000-000000000001', 'SYNTHETIC-01', 'Synthetic vehicle 1', '20000000-0000-4000-8000-000000000001', '2029-01-01T00:00:00Z', ARRAY['standard', 'wheelchair']::mobility_type[]),
  ('50000000-0000-4000-8000-000000000002', 'SYNTHETIC-02', 'Synthetic vehicle 2', '20000000-0000-4000-8000-000000000001', '2029-01-01T00:00:00Z', ARRAY['standard', 'wheelchair']::mobility_type[])
ON CONFLICT (id) DO NOTHING;
INSERT INTO drivers(id, user_id, location_id, available_at, capabilities) VALUES
  ('60000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', '2029-01-01T00:00:00Z', ARRAY['standard', 'wheelchair']::mobility_type[])
ON CONFLICT (id) DO NOTHING;
