# Project documentation

The [main SRS v2.1](requirements/SRS.md) is the source of truth for requirements, design diagrams, data, user documentation, tests, acceptance and November 2026 delivery. Implementation progress is recorded separately; a source-code pointer or passing foundation test is not full requirement acceptance.

The same SRS v2.1 is available in [Thai](requirements/SRS-TH.md) and [English](requirements/SRS.md). The Thai edition translates the complete document while retaining the same IDs, values, tables, links and English diagrams/formulas. Both editions represent the same requirements baseline; future requirement changes must update both together.

| Document | Use |
|---|---|
| [Main SRS](requirements/SRS.md) | Required final system and acceptance baseline |
| [Integration plan](plans/INTEGRATION-PLAN.md) | Current implementation progress, remaining work and SRS refinements to implement |
| [Development](guides/DEVELOPMENT.md) | Run the UI/API and relevant checks |
| [API](guides/API.md) | Existing endpoints, authentication and server contracts |
| [Database](guides/DATABASE.md) | Local PostgreSQL/PostGIS setup and migrations |
| [LINE setup](guides/LINE-SETUP.md) | Private configuration and live integration prerequisites |
| [Maps](guides/MAPS.md) | Map/search/navigation implementation and provider considerations |
| [UI baseline](design/UI-BASELINE.md) | Preserve the current final UI and add only required missing controls |

Preserved source records: [earlier SRS v1.3](requirements/SRS-Complete-Official-EN.md), [production decisions](requirements/PRODUCTION-INPUTS.md), and [original requirements/use cases/flows](../reference_files/). These remain provenance; the main SRS governs current decisions.

Obsolete archive reviews, prototype design notes and duplicate status/handoff documents have been removed. Keep current requirements in the SRS and implementation progress in the integration plan rather than creating competing status documents.
