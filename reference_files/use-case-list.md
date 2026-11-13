# Use Case List

Source: User Roles & Actor Specifications (ACT-01 to ACT-04).
Naming convention: **Verb + Object**, using the verbs and objects of the specification.

**System users: 4 actors. Use cases: 29 (UC-01–UC-29).**

## ACT-01: Citizen / Caregiver (Requester) — 7 use cases

| ID | Use Case | Description | Source in specification |
|---|---|---|---|
| UC-01 | Submit Booking Request | Submit non-emergency transportation requests at least 48 hours prior to clinical appointments. | "Submit non-emergency transportation requests at least 48 hours prior to clinical appointments" |
| UC-02 | Specify Mobility Assistance Needs | Specify mobility assistance needs (normal seating, wheelchair, or stretcher). | "Specify mobility assistance needs (normal seating, wheelchair, or stretcher)" |
| UC-03 | Pin Pickup Location | Pin exact pickup coordinates using GPS auto-acquisition or draggable map markers. | "Pin exact pickup coordinates using GPS auto-acquisition or draggable map markers" |
| UC-04 | Review Trip Confirmation Card | Review trip confirmation cards. | "Review trip confirmation cards" |
| UC-05 | Review Scheduled Pickup Time | Review scheduled pickup times. | "scheduled pickup times" |
| UC-06 | Review Trip Lifecycle Notifications | Review system-wide lifecycle notifications and terminal cancellation/rejection outcomes. | "live 8-stage lifecycle notifications" |

| UC-25 | Cancel Booking Request | Cancel own booking before Driver Start Trip; notify relevant actors and release reservation. | Confirmed User Flow Review 08, 11, 24 |

## ACT-02: Municipal Dispatcher (Staff) — 12 use cases

| ID | Use Case | Description | Source in specification |
|---|---|---|---|
| UC-07 | Triage Booking Request | Triage incoming booking requests verified by the backward-scheduling engine. | "Triage incoming booking requests verified by the backward-scheduling engine" |
| UC-08 | Review Automated Vehicle-Driver Assignment | Review automated vehicle-driver assignments. | "Review automated vehicle-driver assignments" |
| UC-09 | Evaluate Potential Scheduling Warnings | Evaluate potential scheduling warnings. | "evaluate potential scheduling warnings" |
| UC-10 | Approve Booking Request | Approve valid requests without mandatory justification. | "Approval does not require a justification" (Review 13) |
| UC-11 | Modify Booking Request | Modify booking requests (adjust vehicle/driver/times) with logged justifications. | "modify (adjust vehicle/driver/times) ... booking requests with logged justifications" |
| UC-12 | Reject Booking Request | Reject booking requests with logged justifications. | "reject booking requests with logged justifications" |
| UC-13 | Log Justification | Log the justification for modifying or rejecting a booking request. | "with logged justifications" |
| UC-14 | Monitor Daily Fleet Schedule | Monitor daily fleet schedules. | "Monitor daily fleet schedules" |
| UC-15 | Handle Trip Cancellation | Handle trip cancellations. | "handle trip cancellations" |
| UC-16 | Handle Emergency Reassignment | Reassign before patient pickup; recheck conflicts; notify old and new drivers. | "handle ... emergency reassignments" |

| UC-26 | Resolve Resource Conflict | Manage unavailable vehicles/drivers and recheck scheduling before manual rejection as a last resort. | Confirmed User Flow Review 10, 25 |
| UC-28 | Review Recalculated Schedule | Dispatcher reviews and confirms proposed schedule changes; administrator initiates settings changes only. | SRS FR-043 and Section 16.10 |

## ACT-03: Ambulance Driver (Staff) — 5 use cases

| ID | Use Case | Description | Source in specification |
|---|---|---|---|
| UC-17 | View Daily Schedule | View daily scheduled passenger runs. | "View daily scheduled passenger runs" |
| UC-18 | View Patient Pickup Location | View patient pickup locations. | "patient pickup locations" |
| UC-19 | View Required Mobility Aids | View required mobility aids. | "required mobility aids" |
| UC-20 | Advance Trip Lifecycle Stage | Use Depart Origin, Confirm Patient Pickup, Depart for Hospital and Confirm Hospital Handover. Start Trip marks the cancellation cutoff; incidents/corrections follow dispatcher rules. | SRS Sections 16.10–16.12 |

| UC-27 | Report Failed Pickup | Report inability to pick up a patient, triggering cancellation, notifications and reservation release; retain an operational hold until readiness confirmation. | Confirmed User Flow Review 17, 27, 30; SRS Section 16.10 |

## ACT-04: System Administrator (Admin) — 5 use cases

| ID | Use Case | Description | Source in specification |
|---|---|---|---|
| UC-21 | Maintain Fleet Master Data | Maintain fleet master data (EMS vehicle assets, wheelchair lift capabilities, driver rosters). | "Maintain fleet master data (EMS vehicle assets, wheelchair lift capabilities, driver rosters)" |
| UC-22 | Configure Geospatial Parameters | Maintain depot, service area and explicit closures; view fixed 06:00–16:00 hours and fixed 20-minute buffer. | SRS Sections 16.10–16.11 |
| UC-23 | Audit System Transaction Logs | Audit Admin and Dispatcher transaction logs. | "Audit system transaction logs" |
| UC-24 | Enforce Role-Based Access Control (PDPA) | Enforce Thai PDPA role-based access control (RBAC). | "enforce Thai PDPA role-based access control (RBAC)" |

| UC-29 | Safeguard Fleet and Account Changes | Block deactivation with unfinished work and revoke reduced/suspended access immediately. | Confirmed User Flow Review 19, 21 |

## Relationships

The specification does not use the terms include / extend / generalization. The relationships below are modeling choices made for the use case diagram; each is tied to the specification text it is based on.

| Type | From | To | Based on specification text |
|---|---|---|---|
| «include» | UC-01 Submit Booking Request | UC-02 Specify Mobility Assistance Needs | ACT-01 responsibilities: "Submit ... requests" and "Specify mobility assistance needs" |
| «include» | UC-01 Submit Booking Request | UC-03 Pin Pickup Location | ACT-01 responsibilities: "Submit ... requests" and "Pin exact pickup coordinates" |
| «include» | UC-11 Modify Booking Request | UC-13 Log Justification | Review 13: modification and rejection require reasons |
| «include» | UC-12 Reject Booking Request | UC-13 Log Justification | Review 13: modification and rejection require reasons |
| «extend» | UC-09 Evaluate Potential Scheduling Warnings | UC-08 Review Automated Vehicle-Driver Assignment | ACT-02: "Review automated vehicle-driver assignments and evaluate potential scheduling warnings" |
| Generalization | — | — | Not applicable: the specification contains none |

**Diagram source:** `use-case-diagram.md` is the maintained diagram. The PNG is historical and must not be used to infer approval justification or ownership. UC-01–UC-29 remain stable; incident/correction/holiday responsibilities are documented as extensions of their owning flows in SRS Sections 16.11–16.12.
