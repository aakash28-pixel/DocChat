# Deploying DocChat

## The one architectural constraint

The backend keeps two things on **local disk**: the ChromaDB vector index
(`CHROMA_DB_DIR`) and uploaded PDFs (`UPLOAD_DIR`). ChromaDB is SQLite-backed and
**single-writer** — one process only. This means:

- The backend needs a **persistent disk** (not an ephemeral filesystem). Hosts
  that wipe the disk on every deploy (Render's free tier, Railway without a
  volume) will lose all indexed data and uploads on each restart.
- The backend runs as **one process / one worker**. Scale by giving it more
  CPU/RAM, not more replicas. (A horizontally-scaled setup would require moving
  to a managed vector DB — see *Scaling* below. Not needed at launch.)

Everything else (Supabase auth + Postgres, the static frontend) scales freely.

## Recommended setup (cheapest, self-contained, one-person-maintainable)

```
┌────────────────────┐     ┌──────────────────────────────────────┐
│  Vercel / Netlify  │     │  One small VPS (Hetzner / DO / Fly)  │
│  frontend (static) │────▶│  Caddy → backend (FastAPI + worker)  │
│  free              │     │  persistent volume: chroma + uploads │
└────────────────────┘     └──────────────────────────────────────┘
                                   │
                           ┌───────▼────────┐
                           │  Supabase       │  auth + Postgres (managed)
                           │  free or Pro    │  automatic DB backups
                           └─────────────────┘
```

Or run **everything on the one VPS** with the included `docker-compose.yml`
(frontend container + backend + Caddy auto-HTTPS) and skip Vercel entirely.

## Monthly cost estimate

| Piece | Service | Free option | Paid (recommended for launch) |
|---|---|---|---|
| Frontend (static) | Vercel / Netlify | **$0** (hobby) | $0 |
| Backend + worker + disk | Hetzner CX22 VPS (2 vCPU / 4 GB / 40 GB) | — | **~$5–6** |
| — or PaaS w/ persistent disk | Render / Railway / Fly | limited | **~$7–12** |
| Database + auth | Supabase | **$0** (free: 500 MB DB, limited backups) | **$25** (Pro: daily PITR backups, no pausing) |
| Vector DB | ChromaDB (local, on the VPS disk) | **$0** | $0 |
| LLM | Gemini API | free tier (~20 req/day) | **usage-based** — enable billing; budget to your traffic |
| Error tracking | Sentry | **$0** (5k errors/mo) | $0 |
| Analytics | Plausible (self-host) / Umami | **$0** self-hosted | ~$9 hosted |
| **Total** | | **~$0 + LLM** to start | **~$30–40/mo + LLM** |

**Realistic launch: ~$5 VPS + $0 Supabase free + $0 Vercel + Gemini usage.**
Upgrade Supabase to Pro ($25) when you want daily point-in-time DB backups —
that's the main "peace of mind" upgrade.

> ⚠️ **The variable cost is the LLM.** Every chat = 1 request, every upload = 1
> request. The per-user daily quotas (`CHAT_RATE_LIMIT` / `UPLOAD_RATE_LIMIT`)
> cap the blast radius; set a billing budget alert in Google AI Studio.

---

## Path A — all-in-one VPS (recommended, ~$5/mo)

1. **DNS:** point `docchat.example.com` and `api.docchat.example.com` (A records)
   at your VPS IP.
2. **On the VPS:** install Docker, clone the repo, then:
   ```bash
   cp .env.deploy.example .env    # fill in DOMAIN, LLM, Supabase, ALLOWED_ORIGINS
   docker compose up -d --build
   ```
   Caddy fetches Let's Encrypt certs automatically — HTTPS works in ~30s.
3. **Migrations:** run `migrations/0*.sql` in the Supabase SQL Editor (once).
4. **Backups:** add the cron line from `scripts/backup.sh`.

## Path B — Vercel frontend + PaaS backend

1. **Frontend → Vercel/Netlify:** import the repo, root `rag-frontend`, build
   `npm run build`, output `dist`. Set env: `VITE_API_BASE=https://<backend-url>`,
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
2. **Backend → Render/Railway/Fly** using `rag-backend/Dockerfile`. **Attach a
   persistent disk** mounted at `/data` (this is mandatory — see the constraint
   above). Set the backend env vars from `.env.deploy.example` (server-side).
   Set `ALLOWED_ORIGINS` to your Vercel URL.
3. Migrations + backups as above (on the PaaS, use its managed disk-snapshot
   feature for backups instead of the cron script).

---

## HTTPS, custom domain, staging

- **HTTPS + domain:** handled by Caddy (Path A) or the platform (Path B, Vercel
  and Render both do automatic TLS). Just point DNS.
- **Staging vs production:** create a **second Supabase project** (staging) and a
  **second backend deploy** with its own `.env` and volume. Apply the same
  `migrations/` to staging first, always. Frontend: a Vercel preview deployment
  per branch gives you staging for free.

## Database migrations

See `rag-backend/migrations/README.md`. Files are numbered, idempotent, and
apply in order. Test on staging, then production.

## Backups

- **Postgres:** automatic via Supabase (Pro = daily point-in-time recovery).
- **Uploaded PDFs + ChromaDB:** `scripts/backup.sh` (nightly cron; optional S3
  offsite). These can also be fully rebuilt by re-uploading, but backups save
  users from re-doing it.

## CI

`.github/workflows/ci.yml` runs backend tests (pytest) and frontend lint+build
on every push/PR. Wire it as a required check before deploy.

## Scaling (when you outgrow one box)

The only blocker to horizontal scaling is local ChromaDB. When you get there:
move embeddings to a managed vector DB (Chroma Cloud, Qdrant Cloud, or pgvector
inside your existing Supabase Postgres), move uploads to object storage
(Supabase Storage / S3), and then the backend becomes stateless and replicable.
Until then, a single well-sized VPS handles a lot.
