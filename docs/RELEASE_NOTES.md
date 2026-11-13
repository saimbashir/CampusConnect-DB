# CampusConnect — redesigned portfolio release

## New
- Full responsive frontend rebuilt because the provided CampusConnect upload did not contain its `public/` folder.
- Forest/navy workspace with light/dark theme, event cards, real seat utilization, easy navigation, and mobile support.
- Deterministic Smart Venue Planner against six-table data (capacity, maintenance status, booking overlap, transparent fit score).
- Month-view campus calendar backed by Events.
- Event explorer with search and status filters; registration management.
- Practical SQL dashboards and registration CSV exports.
- Additional end-to-end HTTP integration test and GitHub Actions workflow.

## Preserved
- All six original approved tables and foreign-key constraints.
- User authentication and database-backed role checks.
- Booking overlap prevention, registration capacity, safe CRUD endpoints, and reports.
- Node.js built-in SQLite (no third-party runtime dependencies).

## Improved safeguards
- Local HMAC secret is random on each fresh server process unless configured.
- Public signup cannot grant an organizer role.
- Production no longer seeds well-known demonstration accounts.
- Published source excludes pre-existing SQLite database files.

## Boundaries
The verified API tests passed; a headless browser preview rendered with mocked fictional records. The application has not undergone a public-host load test, accessibility audit or full penetration test.
