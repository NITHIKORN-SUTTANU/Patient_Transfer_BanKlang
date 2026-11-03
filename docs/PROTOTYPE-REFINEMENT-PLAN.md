# Prototype refinement plan

Prepared 28 October 2026. Scope: refine the existing React prototype for published usability testing, using `reference_files` as the requirements baseline. No Figma work is required. This document is a plan, not a claim that missing features are implemented.

## 1. Reference baseline and conflicts

Read all reference Markdown files and inspected `use-case-diagram.png`. Use these sources as follows:

| Source | Planning authority |
| --- | --- |
| [Functional and non-functional requirements](../reference_files/NR_and_NFR.md) | FR-01–FR-12, NFR-01–NFR-04, consent, emergency access, data boundaries |
| [Actor specifications](../reference_files/user-roles-and-actors.md) | Responsibilities, access scopes, VR-01–VR-07, unresolved municipal policies |
| [Use cases](../reference_files/use-case-list.md) | UC-01–UC-29 and actor coverage |
| [System logic](../reference_files/designs/system-logic.md) | R1/R2, scheduling formulas, decision tables, lifecycle, confirmed exception rules in section 8 |
| [Citizen flow](../reference_files/userflows/Citizen.md), [dispatcher flow](../reference_files/userflows/Municipal_Dispatcher.md), [driver flow](../reference_files/userflows/Driver.md), [admin flow](../reference_files/userflows/Administrator.md) | Interaction sequences and cross-actor effects |
| [Data schema](../reference_files/designs/data-schema.md) | Architecture and initial entity model; requires extensions for newer exception rules |
| [Screen inventory](../reference_files/designs/figma_screen_inventory.md) | Supporting screen-coverage checklist; explicitly proposed UI, not independent business requirements |
| [Scope](../reference_files/scope.md) | One-way, single-patient boundary, excluded features, ten-person evaluation |
| [Actor connection diagram](../reference_files/userflows/How_4_actors_are_connected.md), [use-case image](../reference_files/use-case-diagram.png) | Supporting diagrams requiring correction |

Proposed precedence: the user's current coded-prototype objective, explicit confirmed rules in system-logic section 8 and updated actor flows, FR/NFR and use cases, original schema, then proposed screen inventory. This precedence is an engineering interpretation where documents disagree.

Conflicts to resolve in a short requirements-alignment commit before feature work:

- `scope.md` describes a seminar/Figma-only deliverable and excludes full-stack implementation. The requirements implementation note and screen inventory instead target a tested core four-actor implementation by December 2026. Retain the narrow transport scope; treat coded-prototype publication as the immediate deliverable and real integration as a separate release gate.
- The use-case image requires a reason for approval and omits UC-25–UC-29. The updated use cases explicitly require reasons for modification/rejection only. Follow the updated text.
- The screen inventory still calls cancellation/reassignment open decisions and its example asks for approval justification. These have been resolved by updated flows and system-logic section 8.
- The actor connection diagram reuses node IDs for different actors/system components, producing misleading connections. Correct it to reflect scheduling → dispatcher → driver → citizen status.
- The original schema excludes completed trips from conflict checks, while system logic says completion must still respect resource availability. Proposed interpretation: completion does not erase an unexpired turnaround reservation. Document this interpretation and validate the operational assumption.
- `SCHEDULED → ASSIGNED` is described both as shift-start dispatch and as immediate manifest dispatch. Preserve both recorded events; use immediate manifest dispatch for prototype sessions, explicitly documented as an assumption pending confirmation.
- The schema needs cancellation, Start Trip, reasons, verification, notification, proposal/version and audit fields. Its eight-state column alone no longer covers the confirmed requirements.

## 2. What to preserve and what is missing

The existing code has four role interfaces, consent gating, booking validation, 48-hour checks, review/edit navigation, manual scheduling, basic resource overlap checks, driver milestones, admin CRUD and local persistence. The previous verification run passed build, lint and all 41 browser tests. Passing those tests does not establish conformance with requirements not yet tested.

| Requirement coverage | Current gap | Planned work |
| --- | --- | --- |
| FR-01; UC-03, UC-18; VR-02 | Percentage-based illustrated pickup pin; current-location action always fails | Geographic coordinates, address, GPS/manual map, boundary check and shared pickup display |
| FR-02–FR-04; UC-07–UC-11, UC-14, UC-26 | Manual assignment follows approval; reservation ends at appointment; no automated candidate recommendation | Generate proposal before approval, correct interval, eligible candidates and resource-resolution flow |
| FR-05; UC-20 | Five coarse booking statuses plus separate driver stages; no independent Start Trip | Explicit eight-stage lifecycle and separate Start Trip event |
| FR-06; UC-04–UC-06 | Current-state views without a durable notification history or LINE delivery | Shared events, confirmation card, update history and notification adapter |
| FR-07/FR-09; UC-15, UC-25, UC-27 | No cancellation or failed-pickup outcome | Cancellation cutoff, failed pickup, release and cross-actor updates |
| FR-08/FR-10; UC-11–UC-13, UC-16, UC-26 | No complete modification/reassignment/resource-resolution workflow | Reasoned changes, conflict rechecks, pre-pickup reassignment |
| FR-11; UC-22, UC-28 | Settings are descriptive strings with no schedule impact | Geographic settings, versioned recalculation proposals, dispatcher confirmation |
| FR-12; UC-21, UC-23, UC-24, UC-29 | Deactivation warning does not block unfinished assignments; audit is Admin-only; no real sessions | Enforced guards, dispatcher audit, role-scoped session behavior |
| VR-04–VR-06 | No duplicate warning or optional verification record | Evidence-based duplicate flag; optional call outcome with actor/time |
| NFR-01–NFR-04 | No measured usability results, batch collision evaluation, full accessibility audit or enforceable backend RBAC | Explicit evaluation and publication gates |

## 3. Delivery boundary

Deliver two clearly distinguished milestones:

1. **Published usability prototype:** complete required interactions and business rules with fictional participants, deterministic route fixtures, explicit simulated identities and an in-app notification inbox. A real geographic map can be used with fixture routes. Each requirement is tagged implemented, simulated, deferred or blocked by missing municipal input. Local persistence supports one-browser role switching; it must not be described as shared cross-device operation or secure RBAC.
2. **Integrated four-actor pilot:** shared API/database, enforced identity and authorization, LINE LIFF identity, LINE delivery, approved routing integration and reviewed geographic configuration. Required before claiming cross-device workflow, real notifications or access protection. This follows the reference architecture; it is not necessary to rebuild the frontend.

Simulation is a delivery technique, not removal of FR-01/FR-02/FR-06 or NFR-04. Live integration remains an explicit gate. Use fictional data in usability sessions until the integrated controls are verified. Keep live transport operations outside this prototype release.

Do not add return trips, inter-hospital transfers, shared rides, billing, clinical records, continuous vehicle tracking, EHR integrations or IoT hardware. These are excluded by `scope.md`.

## 4. Ordered implementation phases

### Phase 0 — Align requirements and test fixtures

Sources: all references; especially system-logic section 8 and UC-25–UC-29.

- Record the conflict resolutions and open decisions from sections 1 and 7 in development documentation. Preserve original references unless correcting them in a separately reviewable documentation change.
- Create a traceability checklist for every FR, UC and NFR with implementation location, simulation status, test and evidence.
- Define fictional citizens, all three mobility categories, compatible/incompatible vehicles, available/unavailable drivers, supported hospitals and service-area fixtures.
- Use an injectable clock for deterministic boundary tests. Session fixtures should generate dates relative to the session, avoiding expired demo appointments.

Exit: every requirement has an implementation/test destination; unresolved policies are visible rather than silently invented.

### Phase 1 — Shared domain, lifecycle and scheduling correctness

Sources: FR-02/FR-03/FR-05; R1/R2; system-logic sections 3, 5 and 8; data schema.

Primary files: `src/data/seed.ts`, `src/services/booking.ts`, `src/services/dispatch.ts`, `src/services/driver.ts`, `src/utils/validateDemoState.ts`, `src/services/demoStore.ts`.

- Introduce canonical states: REQUESTED, APPROVED, SCHEDULED, ASSIGNED, PICKING_UP, PICKED_UP, IN_TRANSIT, COMPLETED; CANCELLED and REJECTED are separate terminal outcomes.
- Add a transition table with actor/action guards. Start Trip records `startedAt` while retaining ASSIGNED. Depart Depot is a separate action.
- Record event ID, booking ID, actor, action, timestamp and version. Keep verification status separate from trip state.
- Model typed mobility, vehicle capability flags, driver duty status, pickup latitude/longitude/address, citizen ownership, reservation and schedule proposal/version.
- Implement backward scheduling with fixed 48-hour submission lead time and fixed 20-minute arrival buffer. Preserve the reference's 30-minute turnaround assumption as a named constant pending operational validation.
- Reserve `[departure, arrival + 30 minutes)` for both resources; equality at adjacent endpoints is allowed. Prevent departure at or before now. Keep unexpired completion reservations; cancellation explicitly releases them.
- Generate eligible resource candidates using mobility compatibility, duty/availability and interval conflicts. Include operating-hour evaluation once the unresolved interpretation is settled.
- Version persisted state and migrate valid older records. Do not silently present old percentage pins as GPS coordinates or fabricate historical events. Provide a clear reset path for incompatible demo records.

Acceptance:

- Reference example: appointment 09:00, depot leg 15m, hospital leg 35m → departure 07:50, pickup 08:05, arrival 08:40, next available 09:10.
- Exactly 48 hours is accepted; less is blocked at final submission with municipal contact fallback.
- Incompatible vehicles, unavailable drivers, past departure and either-resource overlap cannot be confirmed.
- Invalid/out-of-order transitions are rejected; all roles derive labels from the same state.
- A stale confirmation revalidates against current data before saving.

### Phase 2 — Citizen intake and status

Sources: FR-01/FR-06/FR-07; UC-01–UC-06/UC-25; DT-01–DT-05; VR-01–VR-03; Citizen flow; NFR-03/NFR-04.

Primary files: `src/pages/BookingPage.tsx`, `src/components/BookingUI.tsx`, booking styles; proposed map, identity and notification adapters.

- Keep the three-step booking flow and section editing with entered values preserved.
- Provide explicit consent acceptance and decline-to-municipal-contact paths. Store consent time and notice version as implementation metadata.
- Replace the illustrated pin with a geographic map: GPS acquisition, permission/error/loading states, draggable/manual marker, address and coordinate confirmation. Manual selection must work when GPS fails.
- Validate finite geographic coordinates, service-area membership and supported hospital. Municipal boundary/hospital data must be supplied or clearly marked as fixtures.
- Keep the non-emergency banner and one-tap 1669 action accessible throughout booking views. Show municipal contact for lead-time refusal and consent decline.
- Show REQUESTED as awaiting dispatcher review; only show a confirmed pickup after the schedule is activated.
- Add confirmation card, full lifecycle, notification history, changed trip details and cancellation availability. Citizens do not accept dispatcher modifications.
- Scope booking lists/details to the selected fictional citizen in simulation and to authenticated ownership in the integrated release.

Acceptance: denied GPS recovers through manual pinning; invalid/outside pin cannot submit; edit/back retains values; no consent blocks intake; one citizen cannot retrieve another's booking through a direct link; updates and reasons are visible.

### Phase 3 — Dispatcher decision support and fleet operations

Sources: FR-04/FR-08/FR-10; UC-07–UC-16/UC-26; VR-04–VR-07; Dispatcher flow.

Primary files: `src/pages/DispatcherPage.tsx`, `src/components/DispatchAssignment.tsx`, `src/services/dispatch.ts`; proposed scheduling/verification/audit services.

- Show a computed proposal and warnings while the booking remains REQUESTED. A proposal never approves a booking automatically.
- Make available candidate vehicle/driver pairs and mobility eligibility visible. Show why resources are excluded.
- Add a resource-resolution view and recheck action. Capacity failure retains REQUESTED. Manual rejection is a last resort with a recorded reason; ordinary approval needs no reason.
- Support modification of vehicle, driver or earlier pickup with mandatory reason, arrival guarantee and fresh conflict check. Do not permit arbitrary later pickup.
- Add optional verification outcome, actor and timestamp. Unreachable/mismatch leads to review, never automatic rejection. Flag same-phone/identity overlapping requests; leave numerical abuse thresholds unset until confirmed.
- Provide a daily fleet calendar of occupied vehicle/driver intervals with warnings and booking details, rather than only a tracking list.
- Add cancellation management and pre-pickup emergency reassignment. Notify both drivers; remove the old task and add the replacement automatically without requiring acknowledgement.
- Log approval, modification, rejection, resource-resolution actions, verification, reassignment and schedule activation in the shared audit trail.

Acceptance: no-capacity request remains pending through recheck; modifications/rejections fail without reasons; approval succeeds without a reason; reassignment works before pickup and fails after pickup; every confirmed change appears consistently across affected roles.

### Phase 4 — Driver execution and cross-actor exceptions

Sources: FR-05/FR-07/FR-09/FR-10; UC-17–UC-20/UC-25/UC-27; Driver flow; system-logic section 8.

Primary files: `src/pages/DriverPage.tsx`, `src/services/driver.ts`; proposed cancellation/reservation services.

- Display assigned daily work, pickup map/address, required mobility aid, schedule and next allowed action.
- Implement Start Trip → Depart Depot → Confirm Patient Pickup → Depart for Hospital → Confirm Hospital Handover as distinct actions with confirmations where consequential.
- Implement citizen cancellation before Start Trip, including pending/unassigned requests. Started and terminal trips cannot be cancelled by the citizen.
- Implement failed pickup from the pre-pickup execution flow: save outcome/reason, automatically cancel, notify citizen/dispatcher and release reservation immediately.
- Commit cancellation versus Start Trip using a shared version check. In an integrated pilot this must be an atomic database operation; localStorage cannot guarantee cross-client atomicity.
- Invalidate open driver confirmations after reassignment, cancellation or access revocation. Reflect changes in schedule and status views immediately.

Acceptance: a successful Start Trip leaves ASSIGNED but disables citizen cancellation; only one competing Cancel/Start action succeeds; failed pickup cancels and releases once; old driver cannot update reassigned work; terminal jobs cannot advance again.

### Phase 5 — Admin safeguards and settings impact

Sources: FR-11/FR-12; UC-21–UC-24/UC-28/UC-29; Admin flow; NFR-04.

Primary files: `src/services/admin.ts`, `src/components/AdminForms.tsx`, `src/pages/AdminPage.tsx`, `src/services/resources.ts`.

- Block vehicle/driver deactivation with unfinished assignments in the service layer, including changes from stale forms. A warning alone is insufficient.
- Represent depot coordinates, service-area geometry, supported settings and operating hours as validated data. Keep 48 hours and 20 minutes read-only.
- On relevant settings changes, generate recalculated proposals only for trips without Start Trip recorded. Keep old schedules/reservations active until dispatcher confirmation.
- Show changed times/resources and conflicts to the dispatcher. Recheck on activation; activate a replacement atomically and notify affected actors. A rejected/conflicting proposal leaves the old schedule intact.
- Enforce current role/account status on both reads and mutations. Suspension/reduced access invalidates active sessions immediately in the integrated pilot; expose the equivalent behavior in simulation without claiming security.
- Combine Admin and Dispatcher audit details; retain form data and display field-level validation errors.
- Implement and demonstrate coordinate masking/pseudonymization and routing-cache purge after completion. Keep audit evidence minimal; do not copy unrestricted patient records into before/after logs.

Acceptance: deactivation with unfinished work is blocked; settings edits cannot silently overwrite active schedules; started work is excluded; old credentials/session cannot continue after revocation; unauthorized routes and mutations fail; validation errors preserve inputs.

### Phase 6 — Evaluation and publication

Sources: NFR-01–NFR-04; scope evaluation (n=10); reference architecture and channel requirements.

- Add repeatable fictional scenarios and a session reset covering happy path, denied GPS, boundary rejection, insufficient lead time, resource conflict, modification, rejection, cancellation, failed pickup, reassignment and settings recalculation.
- Retain the current browser suite; update assertions that encode old statuses/intervals. Add focused domain tests for formulas/transitions and generated batch tests for collision integrity. Screenshots alone are not accessibility evidence.
- Measure citizen typography ≥16px, touch targets ≥48px, contrast, keyboard operation, visible focus, screen-reader labels/announcements and zoom/reflow against the reference's WCAG 2.1 AA target.
- Run the ten-person usability evaluation. Report sample composition, task definition, timing, success/failure, assistance and observed confusion without recording clinical data.
- Meet mean routine-booking time ≤120 seconds, completion ≥90% overall and ≥85% for elderly participants. Report raw counts and subgroup size so rounded percentages do not conceal failures. Re-test changes that address failed tasks.
- Require zero collisions across deterministic simulated batches and stale/concurrent assignment tests; report tested cases rather than claiming a proof from a small sample.
- Build and test the production artifact, not only the development server. Verify direct links and refresh on `/booking`, `/dispatcher`, `/driver`, `/admin`, mobile assets and routing fallback.
- Publish an explicitly labeled prototype with session instructions and known simulations. Use a chosen host's SPA fallback; add deployment configuration and CI checks once the host is selected.
- For cross-device testing, implement the reference API/database boundary with authoritative server validation and atomic reservation writes. Verify LIFF identity, staff sessions, role-scoped queries, notification delivery and routing failures before calling it an integrated pilot.

Exit: traceability evidence complete for the selected milestone; core scenarios pass; usability results recorded; publication smoke checks pass; unimplemented live integrations remain explicitly labeled.

## 5. Test and evidence matrix

| Test group | Minimum evidence | References |
| --- | --- | --- |
| Intake | Consent accept/decline, own-booking scope, phone/hospital checks, exact 48h edge, missing/outside pin, GPS denial recovery | FR-01, R1, DT-01–DT-05, VR-01–VR-03, NFR-04 |
| Scheduling | Worked example, cross-midnight/Bangkok dates, same vehicle/different driver and reverse conflicts, adjacent intervals, mobility mismatch, unexpired turnaround, unavailable resources, stale confirmation | FR-02/FR-03, R2, NFR-02 |
| Dispatcher | Proposal before approval, no-resource retry, optional verification, duplicate flag, reason rules, earlier pickup, daily calendar | FR-04/FR-08, UC-07–UC-14/UC-26, VR-04–VR-07 |
| Lifecycle | All eight stages, separate Start Trip, prohibited skips, completion, duplicate/stale actions | FR-05, UC-20 |
| Exceptions | Cancel before/after Start, simultaneous Cancel/Start, failed pickup, release, reassignment before/after pickup, old-driver stale dialog | FR-07/FR-09/FR-10, UC-15/UC-16/UC-25/UC-27 |
| Admin | Unfinished-work deactivation block, field data retention, permission revocation, proposed/active settings separation, conflicting recalculation, audit scope | FR-11/FR-12, UC-21–UC-24/UC-28/UC-29 |
| Notifications | Confirmation, modification without citizen acceptance, all milestones, rejection, cancellation, both-driver reassignment, settings activation; no duplicate visible events | FR-06, UC-04–UC-06 |
| Evaluation/release | Ten-person study, timing/completion counts, contrast/target/font measurements, keyboard checks, production route smoke tests | NFR-01–NFR-04, scope |

## 6. Implementation approach

Keep React, TypeScript and the current route structure. Refactor large pages incrementally while implementing each behavior; avoid a wholesale rewrite.

Introduce focused modules for lifecycle transitions, scheduling/reservations, geographic validation, audit/notifications and identity/permissions. UI components call domain actions rather than mutating state directly. Place persistence behind a repository interface so fixture/local and shared API adapters use the same contracts.

Treat a booking action, reservation changes, audit event and notification event as one logical commit. For the integrated pilot, enforce that commit on the server with concurrency control and idempotent notification handling. Reading the latest localStorage value is useful for demos but is not a transaction.

Keep infrastructure tasks subordinate to reference behavior. Add backend integrations when entering the shared pilot milestone, without delaying domain tests or four-actor workflow refinement.

## 7. Inputs and decisions still needed

These do not block fixture-based domain and interaction work. They do block claims of verified municipal operation.

| Input/decision | Why needed | Interim prototype treatment |
| --- | --- | --- |
| Authoritative 12-village boundary, depot and supported hospital coordinates | FR-01/FR-02; VR-02/VR-03 | Clearly labeled geographic fixtures; never claim real eligibility |
| Municipal telephone contact | Consent refusal and lead-time fallback | Visible placeholder in development; verified contact before participant publication |
| Operating-hours interpretation and shift/duty rules | Admin settings, driver access and feasible scheduling | Display fixture hours; document proposed checks; do not invent a rejection policy |
| Duplicate thresholds, verification attempts/deadlines and abuse handling | Actor specification explicitly leaves these unconfirmed | Overlap warnings only; dispatcher decides; no invented automatic rejection |
| 30-minute turnaround adequacy and physical readiness after failed pickup | System-logic technical validation notes | Retain reference formula; separate reservation release from physical availability |
| Transfer logistics after depot departure and before pickup | Reassignment is allowed but physical handling is unspecified | Demonstrate confirmed reassignment rules with fictional scenarios; record unresolved operational detail |
| ASSIGNED dispatch timing | Conflicting lifecycle descriptions | Immediate manifest dispatch in prototype, documented assumption |
| Retention period, purge cycle and historical driver access | NFR-04 lacks exact duration/shift policy | Demonstrate minimization/purge, restrict historical coordinates, record unresolved policy |
| Routing host/API approval, LINE credentials and staff identity provider | Reference integrations and PII isolation rule | Adapters with deterministic fixtures; no unreviewed routing requests with real pickup data |
| Single-browser evaluation versus coordinated devices; hosting destination | Determines persistence and deployment work | Single-browser simulation first; backend required for coordinated devices |

Recommended first implementation batch: Phase 0 followed by Phase 1. That corrects the lifecycle and scheduling contracts before adding cancellation, reassignment or recalculation screens that depend on them.
