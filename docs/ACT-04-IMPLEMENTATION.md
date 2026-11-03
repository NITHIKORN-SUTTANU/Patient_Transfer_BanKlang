# ACT-04 Admin implementation

Implemented in the existing React 19 + TypeScript + Vite application. Entry point: select ACT-04 on the role screen, then choose **เข้าสู่หน้าผู้ดูแลระบบ**, or open `/admin`.

## Figma inspection and mapping

Source: https://www.figma.com/design/umrYKEkwmIdLAq1g1IdLjV?node-id=117-216

Inspected the complete ACT-04 page metadata, high-fidelity design context and screenshots for every main frame and form frame before implementation. A read-only Figma Plugin API inspection found no wired prototype reactions or component sets on this page. No additional dropdown-option or validation-state frames were present in the ACT-04 page. The page node itself cannot be rendered by design-context; its individual frames were successfully inspected instead.

| Screen / form | Figma node | Implementation |
| --- | --- | --- |
| A-01 System Dashboard | `117:217` | `/admin` |
| A-02 Accounts and permissions | `117:243` | `/admin/accounts` |
| A-02A Add account | `225:20` | Add account dialog |
| A-02B Edit / suspend account | `225:40` | Manage account dialog and suspension confirmation |
| A-03 Vehicles | `117:269` | `/admin/vehicles` |
| A-03A Add / edit vehicle | `225:60` | Vehicle editor |
| A-03B Deactivate vehicle | `225:80` | Reason, status and affected bookings confirmation |
| A-04 Drivers | `199:24` | `/admin/drivers`, accessible through resource tabs |
| A-04A Add / edit driver | `225:100` | Driver editor with Driver-role account link |
| A-04B Suspend driver | `225:120` | Reason, status and affected bookings confirmation |
| A-05 Trip History | `230:2` | `/admin/history` |
| A-06 System Settings | `117:295` | `/admin/settings` |
| A-06A Edit settings | `225:140` | Settings dialog |
| A-07 Audit Log | `199:64` | `/admin/audit` |

Reused Noto Sans Thai, project palette tokens, `BookingButton`, and the native-dialog `BookingModal`. Admin CSS is scoped to Admin classes. The source frames contain text and geometric UI elements, with no static raster/SVG assets requiring downloads. The implementation preserves the 250px desktop sidebar, teal/pale-green palette, active navigation, summary cards, resource/settings tabs, tables and form treatment. Summary numbers use actual shared records rather than Figma's illustrative counts. Additional booking totals satisfy the requested shared-data dashboard summaries. Driver rows have explicit management buttons to make the supplied edit/suspend forms accessible.

## Implemented behavior

- Dashboard: actual account, vehicle, driver and booking counts; pending/unscheduled and completed totals; resource summaries and working category shortcuts.
- Accounts: name/username search, role and status filters, add/edit, duplicate username validation, role descriptions, suspension confirmation, reactivation. Password confirmation and visibility controls work; prototype passwords are never persisted.
- Vehicles: shared vehicle list, search/status filters, resource tabs, add/edit label or registration, type and support, deactivation confirmation with a reason and related bookings, reactivation.
- Drivers: shared driver list, search/status filters, add/edit name, phone, linked Driver-role account and availability; suspension with reason and related bookings; reactivation. A linked account can belong to only one driver. Changing a linked account away from Driver is blocked until the link is changed.
- Trip History: shared bookings, including older records without optional details; search, inclusive Bangkok appointment-date range, vehicle/driver/status filters, filter reset and details. Missing resource IDs remain visible and filterable. Completed Driver trips appear automatically.
- Settings: center label, service-area label and opening/closing times persist. Fixed-rules tab and read-only 48-hour/20-minute display. No changes to scheduling calculations or booking eligibility rules.
- Audit: persistent timestamp, fictional Admin actor, action, category, record ID, reason and before/after values; search/category filters and detail dialog. Failed validation and cancelled changes do not create success events.
- Dialogs: save, cancel, close, Escape, focus trapping and return to trigger; native validation, inline business errors and storage-unavailable warning.
- Stale edits: save compares the opened record with the latest persisted record and rejects an intervening edit instead of silently overwriting it.

## Shared data model and compatibility

The existing `ban-klang-transit:demo:v1` key, `DemoState.version = 1`, store subscription, storage event listener and latest-storage-before-write logic remain in use. No second booking/resource dataset or backend was created.

Optional additions:

- `accounts`: `{ id, name, username, role: Dispatcher | Driver | Admin, active }`.
- `settings`: `{ center, serviceArea, opensAt, closesAt }`.
- `auditEvents`: `{ id, at, actor, category, action, recordId, reason?, before?, after }`.
- Vehicle: optional `vehicleType`, `support`; existing `id`, `label`, `active` unchanged.
- Driver: optional `accountId`, `phone`; existing `id`, `name`, `active` unchanged.

On first Admin visit, the existing resource initializer is reused; existing resource arrays are preserved. Fictional accounts are created, and existing driver IDs receive optional account links. Existing booking IDs, assignments, schedules, details, statuses and progress are retained unchanged. Older states without Admin fields remain valid. Status-only deactivation/reactivation supports legacy resources without requiring newly introduced metadata.

`driverAvailable` combines driver availability with linked account activity and Driver role. Unlinked legacy drivers retain their previous availability semantics. Dispatcher pickers, assignment validation, Driver identity selection and Driver progress commits use the same predicate. Vehicle activity continues to use the existing assignment guard. No scheduling arithmetic changed.

Admin changes and their audit event are saved together in one state update. Storage events update other open tabs. Sequential edits re-read localStorage even before its notification arrives. Truly simultaneous writes across processes are still subject to localStorage's last-writer behavior; this prototype does not provide database transactions.

## Integration verification

Automated Admin tests cover creating/editing resources, observing them in another Dispatcher tab, assigning them, selecting the updated driver, suspending resources, disabled assignment options, preserving booking records, reactivating the driver and completing the existing trip, shared completed history, persisted audit entries, password/duplicate validation, account role changes, linked-account suspension, stale-edit rejection and persisted settings.

Existing regression tests cover the complete ACT-01 → ACT-02 → ACT-03 UI journey, cross-tab patient/driver updates, refresh persistence, vehicle and driver conflicts, adjacent nonoverlapping windows, rechecking resources at final assignment, malformed storage recovery and fixed booking rules. In particular:

- Lead time remains **48 hours**, checked against submission time and again at submission.
- Preparation/safety buffer remains **20 minutes**; stored schedules retain `preparationMinutes: 20`.
- Vehicle/driver overlaps remain checked using the existing scheduling interval.
- Disabling resources never removes a booking or assignment.

## Responsive verification

The nine automated viewport cases each visit all seven Admin screens, check for page overflow, open/cancel add/edit/settings dialogs and inspect dialog bounds. Account, vehicle and driver suspension confirmations are also checked at each width. Mobile navigation opens, navigates and closes correctly. Runtime page errors are asserted absent.

| Class | Widths | Result |
| --- | --- | --- |
| Mobile | 320, 375, 390, 430 px | Passed |
| Tablet | 768, 1024 px | Passed |
| Desktop | 1280, 1440, 1920 px | Passed |

Layouts adapt through a collapsible mobile header/navigation, stacked actions, one/two-column forms and filters, compact metric cards and keyboard-focusable contained table scrolling. Desktop table geometry and sidebar follow the reference; narrow tables scroll inside their card. No global responsive refactoring of ACT-01, ACT-02 or ACT-03 was performed.

Screenshots are generated under `test-results/admin-<screen>-<width>.png` and `test-results/admin-<resource>-confirm-<width>.png`. Desktop dashboard and mobile vehicle/confirmation screenshots were visually inspected against Figma. These are local test artifacts, not deployed assets.

## Build, lint and Playwright

- `npm run build`: passed (TypeScript and Vite production build).
- `npm run lint`: passed.
- Final `npm run test:e2e`: **41 passed (50.5 seconds)** in Chromium, including 11 Admin cases and all 30 existing regression cases.

The sandbox initially prevented Vite from traversing its configuration directory; build and browser tests were rerun with approved escalation. A regression exposed a shared native-dialog timing race during rapid Escape dismissal. `BookingModal` now opens/closes in `useLayoutEffect` so setup occurs before paint; its UI and business behavior are unchanged. The existing patient asset assertion was changed to show invalid asset geometry when it fails, without relaxing its requirements.

## Known limitations and unresolved requirements

1. **Active assignments after deactivation:** source designs request impact review but do not define cancellation, reassignment or operational handover. This prototype blocks new assignments, preserves all existing work, and lists/warns about unfinished assignments before confirmation. An inactive vehicle does not automatically stop its existing driver's status updates. A suspended driver or linked account cannot access/update their work until reactivated. No bookings are silently cancelled or reassigned. Operational handling requires a future policy decision.
2. **Settings catalogs:** Figma shows center, service-area and hours selectors without option catalogs. Center/area labels therefore use editable text, and hours use native time inputs. Initial values are explicitly fictional demo defaults. They do not introduce routing, GPS, service-boundary validation or additional scheduling restrictions. Approved dropdown options and any intended effect on booking hours remain unspecified.
3. **History statuses:** the shared schema supports pending, approved, rejected, in-transit and completed. The Figma illustration includes cancelled/unsuccessful examples, but no corresponding workflow exists in the current store. Actual shared statuses are shown; no new cancellation workflow was invented.
4. **Permissions/authentication:** role assignments and linked Driver availability are simulated locally. Routes remain demonstration entry points. No backend, authentication, credential storage, login events, production permission enforcement or real patient information is implemented. Figma's first-login password-change message is not claimed as an implemented authentication workflow.
5. **Audit scope:** meaningful Admin data changes are logged. Existing booking/dispatch/driver actions and fictional login history are not retroactively fabricated. Audit records are editable through browser storage and are not a production security log.
6. **Design coverage:** the ACT-04 page supplies desktop frames and static form designs, without responsive references, reaction wiring or exhaustive error states. Mobile/tablet adaptation and validation follow the existing project conventions. Trip/audit detail dialogs expose the requested existing records using the same dialog styling.

No deployment or GitHub push was performed.
