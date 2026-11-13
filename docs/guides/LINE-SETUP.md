# LINE and Production UI Setup

The UI retains the committed design (`bf95b2e`). Citizen screens use the official LIFF SDK and authenticated APIs for consent, saved profiles, intake, own status and cancellation. Dispatcher, driver and admin account/resource/window management also use authenticated APIs; hospital/village/settings administration remains pending. See `../plans/INTEGRATION-PLAN.md` for verification and remaining requirements.

## Use without LINE credentials

Public citizen login remains unavailable until municipality-owned channels are configured. There is no fake citizen-login endpoint or frontend test-mode identity. Synthetic browser tests replace only the external SDK adapter; the real API/database journey injects a synthetic verifier through the server factory.

1. Start PostgreSQL with `npm run db:start` and apply `npm run db:migrate`.
2. Create staff credentials through `npm run db:create-staff`, as described in `API.md`. Synthetic seed users do not have usable default passwords. A driver needs an active roster record and shift windows.
3. Start the API with `npm run dev:api`.
4. Test staff authentication at `/staff/login`, through the API, or with `npm run test:api`. Verified dispatchers can open their original API-backed workspace. The current browser role picker is only a prototype entry, not authenticated access to the database.
5. Run `npm run dev` separately. Vite proxies `/api` to loopback port 3001. Citizen entry at `/booking` loads public configuration, initializes LIFF, exchanges the original ID token, and verifies `/api/auth/me` before loading scoped records. Missing configuration or verification failure blocks booking.

Service failures show retry states without demo fallback. Citizen application sessions stay in memory; reloading exchanges/verifies the LIFF identity again and reloads authoritative bookings. Unsaved form drafts stay in memory during navigation and service errors, but do not survive a document reload. Staff sessions also stay in memory and require login again on reload.

## LINE configuration when channels are ready

Create the municipality-owned LINE Official Account/Messaging API channel and LINE Login channel under the same LINE Developers provider so user identities correspond across services. Configure a LIFF app on the Login channel with the `openid` scope; use `profile` if a display name is needed. No email or clinical permissions are needed.

Set the LIFF endpoint URL to the deployed HTTPS citizen route, such as `https://your-domain/booking`. Configure the actual deployment domain in LINE Developers; do not paste placeholder domains into production configuration.

Set these server-side variables in the ignored local `.env` or production secret/configuration store:

```dotenv
LINE_LOGIN_CHANNEL_ID=your-public-login-channel-id
LINE_LIFF_ID=your-public-liff-id
LINE_CHANNEL_ACCESS_TOKEN=your-private-messaging-token
PRIVACY_NOTICE_VERSION=municipality-approved-version
PRIVACY_NOTICE_TEXT=municipality-approved-Thai-notice
MUNICIPAL_CONTACT_PHONE=approved-service-contact
ALLOW_LINE_DELIVERY=false
```

Keep `LINE_CHANNEL_ACCESS_TOKEN` private and never give it a `VITE_` prefix. Login channel ID and LIFF ID are public configuration. The server exposes only public LIFF/notice/contact configuration through `/api/config`.

The official LIFF SDK initializes before route changes and sends its original ID token to `/api/auth/line`; browser profile/decoded claims are not used as authentication. External browsers use LINE login. The server verifies issuer, audience, expiry, issue time and subject before issuing a session, and rejects browser-supplied identities/roles or attempts to overwrite staff/suspended identities. Live SDK/provider and rich-menu validation still require the actual channels and HTTPS endpoint.

The consent screen displays the configured notice/version. Acceptance/refusal awaits a server record; refusal displays the configured municipal telephone alternative. A newer notice requires a new decision before intake; drafts remain available for review. The API rejects acceptance if notice text is missing. Municipal notice/contact approval remains a release requirement.

## Production frontend hosting

Prefer same-origin hosting with `/api` proxied to the backend. If the future client is hosted separately, configure its public API base URL and set server `FRONTEND_ORIGIN` to the exact HTTPS frontend origin. The client base-URL adapter is pending; a build variable alone does not connect the current screens.

`API_PROXY_TARGET` configures only the local Vite development proxy. Static hosting does not run the Node API or PostgreSQL. A Vercel SPA rewrite alone is not a backend deployment. No deployment is performed by these changes.

## Notification delivery

Booking submission and lifecycle/assignment changes create notification outbox records in the same transaction as the operation. A separate worker processes them; starting the API does not send messages.

After the municipality's configuration and delivery authorization are ready, set `ALLOW_LINE_DELIVERY=true` and run `npm run notifications:send`. That command sends real external messages when configured. It processes up to 20 due records per invocation, so production needs an explicitly configured scheduled worker.

New messages include the booking reference, event-specific status/meaning, necessary timing, event timestamp and an authenticated system link. They do not include patient names, phone numbers, pickup coordinates/addresses, or clinical information. The notification UUID is the stable LINE retry key. Network errors, rate limits and server errors allow at most five total attempts with 1/5/30/120-minute delays from the preceding failure; a later valid Retry-After is respected. Permanent/exhausted failures appear in the dispatcher review panel; sanitized configuration and uncertain-delivery diagnostics also appear in the admin technical panel. Suspended recipients and accounts without a verified LINE subject are not sent messages.

Staff accounts do not yet have a UI for binding their LINE identity. Unlinked notifications fail explicitly with `NO_VERIFIED_LINE_ACCOUNT`. Citizen notification eligibility depends on the configured Official Account and the user's LINE relationship with it. Provider acceptance (`SENT`) does not prove that the user read the message.

No real LINE messages were sent during implementation. Tests inject fake identity and messaging providers and use synthetic data only.

## Connected workflows and remaining work

- Citizen: verified LINE session, consent/refusal, patient and appointment details, map/GPS/manual coordinates, review/submit, own booking status, permitted cancellation.
- Dispatcher: scoped request list, approval/rejection, non-reserving schedule confirmation, assignment, explicit pickup waiting, audited appointment/hospital modification or reassignment, incident resolution, ABORTED disposition, corrections, and resource readiness.
- Driver: current-day assigned patient details during a verified shift (or an already active trip that overruns the shift), location/navigation handoff, separate Start Trip/departure, ordered execution milestones, failed pickup/incidents, and minimized terminal history. Future/off-shift patient details are withheld.
- Administrator: current resource overview, explicit closure management, and audit view.

Citizen, dispatcher and driver core screens are connected. Full administration, exports, duplicate review, geospatial proposals and remaining SRS refinements are tracked in `../plans/INTEGRATION-PLAN.md`. Readiness never assumes automatic return to the depot.

Public map tiles/place search and production routing must use approved providers before live operation. Existing prototype map checks do not prove live municipal routing/navigation behavior.

## Verification

- `npm run test:line`: verified-claim checks, stable push retry headers, retryable/permanent errors.
- `npm run test:api`: HTTP/PostgreSQL journeys, LINE identity isolation, minimized driver history, outbox retries, and omission of patient details from messages.
- `npm run test:ui`: navigation/accessibility, staff-login, citizen, dispatcher and driver workflows/errors using intercepted synthetic API responses.
- `npm run test:citizen:integration`: original citizen screens with a real ephemeral API and temporary PostgreSQL database, forwarded API requests, and synthetic LINE SDK/verifier only. Covers caregiver/profile/intake/reload/own cancellation; does not validate live LINE.
- `npm run test:e2e`: browser suite; the PostgreSQL journey requires test database configuration and otherwise skips explicitly.

Official references: [LIFF initialization and login](https://developers.line.biz/en/reference/liff/#initialize-liff-app), [LINE ID token verification](https://developers.line.biz/en/reference/line-login/#verify-id-token), [LIFF ID tokens](https://developers.line.biz/en/reference/liff/#get-id-token), [provider-scoped user IDs](https://developers.line.biz/en/docs/messaging-api/getting-user-ids/), and [Messaging API push](https://developers.line.biz/en/reference/messaging-api/#send-push-message).

Failure handling: assign a named dispatcher to review the queue during service hours and a named technical service owner to the admin diagnostics. Claim the relevant review, verify the last known provider/recipient outcome, use only approved alternate contact channels, and record the result and next action. Reviews never restart delivery. Do not create a fresh key to bypass unknown delivery: LINE keys expire after 24 hours, so expired/legacy-unknown sends require human reconciliation. A worker crash consumes its durably reserved attempt; the next invocation reconciles uncertainty after 30 seconds and preserves the same key and five-attempt limit. Attempt history is append-only. The worker still needs an explicitly authorized schedule/runner; this work does not activate it or authorize real messages.

Run npm run test:notifications:integration for synthetic sender/API/PostgreSQL and original review-screen checks. The event/recipient/content matrix and authenticated message links are implemented for new events. Dispatcher audiences use the web work-alert queue, without requiring staff LINE binding. Optional staff LINE binding, operational duty assignment, live deployed redirects/provider/device checks and municipal wording acceptance remain release work. Legacy queued messages without a trustworthy event snapshot stop for reconciliation rather than using fabricated content.

Set PUBLIC_APP_URL to the municipality-approved HTTPS origin before authorizing delivery. The origin must have no credentials, path, query or fragment; links lead to existing citizen LIFF/status or staff login/role-guarded paths. Missing/invalid configuration creates MESSAGE_LINK_UNCONFIGURED and sends nothing. The local approved public origin was not configured during this slice; .env was not changed. Keep ALLOW_LINE_DELIVERY=false until separately authorized. Snapshot text and recipient subject are frozen on first preparation; changes in application origin, booking state or LINE binding cannot silently change a retry's body or recipient. Removed-driver notices lead only to current jobs; previous detail links remain subject to assignment checks.

Run npm run test:messages and npm run test:messages:integration for synthetic matrix, ownership and original-screen link checks. No external messages are sent by those commands.
