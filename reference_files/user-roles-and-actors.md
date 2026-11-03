# User Roles & Actor Specifications

This document outlines the primary human actors and system roles interacting with the Ban Klang Municipal Patient Transit Booking Platform.

## 1. Actor Catalog

### ACT-01: Citizen / Caregiver (Requester)
- **Description:** Elderly residents, homebound/bedbound patients, or their primary family caregivers living within the 12 villages of Ban Klang Subdistrict Municipality.
- **Access Channel:** LINE Official Account (via LINE Frontend Framework - LIFF).
- **Core Responsibilities:**
  - Submit non-emergency transportation requests at least 48 hours prior to clinical appointments.
  - Specify mobility assistance needs (normal seating, wheelchair, or stretcher).
  - Pin exact pickup coordinates using GPS auto-acquisition or draggable map markers.
  - Review trip confirmation cards, scheduled pickup times, and system-wide lifecycle notifications; edit individual booking sections while retaining entered data; cancel a booking before driver Start Trip.

### ACT-02: Municipal Dispatcher (Staff)
- **Description:** Municipal healthcare and administrative officers responsible for daily transit oversight.
- **Access Channel:** Web-based Staff Dispatch Portal (Desktop browser).
- **Core Responsibilities:**
  - Triage incoming booking requests verified by the backward-scheduling engine.
  - Review automated vehicle-driver assignments and evaluate potential scheduling warnings.
  - Exercise human-in-the-loop authority: approve without mandatory justification; modify (adjust vehicle/driver/earlier pickup time) or reject with a recorded justification. When capacity is insufficient, resolve resources and recheck conflicts before rejection as a last resort.
  - Monitor daily fleet schedules; make verification calls when deemed necessary; handle cancellations, failed-pickup notices, settings-change reviews and emergency reassignments before patient pickup.

### ACT-03: Ambulance Driver (Staff)
- **Description:** Municipal vehicle operators assigned to transport non-emergency patients between residential pickup points and regional hospitals.
- **Access Channel:** Mobile-optimized Web Staff Portal.
- **Core Responsibilities:**
  - View daily scheduled passenger runs, patient pickup locations, and required mobility aids.
  - Update only execution milestones of the system-wide eight-stage lifecycle: Start Trip confirms work (without advancing to PICKING_UP), Depart Depot sets PICKING_UP, Confirm Patient Pickup sets PICKED_UP, Depart for Hospital sets IN_TRANSIT, and Confirm Hospital Handover sets COMPLETED. Report failed pickup for automatic cancellation; receive reassignment updates without acknowledgement.

### ACT-04: System Administrator (Admin)
- **Description:** Technical personnel managing municipal system configurations and data integrity.
- **Access Channel:** Administrative Console.
- **Core Responsibilities:**
  - Maintain fleet master data (EMS vehicle assets, wheelchair lift capabilities, driver rosters).
  - Configure municipal geospatial parameters (depot location, service area, operating hours); the fixed 20-minute hospital-arrival buffer is not adjustable. Changed settings trigger recalculation of not-yet-started bookings, pending dispatcher confirmation.
  - Audit Admin and Dispatcher activities and enforce Thai PDPA role-based access control (RBAC), including immediate revocation of active sessions. Do not deactivate a vehicle or driver with unfinished assignments.

---
## 2. Passenger Verification (Google Form Comparison and Dispatcher Rules)

Citizens use the platform as a web app opened inside LINE (LIFF), signed in only through their existing LINE account, with no separate registration. The Municipal Dispatcher (ACT-02) therefore reviews eligibility checks before approval and may call the requester when the Dispatcher considers it necessary; a phone call is not mandatory for every booking.

### 2.1 Comparison: Existing Google Form vs. Comparable Systems vs. Proposed Platform

The "Google Form" column reflects the form's introduction page. Items marked [fill] are on later pages of the form and still need to be checked.

| Aspect | Municipality Google Form | Comparable systems | Proposed platform |
| :--- | :--- | :--- | :--- |
| Login / identity | Form opens without sign-in; Google sign-in is offered only to save progress. Whether sign-in is needed to submit: [confirm]. No identity check on the first page | Phone-based booking without a portal login is common; staff ask questions to confirm eligibility (NC Medicaid NEMT, NHS patient transport) | LINE LIFF (no separate registration) plus optional phone confirmation at Dispatcher discretion |
| Required fields | [fill: each question, required or optional] | Name, contact phone, pickup and destination, appointment time, mobility device, companion | Name, phone, pickup pin, hospital, appointment time, mobility need |
| Eligibility check | Intended for bedridden or post-surgery patients; trips only within Mueang Lamphun district (stated in the form title). No other check visible on the first page | Checked before scheduling; the trip is declined with a documented reason if a check fails (Colorado HCPF) | Boundary and lead time checks; optional phone verification (VR-01 to VR-05) |
| Identity verification | Staff phone the requester to confirm the booking before the appointment date (stated on the form) | Staff verify the member and trip details and can confirm pickup details ahead of the trip (Oregon CCO contract) | Dispatcher phone confirmation when necessary (VR-05) |
| Who may book | [fill] | Patient, relative or carer (NHS); some services accept staff bookings only (NSW) | Citizen or caregiver (ACT-01) |
| Advance notice | At least 2 days | 72 hours (TennCare); up to 28 days ahead (Scottish Ambulance Service) | At least 48 hours (Rule R1) |
| Slot capacity | 1 booking per hour; if the slot is full, staff phone to reschedule; public booking calendar | Not covered in sources | Automatic conflict check (R2) before the Dispatcher reviews |
| Abuse handling | None visible | Repeated no-shows can lead to consequences (NC Medicaid NEMT) | Duplicate and repeat-request flags (VR-04) |

**Sources:** HCPF OM 25-066 (hcpf.colorado.gov); NC Medicaid NEMT FAQ (wellcarenc.com); PacificSource NEMT contract text (pacificsource.com/media/36716); NHS Imperial patient transport (imperial.nhs.uk); NSW Patient Transport Service (service.nsw.gov.au); TennCare NEMT FAQ (tn.gov); Scottish Ambulance Service patient transport. Most are US Medicaid programmes, so only their process patterns are reused, not their legal eligibility rules.

### 2.2 Dispatcher Verification Rules

| ID | Rule | Performed by | If failed |
| :---: | :--- | :--- | :--- |
| VR-01 | Contact phone is a valid Thai mobile number (10 digits) | System at intake | Return to form |
| VR-02 | Pickup pin is inside the 12 villages and matches the address given | System (DT-03); Dispatcher re-checks pin vs. address | Reject |
| VR-03 | Request is at least 48 hours before the appointment (R1) and the destination is a supported hospital | System | Reject, direct to hotline |
| VR-04 | Duplicate / abuse check: same LINE ID or phone with overlapping or too many active requests (limit to be set) | System flags, Dispatcher decides | Escalate or reject, flag LINE ID |
| VR-05 | **Optional phone confirmation call (Dispatcher discretion):** when performed, confirm patient name, hospital, appointment date/time, pickup address and mobility need | Dispatcher | See outcomes below |
| VR-06 | When verification is performed, its result (outcome, dispatcher, time) is saved; modification/rejection justifications are recorded separately | System | - |
| VR-07 | If the caller describes an emergency, advise calling 1669 and do not process as a booking | Dispatcher | Close request |

**VR-05 outcomes:** A completed call with matching details may support approval; an unreachable or mismatched contact requires Dispatcher review and does not trigger automatic rejection. The number of attempts, calling deadline, and abuse-flag handling remain **to be confirmed with the municipality**. No mandatory call is imposed for all requests.
