# CampusConnect security notes

This repository is a coursework/portfolio prototype. Its role checks, random development session secret, parameterized SQLite statements and scrypt password hashes are useful fundamentals, but not production security certification.

## Do not publish existing databases
The source was uploaded with a SQLite `.db`, `.db-wal` and `.db-shm` bundle containing user records. None of these are included in the public-release ZIP. They must remain private. The server generates only fictional demonstration records when run locally.

## Production safeguards
In `NODE_ENV=production`, configure a strong 32+ character `SESSION_SECRET` and new `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` values (16+ characters) before the first start. Use HTTPS, secure cookies and a private database location, and configure HOST behind a trusted HTTPS reverse proxy. Demo users and events are not generated in production mode.

## Important limitations
- Public self-signup is student-only; an administrator promotes other roles.
- HTTP requests are checked against the supplied Origin for state-changing methods, but no independent production penetration test or full CSRF assessment has been conducted.
- No rate-limiting or intrusion monitoring is included for public deployment. Add both before internet exposure.
- Full backups, secret rotation, accessibility auditing, and concurrency/load tests are still required for any production use.
- Existing records should never be uploaded as GitHub releases or action artifacts.
