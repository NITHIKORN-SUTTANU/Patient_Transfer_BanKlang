# Project instructions

## Start each task

1. Read `docs/plans/INTEGRATION-PLAN.md`, starting with **Resume here**. This is the saved session handoff and implementation progress record.
2. Read the relevant requirements in `docs/requirements/SRS.md` before planning or changing behavior. Use `docs/requirements/SRS-TH.md` for the identical Thai edition. Consult `docs/README.md` for supporting guides.
3. Inspect Git status and the actual implementation before editing. Many changes are saved but uncommitted; preserve modified, untracked, moved and intentionally deleted files.
4. Follow the user's current request. When asked to continue or do the next step, use the handoff to continue the next coherent slice without requiring a special resume prompt. For questions or unrelated requests, answer those instead of starting implementation.

## Requirements and design

- The English and Thai SRS v2.1 are the main requirements baseline. Keep requirement IDs, rules, numeric values, acceptance criteria and both language editions synchronized when changing requirements.
- Historical progress notes and original references provide context; they do not override the current SRS or the user's latest instructions.
- Delivery target: before the end of November 2026; proposed handover is 30 November.
- The current UI is final. Preserve its design and existing screens; add small controls only where required by the SRS. See `docs/design/UI-BASELINE.md`.
- Citizens use LINE OA rich menu → LIFF → existing booking screens. Staff use the authenticated web application.

## Continue implementation safely

- The integration plan identifies the next step. At this handoff, citizen integration is next: verify contracts against the SRS, add missing owner-scoped profile/assistance APIs, then connect LINE identity, consent, intake, own status and permitted cancellation through existing screens.
- Dispatcher and driver API integration exists. Citizen/admin cutover and newer SRS requirements remain incomplete. Inspect current code before assuming a feature is finished.
- Preserve server role/ownership checks and authoritative lifecycle, scheduling, revision and resource-readiness rules. Do not fall back to demo records or a public fake citizen identity.
- Use injected synthetic external providers for tests. Keep secrets private; never print `.env` values or paste credentials into documentation or chat.
- Keep `ALLOW_LINE_DELIVERY=false` unless real delivery is explicitly authorized. Do not send real LINE messages as a routine test.
- Preserve database volumes and applied migrations 001–003. Add new migrations for schema changes; do not rewrite applied migrations.
- Preserve original requirements and `reference_files/`. Do not reset the workspace, delete untracked work, commit, push or deploy without authorization for that action.

## Verify and hand off

- Run checks appropriate to the change. Historical passing checks do not prove newly refined SRS requirements.
- Clearly distinguish browser tests with intercepted responses, real API/PostgreSQL tests, and live provider validation. The complete existing-screen/real-API/PostgreSQL journey and live LINE validation are still pending at this handoff.
- At a meaningful stopping point, update **Resume here** in `docs/plans/INTEGRATION-PLAN.md` with completed work, verification, limitations and the next concrete step.
- Keep that plan as the single handoff/progress record. Do not create duplicate handoff documents or competing SRS sets.
- Communicate concisely in plain English; retain Thai product text.
