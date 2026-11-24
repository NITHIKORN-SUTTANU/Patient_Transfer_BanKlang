# Patient Transfer

The [main SRS v2.1](docs/requirements/SRS.md) governs requirements, system design, acceptance and delivery before the end of November 2026. The current UI is the final design; only small SRS-required additions are authorized.

อ่าน SRS ฉบับเดียวกันได้ทั้ง [ภาษาไทย](docs/requirements/SRS-TH.md) และ [ภาษาอังกฤษ](docs/requirements/SRS.md) โดยคงรหัสข้อกำหนด ตัวเลข และแผนภาพตรงกัน

Start with the [documentation index](docs/README.md). Use the [integration plan](docs/plans/INTEGRATION-PLAN.md) for actual progress and remaining work.

## Live access by role

| Role | Entry point |
| --- | --- |
| Citizen or caregiver | [Open booking in LINE](https://liff.line.me/2012622841-ICLJ2q8K), also available from the LINE OA rich menu |
| Dispatcher | [Dispatcher dashboard](https://angle-belong-rapidly-outputs.trycloudflare.com/dispatcher) |
| Driver | [Driver dashboard](https://angle-belong-rapidly-outputs.trycloudflare.com/driver) |
| Administrator | [Admin dashboard](https://angle-belong-rapidly-outputs.trycloudflare.com/admin) |

Staff use the [shared staff sign-in](https://angle-belong-rapidly-outputs.trycloudflare.com/staff/login). The demo uses a temporary public hostname that may change when the tunnel restarts.

The citizen LINE link still points to the expired hostname. Set the LIFF Endpoint URL in LINE Developers to the [current booking endpoint](https://angle-belong-rapidly-outputs.trycloudflare.com/booking), then verify booking from the LINE rich menu on a phone.

For local setup, follow [Local development](docs/guides/LOCAL-DEVELOPMENT.md), then consult [development](docs/guides/DEVELOPMENT.md), [API](docs/guides/API.md), [database](docs/guides/DATABASE.md) and [LINE](docs/guides/LINE-SETUP.md). Staff enter through `/staff/login`; driver accounts require a linked roster and shifts. Citizen core screens use verified LIFF/API sessions; admin accounts/resources/working windows use protected API management. Hospital/village/depot/closure settings now use protected revisioned APIs with dispatcher configuration review. Post-pickup destination changes now use a separate dispatcher preview/commit action with versioned route history. New event messages now use minimized snapshots/authenticated links and a dispatcher web-alert queue. Live LINE validation and other SRS refinements remain pending as recorded in the plan.

## Modes: Live Production vs. Standalone Interactive Demo

- **Live Production Build (`npm run build`):** Connects strictly to the authenticated API/PostgreSQL backend (`server/`). Interactive Demo Mode, `?demo=1` activation, demo role switchers, and synthetic seed shortcuts are disabled in production builds.
- **Standalone Interactive Demo (`npm run dev:demo` / `npm run build:demo`):** Sets `VITE_DEMO_MODE=true` so all 4 roles (Citizen, Dispatcher, Driver A–E, Admin) can be previewed in a browser using local storage without PostgreSQL or LINE LIFF (used for remote UAT previews).
- **Server Seed Import Guard:** `POST /api/admin/seed-import` and `POST /api/admin/seed-reset` are disabled by default (`403`) unless `ALLOW_ADMIN_SEED=true` is explicitly configured for a non-production/UAT environment. Keep `ALLOW_LINE_DELIVERY=false` unless real LINE delivery is explicitly authorized.

Original requirements and reference files are preserved. Credentials, database records and generated outputs are not documentation sources.
