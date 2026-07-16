# Database migrations

The canonical, ordered schema for the Supabase Postgres database. Every schema
change we made lives here as a numbered, **idempotent** file (safe to re-run).

## Apply to a fresh project (e.g. staging)

Run the files **in order** in the Supabase SQL Editor (Dashboard → SQL Editor),
or with the Supabase CLI:

```bash
# one-off, in order:
for f in migrations/0*.sql; do
  psql "$SUPABASE_DB_URL" -f "$f"
done
```

(`SUPABASE_DB_URL` is under Project Settings → Database → Connection string.)

## Production

Your production DB already has all of these applied (we ran them ad-hoc while
building). The files are the record of truth and let you stand up an identical
**staging** project from scratch. Because every statement uses
`if not exists` / `drop policy if exists`, re-running the whole set on
production is a no-op — handy to confirm drift.

## Adding a new migration

Create `NNNN_short_name.sql` with the next number, keep it idempotent, and apply
it to staging first, then production.

## Backups

Postgres itself is backed up automatically by Supabase (Pro plan = daily
point-in-time recovery; free plan has limited retention). Uploaded PDFs and the
ChromaDB index live on the backend's disk — see `scripts/backup.sh`.
