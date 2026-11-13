# Logic and Flow — Decisions to Fill In

Focus on how bookings, scheduling, dispatch, and trips should work. Existing SRS rules are listed below; fill in the unresolved decisions. Write **Use recommendation** to accept a suggested behavior. Recommendations are proposals, not approved changes to the SRS.

**Municipality:** เทศบาลตำบลบ้านกลาง
**Previously entered under “Completed by”:** December 2026

## 1. Existing rules from the SRS

- Citizen accepts consent before accessing the booking form; refusal shows the municipal phone alternative.
- Book for self or another patient; pickup must be inside the service area and destination must be supported.
- Submit at least 48 hours before the hospital appointment.
- One patient per vehicle per one-way trip.
- Hospital target arrival = appointment minus 20 minutes.
- Pickup = hospital target arrival minus pickup-to-hospital travel time.
- Depot departure = pickup minus depot-to-pickup travel time.
- Planned resource end = hospital target arrival plus 30 minutes.
- Vehicle and driver reservations cannot overlap.
- No available resources: keep the request REQUESTED for dispatcher review.
- Dispatcher approves, modifies, assigns, or rejects. Modification and rejection require reasons.
- Start Trip blocks citizen cancellation but leaves the status ASSIGNED.
- Driver milestones: Depart Depot → PICKING_UP; Confirm Pickup → PICKED_UP; Depart for Hospital → IN_TRANSIT; Confirm Handover → COMPLETED.
- Failed pickup cancels the booking, notifies relevant users, and releases its reservation.
- Geospatial changes propose replacement schedules; existing schedules stay until dispatcher confirmation.

## 2. Citizen booking flow

Current flow: Consent → Patient and appointment → Assistance and pickup → Review → Submit → Track status or cancel.

| Unresolved decision | Recommendation | Your answer |
|---|---|---|
| Can citizens change a request after submission? | No direct edits; contact the dispatcher for changes. | Confirmed: no direct citizen edits after submission; contact dispatcher. |
| What happens when a possible duplicate is found? | Flag it for dispatcher review; do not automatically reject. | yes |
| Who may reuse saved patient information? | Only the requester who saved it; no sharing between accounts. | yes |
| Maximum advance booking period? | Specify a number of days, or no maximum. | Confirmed: no maximum advance booking period. Minimum notice remains 48 hours. |
| How are appointments outside service hours handled? | Show a validation error and municipal contact option. Define allowed trip hours below. | yes |

**Operating days/hours:** every day 6am-4pm
**Holiday rules:** stop working
**May depot departure be before service hours or trip completion after them?** no

## 3. Scheduling and dispatcher flow

Current flow: Review request → Check route/time/resources → Approve → Schedule and assign → Monitor.

| Unresolved decision | Recommendation | Your answer |
|---|---|---|
| Are approval and assignment separate actions? | Keep approval separate; final assignment commits the vehicle and driver together. | yes |
| What moves APPROVED to SCHEDULED, then ASSIGNED? | Confirming a conflict-free schedule moves to SCHEDULED; confirming both resources moves to ASSIGNED. Recheck conflicts at final assignment. | yes |
| Do unconfirmed recommendations reserve resources? | No. Recommendations may become unavailable before confirmation. | ok |
| Does the fixed 30-minute turnaround include returning to the depot? | Confirm with municipality; the current formula does not calculate a hospital-to-depot leg. | Confirmed: 30-minute turnaround at the hospital; return to depot is not included. |
| Where must vehicles be before their next trip? | Define whether every trip starts at the depot or may start at the previous destination. | Confirmed: may start at previous hospital; calculate hospital-to-next-pickup travel time and validate availability. |
| What happens if routing fails? | Save the request as REQUESTED with a routing warning; prevent assignment until a valid schedule exists. | ok |
| How should eligible resources be ranked? | Match required assistance capabilities, then use a stable resource order; dispatcher may choose another available pair. | yes |
| May dispatchers override calculated times? | Allow with a reason and fresh validation; preserve the fixed arrival buffer and prevent conflicts. | yes |
| When a dispatcher changes hospital, pickup, or appointment details, what happens? | Recalculate and recheck resources before confirming; retain the existing assignment if the change fails. | yes |

## 4. Driver flow and exceptions

Current flow: View assignment → Start Trip → Depart Depot → Confirm Pickup → Depart for Hospital → Confirm Handover.

| Unresolved decision | Recommendation | Your answer |
|---|---|---|
| Can Start Trip be undone? | Only dispatcher correction with a reason, before Depart Depot. | yes |
| Can a dispatcher cancel after Start Trip? | Allow before patient pickup with a reason; define the procedure after patient pickup separately. | yes |
| How does reassignment work after depot departure but before pickup? | Require dispatcher confirmation of the handoff and new resource availability; keep both drivers informed. | yes |
| After failed pickup, when are resources physically available again? | Release the cancelled reservation but mark resources unavailable until the dispatcher confirms readiness. | yes |
| What happens when a trip runs late and affects another assignment? | Warn the dispatcher and block the affected resource from starting another trip until the active trip ends; dispatcher resolves later assignments. | yes |
| What happens if a vehicle breaks down? | Flag the trip for dispatcher intervention; no automatic completion or reassignment. | yes |
| What happens if the driver loses internet? | Show that the update is unconfirmed; retry safely after reconnection without skipping milestones. | yes |
| Can an incorrect milestone be corrected? | Dispatcher correction with a reason and audit history; define allowed corrections before implementation. | yes |

**Procedure for cancellation or breakdown after patient pickup:** Confirmed: the driver reports the incident and contacts the dispatcher. The trip remains active while the dispatcher arranges the next action. Record the incident and final outcome; do not automatically cancel the trip or release its vehicle/driver. A destination change requires dispatcher review and schedule/resource revalidation.

## 5. Walk through one example

Use fictional information. This helps verify that all four actors share the same understanding.

| Step | Expected action / result |
|---|---|
| Citizen submits an appointment request | |
| System proposes departure, pickup, and arrival times | |
| Dispatcher approves and assigns | |
| Citizen sees confirmed details | |
| Driver starts and completes each milestone | |
| Trip finishes and resources become available | |

**Other logic or flow changes:** ____________________

## Confirmed scheduling clarification

The user accepted the recommended editing and scheduling behavior in conversation. These decisions must be reflected in the SRS and implementation:

- Citizens contact the dispatcher to change submitted requests.
- The first trip starts at the depot; subsequent trips may start at the previous hospital after its 30-minute turnaround.
- For a subsequent trip, calculate departure from the previous hospital using its route to the next pickup. It must be no earlier than the previous trip's resource-ready time. Validate both driver and vehicle availability, assistance capabilities, service hours, and conflicts.
- Preserve the 20-minute hospital arrival buffer. Revalidate affected later trips if an earlier assignment changes; do not silently overwrite confirmed schedules.
- The existing depot-only scheduling formula and Depart Depot label need review for trips starting at a previous hospital.
- No maximum advance booking period applies. Requests must still be submitted at least 48 hours before the appointment, and schedules must satisfy operating hours, holidays, and resource availability.

## Approved logic decisions

The project owner approved these recommendations in conversation. They are reflected in SRS v1.2, Section 16.11. Actual holiday dates remain to be supplied.

### Correcting an accidentally recorded milestone

- The driver reports the mistake; only the dispatcher corrects it, with a mandatory reason.
- Preserve the original event and append a correction recording actor, time, previous state, and corrected state.
- Permit correction to the immediately preceding milestone only when the dispatcher confirms the physical trip state. Revalidate resource availability and affected later assignments.
- Do not use correction to undo actual patient pickup, bypass an incident procedure, or silently reopen a terminal trip.
- Keep Start Trip undo as a separate operation allowed only before departure, as already confirmed.

**Decision:** Approved.

### Closing a trip that ends without hospital handover

- Keep the trip active while the dispatcher coordinates assistance.
- If transport resumes and hospital handover occurs, finish as COMPLETED.
- If transport ends after pickup without hospital handover, use the terminal outcome `ABORTED`. Only the dispatcher may close it, with a reason, actual end time/location, and confirmation that the patient's handoff or next arrangement has been recorded.
- `ABORTED` is not failed pickup and does not count as successful completion. Adding it requires updating lifecycle rules, reports, screens, and tests together.
- Closing the trip does not by itself make resources ready; retain an operational hold until readiness is confirmed.
- Incident notes should describe transport actions and arrangements, without diagnoses or other prohibited clinical data.

**Decision:** Approved.

### Holiday calendar

**Which calendar applies (municipal list, national public holidays, or another list)?** ____________________

Approved behavior: an administrator maintains closure dates. A newly added closure flags existing affected assignments for dispatcher review; it never silently cancels them.

**Decision:** Management flow approved; calendar source/dates still needed.

## Current prototype gaps found during logic review

- `src/services/driver.ts` combines starting work and departing toward pickup. The confirmed flow requires a separate persisted Start Trip event before departure.
- `src/data/seed.ts` uses simplified booking statuses; it does not represent all SRS lifecycle states.
- `src/services/cancellation.ts` already restricts driver failed-pickup reports to before patient pickup. Preserve that restriction when adding incident handling.
- The reviewed driver progression guard checks another active trip for the same driver. Production validation must also protect the vehicle and readiness holds.

These are implementation gaps, not additional questions for the project owner.
