SET LOCAL search_path = patient_transfer, public;
ALTER TABLE patient_profiles DROP COLUMN assistance, DROP COLUMN landmark;
ALTER TABLE bookings DROP COLUMN assistance, DROP COLUMN booking_for;
