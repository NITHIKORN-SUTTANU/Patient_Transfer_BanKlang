# Interface refinement review

28 October 2026. Implemented with the `ui-design` skill, retaining React, TypeScript, Vite, React Router and Thai content. No external design inspiration or Figma access was used.

## Direction

Calm municipal service for elderly citizens and caregivers. Deep green identifies service actions; warm red identifies emergency access; white surfaces and dark text prioritize reading. The signature is a numbered three-step journey. A centered single-column booking workspace keeps attention on the current task on both mobile and desktop. Interaction feedback is brief and respects reduced-motion preferences.

## Simplification pass

Following a second UX review, removed the desktop service-guide rail, home-screen step preview, repeated municipal heading, duplicate manual pickup button/preview, consent shield panel, three separate consent information cards, and repeated submission confirmation panel. The real step indicator, review details, consent/refusal, emergency access, validation and saved trip milestones remain.

The time picker now has only labeled hour/minute selectors; removed the duplicate wheel controls and their styling. The admin dashboard uses direct action buttons instead of a wide navigation table, and the repeated fixed-rule banner was removed while retaining the fixed-rule tab and values. Removed admin password/confirmation fields and their validation because these values never authenticated users or persisted credentials. Account name, username, role, active state, uniqueness validation and auditing are preserved. Removed redundant driver status/empty-state copy and dispatcher implementation notes. No authentication or security feature was removed; real authentication remains unimplemented.

This pass additionally changed `src/components/AdminForms.tsx`, `src/pages/DriverPage.tsx` and `tests/admin.spec.ts`. Updated the account test to verify duplicate-username rejection and preservation of entered values without collecting unused passwords. No external inspiration was used.

Validation after these cuts: production build and lint passed; **46 browser tests passed in 55.1 seconds**. Reviewed the simplified booking desktop, consent mobile and admin mobile screenshots.

## Implemented

- Citizen layout responds to available space rather than staying in a fixed 390px mockup. Removed decorative screen backgrounds, duplicate guidance and forced per-screen minimum heights; retained useful local icons.
- Visible booking steps identify the current step with text, numbers, and `aria-current`, rather than color alone.
- Citizen text is at least 16px. Main buttons, inputs and selectors have generous dimensions; enabled interaction targets in the tested booking surfaces are measured against 48×48px. Checkbox labels supply the full interaction target.
- Calendar uses a compact four-column date layout below 428px so dates can remain at least 48px wide. Each compact date includes its weekday; accessible full-date names remain unchanged. Wider calendars retain seven weekday columns.
- Time selectors are visibly available instead of transparent overlaid controls. Calendar/time dialogs retain Escape dismissal and focus restoration. Shared dialogs now have unique accessible title IDs.
- Booking has a non-emergency notice throughout, a persistent emergency call link (bottom on phones, service bar on larger screens), and a call link inside citizen dialogs.
- Consent states the permitted purpose and excludes clinical information. Explicit refusal blocks intake and explains the municipal contact alternative. The missing verified municipal telephone number is disclosed rather than invented.
- Review text distinguishes sending a request from having a confirmed vehicle. Location text explicitly describes the current map/GPS simulation.
- Citizen progress now derives from stored assignment and driver milestones, distinguishing approval without scheduling, assignment, going to pickup, patient aboard and travel to hospital. Event timestamps are shown only when actually saved.
- Dispatcher, driver and admin screens share the readable text scale, larger controls, clearer active navigation, stronger muted-text contrast and consistent panel treatments. Staff tables remain horizontally scrollable on phones with visible instructions; dispatcher table regions are keyboard focusable.

## Reference traceability

| Reference | Refinement |
| --- | --- |
| NFR-03 | 16px text, measured touch targets, focus styling, reflow and primary contrast checks |
| NFR-01 | Clear three-step journey, preserved section editing, visible next actions; human timing/completion evaluation still required |
| NFR-04 and its consent/emergency sections | Explicit consent/refusal, clinical-data exclusion, persistent 1669 access and truthful prototype storage notice |
| Citizen flow; UC-01–UC-06 | Booking/review/status clarity and preserved navigation/data entry |
| FR-05; driver flow; UC-20 | Citizen display follows the existing saved execution milestones; this does not introduce the planned canonical state-machine migration |
| FR-06 | Clear confirmation/update presentation; actual LINE delivery remains unimplemented |
| Staff actor flows and screen inventory | Navigation, forms, daily-work presentation and table usability |
| Prototype refinement plan, phases 2 and 6 | Citizen interface improvements and measured browser checks |

## Validation

- Production build and ESLint passed after the final application edits.
- Final full browser run: **46 passed** (53.7 seconds).
- Existing browser regression suite plus five new interface tests cover the self/caregiver journey, errors, date/time boundaries, keyboard behavior, storage, cross-tab updates and staff workflows.
- New citizen measurements cover entry, consent, patient form/errors, date/time dialogs, assistance, simulated pin, review, submission, status and booking list at 320, 390, 768 and 1440px.
- New status test checks that approval is not presented as confirmed pickup and that the displayed current milestone matches each saved driver update.
- Existing staff responsive checks cover widths from 320 to 1920px. Screenshots were visually reviewed for citizen mobile/desktop, compact calendar, dispatcher desktop, driver mobile and admin mobile/desktop.
- Production preview smoke check passed on `/booking`, `/dispatcher`, `/driver`, `/admin` at 320, 390, 768 and 1440px, with no browser page errors or document-level horizontal overflow.
- Measured primary color pairs: body 14.59:1; muted text 6.49:1; primary button 7.64:1; information panel 7.86:1; notice 6.49:1; emergency button 7.88:1; safety notice 8.30:1. These are selected palette checks, not a complete WCAG certification.

Screenshots are generated under ignored `test-results/`, including `production-booking-390.png`, `production-booking-1440.png`, `refined-calendar-320.png` and `refined-review-1440.png`. Run `npm run dev` to review the source application or `npm run build` followed by `npm run preview` to review the production artifact.

## Files changed in this refinement

- `src/pages/BookingPage.tsx`: citizen presentation, consent/refusal, service guide, emergency shell and status clarity.
- `src/components/BookingTripTimeline.tsx`: shared-state-derived citizen timeline.
- `src/components/BookingUI.tsx`: labeled steps, unique dialog title IDs, emergency access within citizen dialogs.
- `src/components/AppointmentPicker.tsx`: compact-calendar weekday labels and in-dialog emergency link.
- `src/interface-refinements.css`, `src/main.tsx`: responsive shared presentation and stylesheet registration.
- `src/booking.css`, `src/dispatcher.css`, `src/driver.css`, `src/admin.css`: readable text scale and removal of obsolete citizen progress/min-height rules.
- `src/pages/DispatcherPage.tsx`, `src/pages/AdminPage.tsx`: table scrolling instructions and keyboard-accessible regions.
- `tests/interface.spec.ts`: measured citizen surfaces and saved milestone display.
- `tests/dispatcher.spec.ts`: assert the accessible dialog name rather than a fixed internal ID.
- `docs/UI-REFINEMENT-REVIEW.md`: direction, traceability, evidence and limits.

## Remaining work

This interface pass does not complete all phases of the refinement plan. Canonical eight-stage storage, Start Trip, cancellation/failed pickup/reassignment, automated routing and recommendations, real GPS/boundary checks, settings recalculation, administrative safeguards, authenticated ownership/RBAC, shared backend and real LINE notifications remain separate implementation work. No secure access-control or real municipal-operation claim is made.

The verified municipal contact number and operating data are still needed. Human screen-reader assessment, complete accessibility auditing and the ten-participant timed usability study remain outstanding. Nothing has been publicly deployed.
