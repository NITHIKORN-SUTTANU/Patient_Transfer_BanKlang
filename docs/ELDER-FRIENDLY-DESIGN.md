# Interface refinement for usability testing

The current design is documented in [PRODUCT-DESIGN.md](PRODUCT-DESIGN.md). It supersedes the earlier warm green visual treatment with one shared blue and navy system. Booking uses numbered progress and saved trip milestones. The first page remains a role selector for professor-led prototype testing.

The existing React/Vite framework and four role workflows are retained. No external component inspiration was needed.

## Changes

- The landing page contains four role links. One tap opens the chosen role; there is no separate entry button. Role cards use one short task summary and mark the most recently used role. Promotional booking content and the journey preview are removed.
- Citizen forms use 20px input text and 64px main buttons. Choices combine labels, borders, color, and checkmarks.
- Booking instructions use short Thai sentences. The 48-hour rule is also expressed as two days. Consent keeps its explicit checkbox and privacy notice; medical history is not requested.
- Emergency access, validation messages, keyboard focus, picker cancellation, saved state, and all booking stages remain available.
- Dispatcher, driver, and admin screens share the palette, stronger headings, and larger controls. Staff metrics become full-width rows on small screens.
- Motion is limited to short control feedback and honors reduced-motion settings.
- Reset requires confirmation, defaults keyboard focus to keeping data, and can be dismissed with Escape. Switching roles preserves the latest saved state from other tabs.
- The booking header offers role switching. Status pages show the current milestone and next instruction first; the seven-stage timeline is available under “ดูทุกขั้นตอน”.
- Driver status actions name the actual next step, such as picking up the patient or confirming arrival, before opening the existing confirmation dialog.

## Implementation

`src/product-design.css` is the active shared visual system after the role structural styles. Earlier refinement stylesheets are no longer imported. `ServiceSymbol.tsx` contains local SVG icons. ProductHeader and ServiceTable provide shared navigation and responsive records across roles.

## Testing boundary

Automated checks cover build, lint, complete role journeys, keyboard behavior, citizen text/control sizes, and responsive layouts from 320px to 1920px. Screenshots are written to the ignored `test-results` directory. Actual comprehension and ease of use still need testing with older adults; these changes do not establish an accessibility certification.

This remains browser-local prototype data. Publication and shared data across devices are separate work.
