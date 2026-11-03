# Product design for professor testing

The implementation follows [the Figma file](https://www.figma.com/design/umrYKEkwmIdLAq1g1IdLjV). The active visual layer is `src/figma-alignment.css`, together with the existing role stylesheets and shared Figma tokens in `src/styles.css`. The earlier independent blue redesign stylesheet is no longer imported.

## Supported viewport

The minimum supported screen width is **320 CSS pixels**. Larger layouts scale from this baseline. Main role screens, citizen pickers, staff dialogs, cancellation, failed pickup, and schedule review are exercised at 320px. All 10 selected minimum-width/accessibility checks passed, including enlarged text and text spacing.

Horizontal scrolling is not part of the interface. Shared tables use fixed desktop columns with wrapping content and switch to labeled record cards when their available container width is 760px or less, including staff workspaces with sidebars. Table wrappers do not create scroll areas. A regression check covers all 20 routes at 320, 375, 640, 768, 1024, 1280, and 1440px, checking both page width and nested horizontal scrollers. All nine accessibility/layout checks, build, and lint passed after this change.

## Visual foundation

- Primary teal #075e57, mint #ecf9f5, canvas #f6faf9, ink #132d2c; Noto Sans Thai.
- Citizen screens prioritize phones with one task per step, original local SVGs, readable Thai text, large primary actions and the three-step introduction. On larger screens the booking form expands to a focused 640px reading width, with no device outline or frame shadow.
- Dispatcher and admin use full-width web workspaces with desktop sidebars, metrics and tables. At smaller available widths, tables become labeled records and navigation adapts to the screen. Dialogs return to their role-appropriate responsive widths. The shared 390px simulated-device frame has been removed.
- Driver screens prioritize phones with a single task column and bottom tabs. At 768px and above they use an up-to-1120px web workspace with top navigation and two task columns. Direct entry defaults to the first test account; no account selector appears in the service flow, and suspension does not select a different account.
- Date and time use the active Figma bottom-sheet designs. The time picker has independently scrollable hour/minute wheels with native touch and mouse scrolling, centered snap selection, tap-to-select, arrow/Home/End/Page keyboard controls, and numeric typeahead. Its rows grow with larger text, and confirmation and the existing 48-hour rule remain intact. Narrow calendars include weekday labels on each date.

## Preserved user instructions

The first page contains role selection. A card enters its workspace in one tap. Staff authentication is bypassed for this demonstration; the Figma authentication screens are not presented as real security.

The plain `ฉุกเฉิน โทร 1669` telephone link appears immediately below the citizen entry header only. It has no icon, banner, or non-emergency travel sentence.

## User-facing service experience

The Figma visual language is retained in React/Vite. Internal ACT codes, development explanations, and repeated demonstration notices have been removed from the task flow. Each role screen has a persistent top-right role-selection icon rendered by the shared `RoleSelectionLink` component. It is a 48px link with the accessible name and tooltip กลับเลือกบทบาท, and remains fixed while scrolling. The former footer link is removed. Header spacing and the mobile admin menu reserve room for it. Testing menus, account selectors, and extra cross-role links have been removed. The role-selection entry page and explicit privacy/testing information remain available.

Pickup selection accepts an optional address or landmark and preserves it when moving the pin or revisiting the screen. The address appears in review and the saved booking. The hospital choice uses the Figma hospital label. Driver contact numbers are telephone links. Operational labels, errors, and saved driver milestones use Thai rather than internal codes or English conflict terminology.

Main changes: `src/components/RoleSelectionLink.tsx`, the four role pages, `DispatchAssignment.tsx`, `AdminForms.tsx`, `ScheduleReview.tsx`, and `figma-alignment.css`. No external component inspiration was used.

After request submission, a shared `BookingSummaryCard` shows the request number, labeled current status, appointment date/time, hospital, patient, pickup address, and next step. The booking list uses a compact semantic link showing only the request number, appointment date, status, and ดูรายละเอียด action. Hospital, appointment time, patient, pickup, and next-step details appear after opening the card on the status/details page. The submission-success card retains its full summary. Status colors supplement the text labels. Approved requests awaiting assignment are distinguished from confirmed pickup times. LINE is a short notification note; the example message, preview control, and modal have been removed. Actual LINE delivery remains unconnected. Build and lint passed; booking, responsive/accessibility, workflow, and visual checks verified the update, including all 19 refreshed dispatcher/driver checks.

## Added Figma exception screens

| Figma frame | Implementation |
| --- | --- |
| C-13 `264:2` | `/booking/cancel/:id`: explicit confirmation, latest-state eligibility checks, persisted cancellation, release of schedule reservations, shared result in staff/driver views |
| R-06 `264:81` | `/driver/failed-pickup?booking=:id`: required reason, identity/stage checks, cancellation before patient pickup, shared result |
| D-04 `264:52` | Assignment conflict dialog: actual conflicting jobs, resource/time correction guidance, repeat check, final commit validation |
| A-06B `264:145` | Admin affected-bookings summary and dispatcher review: active schedule stays unchanged until dispatcher confirms manually reviewed travel estimates |

Citizen cancellation is available before the driver confirms starting and departing for pickup. This prototype combines start and departure into one confirmed action. Failed pickup is available while going to pickup, before confirming the patient onboard. Cancelled assignments remain in history but do not reserve a vehicle or driver.

Geospatial changes flag assigned, unstarted bookings for review. This prototype has no routing service: it explicitly asks the dispatcher to review manual travel estimates, checks conflicts again, and keeps the fixed 20-minute appointment buffer. It does not pretend to recalculate routes from a changed place name.

Responsive role-specific web layouts are implemented in `src/figma-alignment.css`. This supersedes the earlier shared mobile-frame direction. The role-selection page uses a responsive web grid. Role functions, 320px support, no horizontal scrolling, and the persistent top-right role-selection icon remain available. Build, lint, and all 63 browser tests passed after this update.

## Accessibility and validation

Dispatcher, driver, and admin navigation share `ResponsiveNavigation`. Below 768px, an icon-only 48px hamburger opens a modal side drawer from the right. Its backdrop, close button, Escape handling, native focus containment, and body scroll lock keep interaction inside the menu; closing restores focus to the trigger. Mobile header titles and hamburger controls share a horizontal row. At desktop widths, all three roles use a persistent left sidebar. The role-selection shortcut moves to bottom left only on mobile in these workspaces, with bottom content clearance; desktop and citizen screens retain their top-right shortcut.

Dispatcher approval keeps the green primary action. Rejection uses a red outlined entry action and a red confirmation action separated from the safe return action. The confirmation explains that no vehicle will be assigned and that the citizen will see the required reason. Initial keyboard focus goes to the return action; invalid submission focuses the reason field and retains entered text.

Supporting copy is at least 16px; citizen primary buttons remain approximately 59px tall. Low-contrast admin secondary text was darkened within the Figma palette. Keyboard focus, dialog focus restoration, text reflow, enlarged text, reduced motion, accessible names, and control target sizes are checked in Playwright.

The full 65-test suite passed, including accessibility, pickup-address persistence, role-icon navigation, horizontal scrolling, and real mouse-wheel/touch-swipe time selection. The final enlarged-text safeguard was also verified with all three affected time-picker tests. Production build and lint passed. Screenshots for citizen, dispatcher, driver, and admin are generated in `test-results/figma-*.png`.

Automated checks are evidence for the sampled states, not a full WCAG certification. This is a local browser prototype with simulated maps/travel times, no real booking service, and no external LINE notifications.

Dispatcher desktop navigation collapses to an 80px icon rail rather than disappearing. An arrow toggle inside the sidebar changes direction with its state. A temporary municipal building mark remains visible above it; icon links retain accessible names and hover titles. Mobile continues using the right-side drawer.

## Driver mobile refinement

Driver screens keep the existing React app and teal design system. Job cards show an explicit stage, prominent pickup time, patient, pickup and destination. The current trip shows the relevant pickup/hospital location, direct contact and pickup-map actions, and one next-step control in a mobile bottom action area. The action area reserves space for the bottom-left role shortcut. Driver navigation follows the dispatcher: municipal placeholder at top, left desktop sidebar with an 80px icon rail and borderless bottom double chevrons, and an icon-only trigger for the right mobile drawer. Status-change confirmation initially focuses the safe cancel action. The completed/rejected/cancelled service rules and shared state remain intact.

Build and lint pass. All 33 driver/navigation/accessibility/exception browser checks passed; the final sidebar-order and spacing refinements also passed all 10 affected checks. Screenshots include 320px and 1280px layouts. No external component inspiration or new runtime dependency was needed.
