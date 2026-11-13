# System Architecture & Database Schema Specification

> Historical draft. Current implementation contract: `database/migrations/`, `docs/guides/DATABASE.md`, and the current SRS. PostgreSQL/PostGIS with timezone-aware timestamps is selected. The vehicle-only count query below is illustrative history, not a concurrency guarantee; actual migrations use separate vehicle and driver exclusion constraints. Do not copy the draft schema over applied migrations.

**Project:** Municipal Patient Transit Booking Platform (Takuk Takak)  
**Associated Issue:** #5 ([week-2] Design System Architecture Flow and Draft Data Schema (R1/R2))  
**Primary Architect:** ACT-04 / Lead Developer (Nithanthip Kulmong)  
**Target Milestone:** Checkpoint 2 & 3 (Pre-implementation Design Phase)

---

## 1. High-Level System Architecture Flow

The platform utilizes a decoupled, lightweight service architecture designed to operate reliably within municipal infrastructure constraints without dedicated hardware or high-bandwidth streaming requirements:

```text
+-------------------------+     +--------------------------+     +------------------------+
|  Citizen / Caregiver    |     |   Dispatcher Dashboard   |     |    Driver Interface    |
|     (LINE LIFF App)     |     |       (Web Portal)       |     |    (Mobile Web App)    |
+------------+------------+     +------------+-------------+     +-----------+------------+
             |                               |                               |
             +-------------------------------+-------------------------------+
                                             |
                                             | HTTPS / JSON REST API
                                             v
                             +-------------------------------+
                             |      Backend API Gateway      |
                             |   (Node.js / Express / Hono)  |
                             +---------------+---------------+
                                             |
                     +-----------------------+-----------------------+
                     |                                               |
                     v                                               v
        +-------------------------+                     +-------------------------+
        |   Route Engine (OSRM)   |                     |   Relational Database   |
        | (Deterministic Transit) |                     |  (PostgreSQL / SQLite)  |
        +-------------------------+                     +-------------------------+
```

### Component Breakdown
1. **LINE LIFF Front-End (Citizen):** Provides frictionless booking access via LINE messaging without requiring app store installation. Enforces PDPA consent capture before form entry.
2. **Web Dispatch Portal (Dispatcher):** Single-pane-of-glass calendar and interactive dispatch board for trip approval, vehicle assignment, and conflict resolution.
3. **Driver Mobile Web UI (Driver):** Minimalist milestone execution screen featuring large action buttons to trigger the 8-stage state machine transitions.
4. **OSRM Routing Engine:** Open-source OpenStreetMap-based routing engine providing deterministic driving duration estimates for Legs 1 and 2.
5. **Relational Database:** Stores persistent records of trips, audit logs, vehicle allocations, and user authorizations.

---

## 2. Entity-Relationship (ER) Schema Design

### 2.1 Table: `bookings` (Core Booking & Scheduling Manifest)
Stores intake parameters, routing computations, scheduling intervals, and lifecycle states.

| Column Name | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `booking_id` | VARCHAR(36) | PRIMARY KEY | Unique identifier for the trip (UUID) |
| `citizen_line_id` | VARCHAR(64) | NOT NULL, INDEX | Citizen/Caregiver LINE UID |
| `patient_name` | VARCHAR(120) | NOT NULL | Patient full name (PDPA Protected) |
| `patient_phone` | VARCHAR(20) | NOT NULL | Contact phone number |
| `pickup_address` | TEXT | NOT NULL | Text description of pickup point |
| `pickup_lat` | DECIMAL(10, 7) | NOT NULL | Latitude coordinates |
| `pickup_lng` | DECIMAL(10, 7) | NOT NULL | Longitude coordinates |
| `destination_hospital` | VARCHAR(120) | NOT NULL | Destination medical facility |
| `appointment_time` | TIMESTAMP | NOT NULL | Clinical appointment time at hospital |
| `mobility_type` | VARCHAR(20) | NOT NULL | Mobility status: `AMBULATORY`, `WHEELCHAIR`, `BEDRIDDEN` |
| `current_state` | VARCHAR(20) | NOT NULL | 8-Stage Enum: `REQUESTED` to `COMPLETED` |
| `t_depot_departure` | TIMESTAMP | NULLABLE | Calculated depot departure time |
| `t_pickup` | TIMESTAMP | NULLABLE | Calculated scheduled pickup time |
| `t_hospital_target` | TIMESTAMP | NULLABLE | Target arrival time (`appointment_time - 20m`) |
| `t_available` | TIMESTAMP | NULLABLE | Next available slot (`t_hospital_target + 30m`) |
| `assigned_vehicle_id` | VARCHAR(36) | FOREIGN KEY | Assigned vehicle reference |
| `assigned_driver_id` | VARCHAR(36) | FOREIGN KEY | Assigned driver reference |
| `pdpa_consent_granted` | BOOLEAN | NOT NULL, DEFAULT FALSE | Proof of affirmative consent |
| `created_at` | TIMESTAMP | NOT NULL, DEFAULT NOW() | Intake submission timestamp |

---

### 2.2 Table: `vehicles` (Municipal Fleet Manifest)

| Column Name | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `vehicle_id` | VARCHAR(36) | PRIMARY KEY | Vehicle plate or fleet number |
| `plate_number` | VARCHAR(20) | NOT NULL, UNIQUE | Vehicle registration plate |
| `model_info` | VARCHAR(80) | NOT NULL | Van / EMS vehicle model description |
| `supports_wheelchair` | BOOLEAN | NOT NULL, DEFAULT FALSE | Equipped with wheelchair lift/ramp |
| `supports_bedridden` | BOOLEAN | NOT NULL, DEFAULT FALSE | Equipped with stretcher |
| `operational_status` | VARCHAR(20) | NOT NULL, DEFAULT 'ACTIVE' | `ACTIVE`, `MAINTENANCE`, `RETIRED` |

---

### 2.3 Table: `drivers` (Municipal Staff Manifest)

| Column Name | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `driver_id` | VARCHAR(36) | PRIMARY KEY | Staff identifier |
| `full_name` | VARCHAR(120) | NOT NULL | Driver full name |
| `phone_number` | VARCHAR(20) | NOT NULL | Mobile contact phone |
| `duty_status` | VARCHAR(20) | NOT NULL, DEFAULT 'ON_DUTY' | `ON_DUTY`, `OFF_DUTY`, `ON_LEAVE` |

---

### 2.4 Table: `trip_milestone_logs` (State Machine Audit Trail)
Enforces auditability and precise timeline reconstruction without continuous GPS tracking.

| Column Name | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `log_id` | BIGSERIAL | PRIMARY KEY | Incremental audit log ID |
| `booking_id` | VARCHAR(36) | FOREIGN KEY, INDEX | Associated trip identifier |
| `stage` | VARCHAR(20) | NOT NULL | Stage Enum (1 through 8) |
| `triggered_by` | VARCHAR(64) | NOT NULL | User/Staff ID triggering change |
| `timestamp` | TIMESTAMP | NOT NULL, DEFAULT NOW() | Exact trigger timestamp |
| `notes` | TEXT | NULLABLE | Dispatcher or driver notes |

---

## 3. Database Constraints Enforcing Business Rules

### 3.1 Advance Notice Validation (Rule R1)
Calculated at the API Gateway prior to record creation:
```text
CONSTRAINT chk_lead_time_48h 
CHECK (appointment_time >= created_at + INTERVAL '48 HOURS');
```

### 3.2 Single-Occupancy Zero-Conflict Constraint (Rule R2)
Prevents double-booking of any municipal vehicle across overlapping operational intervals `[t_depot_departure, t_available)`:
```sql
-- Conflict Detection Query prior to Dispatcher Approval:
SELECT COUNT(*) 
FROM bookings 
WHERE assigned_vehicle_id = :target_vehicle_id
  AND current_state NOT IN ('COMPLETED', 'CANCELLED')
  AND (
    (t_depot_departure < :new_t_available) AND 
    (t_available > :new_t_depot_departure)
  );
```
If `COUNT(*) > 0`, the dispatch engine flags an operational conflict and blocks automatic approval.
