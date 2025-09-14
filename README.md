# Dynasty DNA – Rewrite

Ground-up rewrite starting from an empty branch.

Branch: rewrite/fresh-start

Local setup
- Use a managed Postgres (e.g., Neon). Create a DB and set `DATABASE_URL` in `.env`.
- Install and run: `npm install && npm run dev`
- Health: `GET /api/health` should report `db: ok` when `DATABASE_URL` is set.
