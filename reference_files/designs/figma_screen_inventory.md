# Figma Screen Inventory — Booking Management System

**Project:** Ban Klang Municipal Patient Transit Booking Platform  
**Target:** Core four-actor system completed, tested, and deployment-ready by December 2026
**Purpose:** Practical screen checklist for designing a clickable Figma prototype  
**Status:** Proposed UI inventory; screen names and layouts are design suggestions, not separately validated stakeholder requirements.

## Prototype Summary

| Actor | Interface | Core screens | Figma frame size (suggested) |
|---|---|---:|---|
| ACT-01 Citizen / Caregiver | LINE LIFF | 7 | 390 × 844 px |
| ACT-02 Municipal Dispatcher | Staff Web Portal | 7 | 1440 × 900 px |
| ACT-03 Ambulance Driver | Mobile Staff Portal | 5 | 390 × 844 px |
| ACT-04 System Administrator | Admin Console | 6 | 1440 × 900 px |
| **Total** | | **25** | |

> Counts exclude shared login, reusable components, modal dialogs, validation errors, and status variants.

## ACT-01 — Citizen / Caregiver

**Figma page:** `01 - Citizen LIFF`

| ID | Screen | Contents / actions |
|---|---|---|
| C-01 | Booking Home | Service introduction; Book Transportation; View My Bookings; emergency notice and Call 1669 |
| C-02 | PDPA Consent | Privacy notice; explicit Accept & Continue; Decline; municipal phone alternative |
| C-03 | Step 1: Patient & Appointment | Patient and contact names; contact phone; hospital destination; appointment date and time; Continue |
| C-04 | Step 2: Assistance & Location | Normal/wheelchair/stretcher; current GPS or manual draggable map marker; pickup address/coordinates; Back and Continue |
| C-05 | Step 3: Review & Submit | Review entered data; edit previous steps; Submit Booking Request |
| C-06 | Booking Submitted | Booking reference; Pending Dispatcher Review; View Booking Status |
| C-07 | Booking Status | Request decision; approved pickup time when available; booking/trip lifecycle; notifications |

**Primary navigation:** C-01 → C-02 → C-03 → C-04 → C-05 → C-06 → C-07.

**Variants / edge cases:** PDPA declined; invalid required fields; GPS permission denied; invalid or out-of-area pickup; appointment less than 48 hours ahead; routing/availability warning; pending, approved, modified, rejected booking.

**Prototype rules:** Consent before form entry; emergency 1669 access throughout; validate minimum 48-hour lead time; submission is **not** dispatcher approval; use a fixed 20-minute arrival buffer in scheduling (backend rule, not a citizen-editable field).

## ACT-02 — Municipal Dispatcher

**Figma page:** `02 - Dispatcher Portal`

| ID | Screen | Contents / actions |
|---|---|---|
| D-01 | Dispatcher Dashboard | Today's trips; pending requests; warnings; fleet summary |
| D-02 | Booking Requests | Request list; filters/search; select booking |
| D-03 | Booking Details | Patient/contact; pickup/destination; appointment; mobility needs |
| D-04 | Schedule Recommendation | Proposed depot departure and pickup times; vehicle/driver recommendation; warnings |
| D-05 | Assignment Decision | Approve, modify, reject; justification; confirmation; revalidation of modified assignment |
| D-06 | Fleet Calendar | Daily vehicle/driver schedules; occupied intervals; conflict visibility |
| D-07 | Trip Operations | Cancellation and emergency reassignment entry points |

**Primary navigation:** D-01 → D-02 → D-03 → D-04 → D-05 → D-01; D-06 and D-07 accessible from navigation.

**Variants / edge cases:** Feasible recommendation; vehicle conflict; driver conflict; no feasible assignment; approval success; modification success/failure; rejection; cancellation; emergency reassignment.

**Open decisions:** Cancellation eligibility, reassignment rules, and exact status transitions require specification before implementation. Do not assume a successful modification without checking conflicts.

## ACT-03 — Ambulance Driver

**Figma page:** `03 - Driver Portal`

| ID | Screen | Contents / actions |
|---|---|---|
| DR-01 | Driver Dashboard | Next assigned trip; summary; active status |
| DR-02 | Daily Schedule | Assigned trip list and times |
| DR-03 | Trip Details | Pickup location; hospital; mobility requirements; schedule |
| DR-04 | Pickup Map | Pickup marker; map/location details; navigation handoff as applicable |
| DR-05 | Trip Progress | Current lifecycle stage; next allowed manual milestone action; completion confirmation |

**Primary navigation:** DR-01 → DR-02 → DR-03 → DR-04 or DR-05 → DR-02.

**Variants / edge cases:** Assigned; Picking Up; Picked Up; In Transit; Completed; failed or unauthorized status update.

**Lifecycle:** `REQUESTED → APPROVED → SCHEDULED → ASSIGNED → PICKING_UP → PICKED_UP → IN_TRANSIT → COMPLETED` (from system logic). Earlier states are displayed as appropriate; not every state is advanced by the driver. Clarify who triggers `APPROVED` versus `SCHEDULED` before final implementation.

## ACT-04 — System Administrator

**Figma page:** `04 - Admin Console`

| ID | Screen | Contents / actions |
|---|---|---|
| A-01 | Admin Dashboard | Administration overview and module navigation |
| A-02 | Vehicle Management | Vehicle records; accessibility capabilities; maintenance actions |
| A-03 | Driver Management | Driver roster; accounts; record maintenance |
| A-04 | Geospatial Settings | Depot; service area; operating hours; configuration validation |
| A-05 | Audit Logs | Actor, action, timestamp, details; inspect transactions |
| A-06 | Roles & Permissions | Review account roles and RBAC permissions; authorized changes |

**Primary navigation:** A-01 → selected module → view/edit/confirm → module or dashboard.

**Variants / edge cases:** Add/edit/deactivate record (proposed CRUD breakdown); invalid configuration; successful save; permission denied; audit detail.

**Important:** The 48-hour lead time and 20-minute buffer are fixed project rules, not freely editable settings.

## Shared Screens and Components

| Shared asset | Actors |
|---|---|
| Staff login and access-denied state | Dispatcher, Driver, Admin |
| Header/sidebar/navigation | Staff roles |
| Input, button, select, date/time picker | As needed across roles |
| Status badges and trip cards | Citizen, Dispatcher, Driver |
| Confirmation dialogs, toasts, error/empty/loading states | All |
| Location map | Citizen, Dispatcher, Driver |
| Booking detail summary | Citizen, Dispatcher, Driver |
| Notification display | All relevant roles |

## Suggested Figma File Pages

```text
Booking Management System
├── 00 - Design System
├── 01 - Citizen LIFF
├── 02 - Dispatcher Portal
├── 03 - Driver Portal
├── 04 - Admin Console
└── 05 - Prototype Flows & Testing
```

## End-to-End Clickable Prototype Scenario

1. Citizen opens LINE LIFF, accepts PDPA consent, and submits a valid booking using the hybrid 3-step form.
2. System checks lead time, routing, backward scheduling, and vehicle/driver availability.
3. Dispatcher reviews the recommendation, records justification, and approves the booking.
4. Citizen receives a confirmation/status update.
5. Driver views the assigned trip and manually advances trip milestones.
6. Citizen sees updated trip status through the LINE experience.
7. Administrator can inspect fleet settings and audit information in the separate console.

## Prototype Build Checklist

- [ ] Create design system and shared components
- [ ] Design C-01 through C-07
- [ ] Design D-01 through D-07
- [ ] Design DR-01 through DR-05
- [ ] Design A-01 through A-06
- [ ] Add validation, warning, error, and confirmation variants
- [ ] Connect navigation and back/edit actions
- [ ] Demonstrate booking → dispatcher decision → driver completion → citizen update
- [ ] Validate accessibility and the ≤120-second citizen booking target
- [ ] Resolve cancellation, reassignment, and lifecycle ownership gaps before implementation

## Scope Notes

**Included in the baseline:** Single-patient, one-way pickup-to-hospital booking; LINE LIFF; GPS/manual map pin; OSRM duration estimation; deterministic backward scheduling; conflict checks; dispatcher review; driver milestone updates; admin management and RBAC.

**Not in the baseline:** Continuous live vehicle GPS tracking, multi-stop shared rides, return trips, EHR integration, commercial billing, or dedicated IoT tracking hardware.