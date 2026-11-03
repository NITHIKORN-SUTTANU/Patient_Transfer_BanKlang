# Functional & Non-Functional Requirements Specification

## 1. Functional Requirements (FR)

| Requirement ID | Requirement Title | Primary Actor | Requirement Description | Traceability / Scope |
| :--- | :--- | :--- | :--- | :--- |
| **FR-01** | Interactive Location Pinning | ACT-01 | The system shall provide an interactive map interface within LINE LIFF enabling citizens to select pickup coordinates via HTML5 Geolocation or a draggable Leaflet/OSM marker. | In-Scope (Seminar) |
| **FR-02** | Backward Travel-Time Scheduling | System | The system shall deterministically compute vehicle departure and patient pickup times backwards from hospital appointment time using OSRM, incorporating a mandatory 20-minute buffer. | In-Scope (Seminar) |
| **FR-03** | Conflict-Free Fleet Verification | System | The system shall verify vehicle and driver availability across overlapping time intervals, ensuring zero schedule collisions for single-occupancy (1 vehicle : 1 patient) trips. | In-Scope (Seminar) |
| **FR-04** | Dispatcher Review & Decision Support | ACT-02 | The system shall provide a human-in-the-loop dispatch dashboard presenting system-generated schedule recommendations for dispatcher approval or modification; when no suitable resources are available, the dispatcher shall resolve resource conflicts and recheck scheduling before any manual rejection as a last resort with a recorded reason. | In-Scope (Seminar) |
| **FR-05** | 8-Stage Milestone State Management | System / ACT-03 | The system shall manage eight system-wide stages (*Requested*, *Approved*, *Scheduled*, *Assigned*, *Picking_Up*, *Picked_Up*, *In_Transit*, *Completed*). Only the dispatcher can approve a request; drivers update execution milestones through Depart Depot, Confirm Patient Pickup, Depart for Hospital, and Confirm Hospital Handover. *Cancelled* and *Rejected* are separate terminal outcomes. | In-Scope (Seminar) |
| **FR-06** | Digital Notification & Status Card | ACT-01 | The system shall deliver confirmation cards, scheduled pickup times, changes made by dispatchers (without requiring citizen acceptance), milestone updates, and cancellation/rejection notifications through the citizen's LINE Official Account. | In-Scope (Seminar) |

| **FR-07** | Citizen Booking Cancellation | ACT-01 | Citizens shall be able to cancel their own booking until, but not after, the assigned driver successfully confirms Start Trip; successful cancellation releases the assignment and notifies relevant actors. | In-Scope (Core Implementation) |
| **FR-08** | Resource Resolution & Manual Rejection | ACT-02 | When scheduling finds no eligible vehicle/driver, the booking shall remain REQUESTED; the dispatcher shall manage resources and recheck conflicts. Only the dispatcher may reject as a last resort and must record a reason. Approval does not require a justification; modification does. | In-Scope (Core Implementation) |
| **FR-09** | Failed Pickup & Exceptional Outcomes | ACT-03 / System | When a driver reports that the patient cannot be picked up, the system shall automatically cancel the booking, notify the citizen and dispatcher, and release its resource reservation immediately. | In-Scope (Core Implementation) |
| **FR-10** | Emergency Reassignment | ACT-02 | Emergency reassignment is permitted before patient pickup, requires a fresh conflict check, and notifies both old and new drivers; driver schedules update automatically without acknowledgement. | In-Scope (Core Implementation) |
| **FR-11** | Geospatial Change Revalidation | ACT-04 / ACT-02 | Changes to geospatial settings shall trigger recalculation for bookings whose trips have not started. Existing schedules remain effective until the dispatcher reviews and confirms replacements. | In-Scope (Core Implementation) |
| **FR-12** | Administrative Safeguards | ACT-04 | Prevent deactivation of vehicles/drivers with unfinished assignments; revoke access in current sessions immediately upon permission reduction/suspension; retain entered form data on validation errors; audit Admin and Dispatcher activities. | In-Scope (Core Implementation) |

## 2. Non-Functional Requirements (NFR)

| Requirement ID | Quality Category | Evaluation Metric & Standard | Target Specification |
| :--- | :--- | :--- | :--- |
| **NFR-01** | Usability & Speed | Mean Time-on-Task & Task Completion Rate | Routine booking completion time shall be **≤ 120 seconds**, achieving a Task Completion Rate ≥ 90% (≥ 85% for elderly participants). |
| **NFR-02** | Algorithmic Rigor | Schedule Collision Integrity | The deterministic backward scheduling algorithm shall produce **0 schedule collisions (100% collision-free)** across simulated booking batches. |
| **NFR-03** | Accessibility | UI Contrast & Accessibility Standards | The citizen interface shall adhere to WCAG 2.1 AA standards, featuring typography ≥ 16px, high contrast ratios, and touch targets ≥ 48px. |
| **NFR-04** | Data Governance & Privacy | Thai PDPA Compliance & RBAC | Strict adherence to Thai PDPA (B.E. 2562), enforcing 4-attribute data minimization (name, phone, coordinates, mobility status), mandatory explicit consent modal on LINE LIFF, and role-based access control (RBAC). |

## 3. Data Governance & PDPA Specification (NFR-04 Detailed)

### 3.1 Data Minimization Policy (Strict 4 Logistical Attributes)
In strict accordance with the Thailand Personal Data Protection Act (PDPA B.E. 2562), the platform implements a strict data minimization policy by restricting personal data collection exclusively to **four operational transit attributes**:
1. **Patient & Requester Identity:** Full name of patient and primary contact person (for on-site identity verification upon vehicle arrival).
2. **Contact Telephony:** Valid active mobile phone number (for ambulance driver coordination if the pickup spot is ambiguous).
3. **Transit Geolocation:** Residential address and GPS latitude/longitude coordinates within the service area (for automated OSRM travel-time computation and driver navigation).
4. **Physical Mobility Category:** Functional transit assistance requirement, classified strictly into:
   * *Ambulatory / Normal* (able to board and sit without assistive hardware).
   * *Wheelchair-Bound* (requires ramp accessibility and secure tie-downs).
   * *Stretcher-Bound* (requires non-emergency reclining stretcher equipment).

> **Clinical Data Isolation Boundary:** The system strictly **prohibits** the ingestion, processing, or storage of diagnostic medical histories, disease diagnoses, clinical laboratory results, or physician progress notes.

### 3.2 Explicit Consent Mechanism (LINE LIFF Modal)
* **Pre-Intake Enforcement:** Prior to accessing the booking reservation form, citizens must pass through a non-bypassable **PDPA Consent Modal** within LINE LIFF.
* **Mandatory Opt-In:** Users must tap **"Accept & Consent"** confirming that their logistical details will be utilized solely by Ban Klang Municipality for transport arrangement.
* **Refusal Fallback:** If consent is withheld, the digital booking flow terminates immediately with instructions to book via the conventional municipal telephone line.

### 3.3 Acute Emergency Disclaimer & 1669 Triage
* **Non-Emergency Boundary:** The interface must feature a persistent, high-contrast banner:  
  > *"Notice: This service is exclusively reserved for scheduled, non-emergency outpatient visits. For acute or life-threatening emergencies, exit immediately and call 1669."*
* **Direct 1669 Triage Button:** An integrated emergency button allowing one-tap speed dialing to Thailand's national EMS hotline (1669) must remain accessible across all booking views.

### 3.4 Role-Based Access Control (RBAC) & Retention
* **Access Scoping:**
  * **Citizen (ACT-01):** Restricted to their own active transit bookings and status milestones.
  * **Dispatcher (ACT-02):** Authorized to review booking details, trip origins, and contact numbers for scheduling verification.
  * **Driver (ACT-03):** Granted just-in-time access only to assigned passenger itineraries and pickup coordinates during active shifts.
* **Third-Party AI Isolation:** No personal identifiable information (PII) or transit telemetry shall ever be transmitted to external public LLMs or unvetted external web APIs.
* **Data Retention & Purging:** Operational coordinates are pseudonymized upon mission completion and purged from active routing caches after each operational cycle.


> **Implementation note:** The fixed 48-hour booking lead time and fixed 20-minute hospital-arrival buffer are not configurable rules. Previously documented Seminar-only scope labels are retained where present for traceability; the agreed delivery baseline is a fully tested core four-actor implementation by December 2026.
