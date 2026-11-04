# Session handoff — 2026-11-04

Read this latest section first. Earlier map/navigation handoff is preserved below.

## Current workspace and user preferences

- React 19 + Vite + TypeScript, Thai product UI. Workspace: `C:\Users\User\Desktop\banklang-transit-prototype`.
- User explicitly wants assistant replies in concise English, caveman style. Keep product labels in Thai.
- Changes are saved locally but remain uncommitted. No commit, push, or deployment performed. Preserve all existing changes, including those present before this session.
- Pre-existing modified files included `BookingSummaryCard.tsx`, `PickupMap.tsx`, `PlaceSearch.tsx`, `BookingPage.tsx`, and `figma-alignment.css`. Do not revert them wholesale.
- User is exiting Codex and requested this handoff. No further feature request is pending.

## Dispatcher changes and final decisions

- Tracking defaults to **ทั้งหมด**, with only **ทั้งหมด / วันนี้** scope buttons. The earlier **วันถัดไป** button was removed at user request.
- All-jobs view puts today's jobs first using Bangkok dates. Within each day: in transit, assigned, completed, cancelled; then pickup time ascending. Other dates sort ascending. Date/search/status filters remain available.
- Removed the separate `dispatch-tracking-day` banner. Today's date is inside the **งานทั้งหมดวันนี้** metric card.
- Tracking rows include patient name and pickup date/time. Cancelled status badge is red.
- Dashboard request queue sorts appointment date/time ascending, independent of pending/approved status.
- Shared table header corners now fit rounded borders; header text can wrap.
- Fixed mobile assignment navbar height: it was ~145px versus 98px on other empty pages. `.dispatch-shell { grid-template-rows:auto 1fr; }` at mobile widths prevents spare page height stretching the navbar.
- Dispatcher links use consistent active/hover colors and font weight across routes and mobile drawer.

## Driver changes and final decisions

- One active trip per driver. `advanceDriverTrip` checks latest shared state inside `demoStore.update` and rejects starting another job while that driver has an `in_transit` job.
- Details start button is disabled when another job is active, with explanation/link to current job. Stale confirmation dialogs also disable confirmation if another tab starts a job. Finishing current trip releases the next start. Different drivers remain independent.
- Current status card shows **planned departure → appointment time**, using `schedule.departureAt` and `appointmentAt`. These are planned times, not actual departure timestamps.
- **ดูรายละเอียดงาน** is now a full-width outlined button with bold text and hover/pressed/focus states.
- Job details has **← กลับหน้าก่อนหน้า**. Entry points pass original path/query through router state; back link returns there, including after reload. Direct entry falls back to `/driver`.
- Full **ตารางที่ได้รับมอบหมาย** appears only on job details, not status. Status retains the time arrow and failed-pickup reporting action.
- Reduced leftover status-page margins and mobile bottom padding after removing the schedule. Mobile fixed action bar retains clearance.
- History cards show one status badge at top, without duplicate completed/cancelled badges. Cancellation reason remains plain text when available.
- Final user decision: history **job numbers match status color**: cancelled red, completed green. Cancelled status is also red. (An earlier clarification briefly left numbers normal; the later explicit request supersedes it.)

## Shared navigation and citizen list styling

- All navbar roles (dispatcher, driver, admin) use larger borderless hamburger and close controls: 36px icons within 56px controls.
- Hamburger and drawer-close buttons have translucent hover/pressed backgrounds and slight pressed scaling. Keyboard focus remains visible.
- Soft shadows on desktop sidebars, mobile headers, and navigation drawers.
- Citizen booking list left bars track status colors and are 5px wide.
- Latest styling makes pending **รออนุมัติ** visibly different from cancelled: golden-yellow bar `#e5b800`, pale-yellow badge `#fff7cc`, dark olive/gold text `#705400`. Cancelled remains red.
- `--booking-state-accent` separates bright border accent from readable badge text. Hover preserves the status-colored left bar.

## Files to inspect

- `src/pages/DispatcherPage.tsx`, `src/dispatcher.css`: queue/tracking behavior and styling.
- `src/services/driver.ts`, `src/pages/DriverPage.tsx`, `src/driver-refinements.css`: trip guard, status/details/history changes.
- `src/figma-alignment.css`: shared navbar/table styling and citizen status colors. Multiple older stylesheet layers exist; check specificity and import order before changing rules.
- `tests/tracking.spec.ts` (new): tracking defaults, Bangkok today priority, filtering, cancelled badge colors, header containment, responsive overflow, dashboard ascending order.
- `tests/navbar-check.spec.ts` (new): dispatcher layout consistency, active styles, collapsed/mobile navigation, equal mobile navbar heights.
- `tests/driver.spec.ts`: added active-trip/cross-tab guard, status time range/mobile containment, and details return-navigation checks.
- `tests/dispatcher.spec.ts`: existing flow explicitly selects **ทั้งหมด** before searching future jobs.

## Verification and limits

- Production build passed earlier during initial tracking implementation, with the existing large lazy MapLibre chunk warning. It was **not rerun after subsequent changes**.
- Typecheck and lint passed repeatedly during implementation. Latest typecheck was after the first citizen pending-color change; the final pending accent adjustment was CSS-only and not separately tested.
- Driver focused runs passed: one active trip/stale confirmation/service rejection, start after completion, time arrow at 320px, details return after reload, and existing work-status progression.
- Navbar consistency tests passed after the mobile height fix. All 8 existing navigation tests passed after hamburger sizing. All 3 role mobile navigation tests passed after close-button sizing and again after hover/pressed feedback.
- Tracking/dashboard focused tests passed earlier. Desktop tracking and mobile screenshots were inspected during earlier tracking/header work.
- Later history badge/ID styling, duplicate badge removal, navbar shadow, and latest citizen color tweaks have not received a final combined browser/visual pass. Do not claim the full suite passed on the final tree.
- The entire browser suite was not run this session. Existing earlier test results below are historical, not final-state verification.
- Browser/Vite commands needed sandbox escalation for filesystem access. `npm.cmd` avoids the PowerShell npm wrapper permission noise. Windows shell is PowerShell; Python is unavailable, Node is available.

## Suggested next session

1. Read this file and inspect `git status`/diff before editing.
2. If continuing validation, run `npm.cmd run build`, `npm.cmd run lint`, and relevant Playwright specs (navigation/navbar-check/tracking/driver), with required sandbox approval.
3. Visually review citizen pending versus cancelled cards and driver history/status on mobile and desktop.
4. Review and commit changes only when user asks. No commit has been made.

---

# Earlier session handoff — 2026-10-30

## Project and working state

Ban Klang patient transit prototype, React 19 + Vite + TypeScript. Workspace: `C:\Users\User\Desktop\banklang-transit-prototype`. Start locally with `npm run dev`.

The workspace already had many modified/untracked files before this session. Preserve that work. No commit or deployment was performed in this session. Browser demo bookings live in localStorage; driver identity lives in sessionStorage. There is no production authentication. DriverPage defaults to the first demo driver (Driver A) when no session identity exists, and filters jobs by assigned driver ID.

## Completed in this conversation

- Replaced the always-failing current-location button with browser geolocation, permission/error handling, loading state, and persistence of latitude/longitude/accuracy with pickup details.
- Replaced the demo pickup slider with MapLibre GL JS and OpenStreetMap raster tiles. Users can drag/tap the map, use arrow keys/Enter, request GPS, enter coordinates manually, and confirm a pickup. Landmark/address input stays separate.
- Added place recommendations as users type: Photon search after 2 characters and 450ms debounce, cancellation, cache, timeout, keyboard selection, Escape, and IME composition support.
- Thai queries are supported; search sends `countrycode=TH` and `lang=default` for local Thai place names. Verified live that the public Photon provider rejects `lang=th` and supports only default/de/en/fr; local-name mode returned จังหวัดลำพูน for Lamphun. Thai labels still depend on source data.
- Added the driver's pickup preview and Google Maps navigation URL. Added optional GPS origin selection, invalid-coordinate handling, denied-permission fallback, and a normal same-tab link for handoff. The app displays a pickup map, not an in-app road route; Google Maps provides directions.
- Fixed sticky map errors: successful tiles clear the error, Retry recreates the map while preserving the camera, ResizeObserver handles dialog sizing, and driver-specific messages link to Google Maps rather than suggesting unavailable coordinate fields.
- Map engine is lazy loaded so the initial app bundle does not include MapLibre.

## Key files

- `src/pages/BookingPage.tsx`: booking GPS and pickup confirmation.
- `src/services/booking.ts`: pickup coordinate fields.
- `src/components/LocationMap.tsx`: lazy map wrapper.
- `src/components/PickupMap.tsx` and `pickup-map.css`: interactive map and recovery.
- `src/components/PlaceSearch.tsx`: automatic Thai/local place suggestions.
- `src/components/DriverNavigation.tsx`: optional driver GPS origin and Google Maps link.
- `src/pages/DriverPage.tsx`: assigned-driver view and pickup modal.
- `src/vite-env.d.ts`: Vite environment types.
- `tests/booking.spec.ts`, `tests/driver.spec.ts`: search, GPS, coordinate persistence, map recovery, navigation handoff coverage. Related accessibility/interface/dispatcher tests now use the map region instead of the old slider.
- `docs/MAPS.md`: provider configuration and limits.

## Verification

- Build, lint, and typecheck passed during the work. The latest navigation changes passed lint and typecheck; the most recent production build preceded those final changes.
- An earlier broader run passed 50 browser tests across booking, driver, dispatcher, accessibility, and interface specs. This was before the subsequent search/Thai/navigation refinements; do not present it as a full-suite check of the final state.
- Later focused search checks passed, including Thai/local-name request parameters.
- Latest focused driver run passed 3 tests: the shared booking/assignment/trip journey and two map-error recovery tests. The latter also cover GPS origin, denied permission, URL coordinates, and browser navigation handoff with intercepted Google Maps responses. They do not prove native turn-by-turn navigation on the user's phone.
- Viewed a mobile screenshot with actual OpenStreetMap tiles successfully rendered. Public provider/network behavior on the user's device is not established.

## Latest user clarification and next steps

The user reported Google Maps could not navigate, then clarified: **"oh, I am at the same location"**. Explained that being at the pickup point may produce an arrival indication instead of a travel route. Test a destination farther away next time. Do not assume an unresolved routing bug or promise native navigation has been verified.

The user is closing their laptop and asked how a later session will know what was done. This file is the portable handoff; a fresh chat should read it and inspect current files before continuing.

## Remaining limits

Public OSM tiles and Photon demo search are prototype services; use suitable hosted/self-managed providers for wider rollout. GPS needs HTTPS or localhost and permission. Legacy pickups without coordinates cannot be navigated to reliably and show a contact-booker message. Vite builds warn about the large lazy MapLibre chunk; initial app bundle remains separate. No API keys were added.
