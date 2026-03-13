# TODOS — Engineering Review (2026-03-13)

## P0 — Before opening to real users

### ~~1. Add Redis-backed rate limiter middleware~~ ✅ DONE (2026-03-13)
Implemented in `api/rate_limit.py`. Chat: 5 req/15s. Other API: 60 req/60s. Redis-backed with in-memory fallback. Added as middleware in `main.py`.

---

## P1 — Before scaling past 100 users

### ~~2. Split db.py into db/ package~~ ✅ DONE (2026-03-13)
Split into 11 modules: connection.py, schema.py, users.py, conversations.py, guides.py, social.py, metrics.py, events.py, invites.py, auth.py, __init__.py. Removed 1,142 lines of dead SQLite code (4,054 → 2,912 lines). All imports preserved via re-exports.

### ~~3. Move reminder processing to Cloud Scheduler~~ ✅ DONE (2026-03-13)
Created `POST /api/cron/reminders` endpoint in `api/cron.py`. Secured via `X-Cron-Secret` header (CRON_SECRET env var). In-process loop kept as fallback. **Remaining:** Configure Cloud Scheduler in GCP console to hit the endpoint every 5 min with the secret header.

### ~~4. Extract guide view components + reusable BottomSheet~~ ✅ DONE (2026-03-13)
Created `BottomSheet.tsx` (36 lines), `ExpandedGuideView.tsx` (421 lines), `PeekGuideView.tsx` (270 lines). Reduced `guides/page.tsx` from 1,075 to 495 lines. Each view manages own local state, parent keeps shared state + handlers.

### ~~5. Add toast/error feedback + ErrorBoundary~~ ✅ DONE (2026-03-13)
Created `ToastProvider.tsx` (context + fixed-position toast UI, auto-dismiss 3s) and `ErrorBoundary.tsx` (class component with "Try again" fallback). Wired into `layout.tsx`. Replaced 10+ empty `catch {}` blocks in `guides/page.tsx`, `GuideChecklist.tsx`, and `PlaybookComments.tsx` with `showToast()` calls. Added success toast on publish sync.

### ~~6. Add backend integration tests (pytest)~~ ✅ DONE (2026-03-13)
31 fast tests + 6 golden-set (real LLM) tests across 5 files. `test_auth.py` (5): JWT, refresh tokens. `test_chat_pipeline.py` (15 fast + 6 slow): prompt snapshot tests catch accidental prompt edits (missing agent categories, dropped format instructions, broken context injection), router edge cases (malformed JSON, markdown wrapping), golden-set routing via real LLM (`pytest -m slow`). `test_guides.py` (5): save/unsave, step status, CRUD. `test_social.py` (4): comments, likes, notifications. `test_tier.py` (2): usage tracking. Run: `DATABASE_URL=... pytest` (slow tests skipped by default).

### ~~7. Add GitHub Actions CI pipeline~~ ✅ DONE (2026-03-13)
Created `.github/workflows/ci.yml`. On push/PR to main: backend job (Python 3.12, ephemeral Postgres 16 service, pip install, import check, all 37 pytest tests including golden-set LLM routing) + frontend job (Node 20, npm ci, npm run build). **Remaining:** Add `GEMINI_API_KEY` as GitHub repository secret for golden-set tests.

### 8. Set up GCP gamma environment + CI/CD auto-deploy
Create a staging (gamma) Cloud Run environment that auto-deploys on every push to `main` after CI passes, with a manual approval gate before production deploy.

**Scope:**
- Gamma backend (`askmura-backend-gamma`) + frontend (`askmura-frontend-gamma`) Cloud Run services
- Shares prod Cloud SQL database, isolated via `REDIS_PREFIX=gamma:`
- Frontend Dockerfile: accept `ARG NEXT_PUBLIC_API_URL` for build-time injection
- CI/CD: add `build-and-push`, `deploy-gamma` (auto), `deploy-prod` (manual approval) jobs to `ci.yml`
- GitHub environments: `gamma` (no protection) + `production` (required reviewers)
- GCP service account for CI deploys (`github-deploy@askmura.iam.gserviceaccount.com`)

**Plan:** See `.claude/plans/ancient-humming-owl.md` for full implementation details.
