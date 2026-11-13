SET LOCAL search_path=patient_transfer,public;
DROP TABLE capacity_rejections;
DROP TABLE capacity_checks;
ALTER TABLE trip_events DROP CONSTRAINT trip_events_command_keys;
ALTER TABLE trip_events ADD CONSTRAINT trip_events_command_keys CHECK
 (command_data - ARRAY['type','vehicleId','driverId','reason','endedAt','location','disposition','target','physicalStateConfirmed','arrangement','hospitalId'] = '{}'::jsonb);
