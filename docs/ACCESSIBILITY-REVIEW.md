# Accessibility review

Current design reference: [PRODUCT-DESIGN.md](PRODUCT-DESIGN.md). The active design follows Figma's teal system; earlier blue redesign specifications are superseded.

## Verification

- Automated axe scans cover 20 role routes at 320px and 1280px, using WCAG 2 A/AA, 2.1 A/AA, and 2.2 AA tags.
- Additional checks cover citizen validation, pickers and review; staff dialogs; keyboard focus visibility and restoration; target sizes; short viewports; text spacing; and doubled authored font sizes.
- Role workflow tests cover responsive layouts from 320px upward, shared state, stale confirmations, and local persistence.
- All 63 tests passed, including role-icon navigation and horizontal scrolling checks.
- Build and lint passed.

## Implementation choices

Figma's palette, source SVG dimensions, compact citizen composition, staff sidebars, and driver navigation are preserved. Supporting text is at least 16px. Admin muted text is darkened for contrast. Main citizen controls are large; calendar cells are approximately 44px where seven columns fit, with a larger four-column layout and explicit weekday labels on narrower phones.

Dialogs use native dialog behavior, visible labels, Escape dismissal, and focus restoration. Picker confirmation actions remain separate from scrolling calendar content. Phone tables retain semantic table markup and display each row with its column labels.

The entry-only 1669 link is plain text below the citizen header, as requested. It has a 48px hit area without a button or banner appearance.

Each role screen has a fixed role-selection icon with a 48px hit area, accessible name, tooltip, and visible keyboard focus. Citizen screens place it at top right. On mobile, dispatcher, driver, and admin workspaces place it at bottom left to avoid the horizontal header, with space after page content. Desktop keeps it at top right. User-facing phone links have a 48px hit area; the pickup address field has an explicit label.

## Limits

Automated checks do not establish complete WCAG conformance. Screen-reader review, real device testing, and moderated testing with older adults are still needed. Maps, routing, authentication, notifications, and submissions are prototype behavior; no live service or real emergency workflow is connected.
