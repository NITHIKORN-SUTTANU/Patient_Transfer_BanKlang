# UI Baseline — Commit bf95b2e

The user requires the UI to match the last commit, `bf95b2e` (`feat: adjust admin layout spacing and add tests for sidebar behavior across screen widths`).

## Current application

- The original citizen own-booking list adds only a Thai load-more button and a loaded-record count/notice while more pages exist. It retains the existing summary cards, status/cancellation routes, refresh/error controls and layout. Direct details are revalidated, and their presence never expands the list count outside its loaded range.

- Original dispatcher and driver views add only small load-more controls for scoped operational lists/history and a partial-range notice. Existing counts and filters describe loaded records; refresh rebuilds the loaded range. Page layouts and operational dialogs are retained.

- Capacity investigation adds only an explicit rejection category and small alternatives/explanation controls inside the original rejection dialog. Staff can add vehicle/driver/origin options, check current routes/constraints and inspect results before capacity rejection. The server rechecks at confirmation; failures retain entered reasons/choices. Existing dispatcher review details show linked historical decision evidence. Other screens/layouts remain in place.

- Existing dispatcher detail dialogs now include a small review section with explicit duplicate/history loading, optional call outcome/operational notes, append-only correction and earlier-history controls. It reuses existing form/button styling. Warnings link to authorized details and never change booking state; no citizen/admin lookup or replacement review screen is added. Pending saves block dismissal and decision changes.

- The committed UI is the final design. Small changes may add missing SRS controls, as confirmed by the project owner.
- Existing layouts, navigation styling, typography, spacing, cards and responsive behavior are preserved. Routes now include staff login and a dispatcher authentication guard.
- The abandoned replacement frontend and its styles have been removed. No alternate workspace UI is mounted.
- Dispatcher screens use authenticated API reads, review commands, scheduling and assignment. Citizen core screens use LIFF/API identity, current consent, profiles, intake and own status/cancellation. Admin account/resource/window management uses verified identity/API writes; settings add hospital/village/depot/closure controls within the existing tables and modals. An environment flag does not switch users to another design.
- Dispatcher tracking dialogs also provide pre-pickup modification, incidents, ABORTED disposition and safe corrections. Onboard phases also offer separate destination preview/confirmation with current coordinates, physical confirmation and reason; compact summaries distinguish revised estimates from the original hospital/arrival target. A collapsible panel confirms held-resource readiness and actual location. These small additions reuse existing form, panel and dialog styling; mobile containment and accessibility are checked.
- Driver screens retain their existing layout and now use verified sessions, scoped assignments and server commands. Start Trip and departure are separate controls, and finished history omits patient/contact/location details. Driver routes require the driver role; existing navigation and mobile accessibility checks pass.
- Citizen screens retain their layout with small service-village/address/landmark, saved-profile and manual-coordinate controls. The notice/version comes from the API, emergency/municipal links remain available, and failures preserve the draft. There is no production demo identity fallback. Live LINE/rich-menu/device evidence remains separate from synthetic-provider verification.
- Dispatcher/admin pages add a compact collapsible delivery-failure panel within the existing layout. Dispatcher review includes scoped event/recipient references; the admin technical panel omits patient/booking references. Named claims and review notes record human next actions without marking delivery successful or offering resend.
- A second compact dispatcher work-alert panel lists committed request/operational events with authenticated links and per-user web acknowledgement. It reuses existing panel/button styling. Dispatcher links load a focused booking beyond the initial list window; they do not replace the existing screens or bypass role checks.
- Backend, PostgreSQL migrations, production domain logic, LINE verification, notification worker, and synthetic API tests are preserved.
- Admin screens retain their sidebar, tables and modal styling. Account forms add password/reason inputs and pending/confirmation states. Resource forms add controlled capabilities, verified initial state and a small working-window editor while preserving existing tables and modal styling. The prototype patient-bearing admin history is replaced by an aggregate table to enforce the SRS permission matrix. The role-selection shortcut now opens the authenticated staff account screen.

## Implementation rule

Connect API and authentication through the original screens and service boundaries. Preserve their layout, navigation, typography, spacing, dialogs, and shared components. Add only controls genuinely required by confirmed business rules; do not replace the established screens with alternate workspace layouts.

The replacement frontend, its skipped browser journey, and the unused LIFF SDK dependency were removed during cleanup. Add an API/session adapter within the established service structure when implementing `../plans/INTEGRATION-PLAN.md`; do not reintroduce replacement workspace pages.

## Testing

- `npm run dev`: open the Vite URL. Dispatcher use requires the API and a configured dispatcher account; start at `/staff/login`. See `../guides/API.md`. Other prototype flows do not require LINE credentials yet.
- `npm run test:ui`: staff-login/dispatcher API-interception tests and existing navigation/accessibility regression checks at desktop/mobile widths.
- `npm run test:api`, `npm run test:domain`, `npm run test:database`, and `npm run test:line`: preserved backend/domain verification, independent of the UI.

Do not claim full integration. Current dispatcher browser tests intercept API responses; original-screen journeys against real PostgreSQL remain pending, alongside the other actors and advanced dispatcher operations.
# Daily manifest addition

Monthly reporting adds one compact collapsed panel to original dispatcher tracking and admin history, using existing field/button/panel styles. It offers an appointment-month input and one three-sheet Excel download. It explains the full request cohort, aggregate privacy and completion-rate denominator; table filters do not affect exports. Pending submissions are locked and failed downloads retain the month. No screens or navigation are replaced.

The existing dispatcher tracking screen includes one collapsed daily-export panel with a Bangkok appointment-date input and Excel/PDF download buttons. It preserves the current screen design, waits for committed API downloads, locks repeated submission while pending and retains the selected date after failure. Its cohort is independent of the table filters and explicitly described to staff. Patient-bearing daily exports are dispatcher-only; the admin page does not expose these controls.

