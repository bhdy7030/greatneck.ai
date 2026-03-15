# GreatNeck.ai — System Architecture

## End-to-End Request Flow

```
                            ┌─────────────────────────────────────────────┐
                            │              INTERNET / CDN                 │
                            └──────────────────┬──────────────────────────┘
                                               │ HTTPS
                                               ▼
                            ┌─────────────────────────────────────────────┐
                            │         GCP Cloud Load Balancer             │
                            │    (TLS termination, static IP, SSL cert)   │
                            │                                             │
                            │   /*  ──────►  Frontend (nginx + static)    │
                            │   /api/* ───►  Backend  (FastAPI)           │
                            └────────┬────────────────┬───────────────────┘
                                     │                │
                       ┌─────────────▼──┐    ┌───────▼──────────────────┐
                       │   FRONTEND     │    │        BACKEND           │
                       │   Cloud Run    │    │        Cloud Run         │
                       │                │    │                          │
                       │  Next.js 14    │    │  FastAPI + Uvicorn       │
                       │  Static Export │    │  Python 3.11             │
                       │  nginx:alpine  │    │                          │
                       │  256Mi / 0-3   │    │  1Gi / 1-3 instances    │
                       └────────────────┘    │                          │
                                             │  ┌──────────────────┐   │
                                             │  │  AI Pipeline     │   │
                                             │  │                  │   │
                                             │  │  1. Registry     │   │
                                             │  │  2. Router       │   │
                                             │  │  3. RAG Prefetch │   │
                                             │  │  4. Planner      │   │
                                             │  │  5. Specialist   │◄──┼──► LLM APIs
                                             │  │  6. Critic       │   │    (Claude / Gemini)
                                             │  │  7. Response     │   │
                                             │  └──────┬───────────┘   │
                                             │         │               │
                                             │    ┌────▼────┐         │
                                             │    │  Tools   │         │
                                             │    │          │◄────────┼──► Tavily (web search)
                                             │    │ search   │         │
                                             │    │ scrape   │         │
                                             │    │ forms    │         │
                                             │    └────┬─────┘         │
                                             │         │               │
                                ┌────────────┼────┬────▼────┬──────────┤
                                │            │    │         │          │
                          ┌─────▼─────┐ ┌────▼────▼──┐ ┌───▼──────┐  │
                          │  SQLite   │ │  ChromaDB   │ │  GCS     │  │
                          │  (users,  │ │  (vectors,  │ │  Bucket  │  │
                          │  convos,  │ │  knowledge) │ │  (mount) │  │
                          │  messages)│ │             │ │          │  │
                          └───────────┘ └─────────────┘ └──────────┘  │
                                             └─────────────────────────┘
```

---

## Agentic Workflow (Deep Dive)

The AI pipeline processes every user query through a multi-agent system. Each agent is a single LLM call with a specific role, and the pipeline orchestrates them with conditional branching, retry loops, and streaming.

### Pipeline Flow

```
User Query
    │
    ▼
┌──────────────┐     ┌─────────────────────────────────────────────────────┐
│  Registry    │────►│ Lookup internal FAQ/answer database                │
│  (in-memory) │     │ If match found → inject as high-priority context   │
└──────┬───────┘     └─────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────┐     ┌─────────────────────────────────────────────────────┐
│  RAG Prefetch│────►│ Search ChromaDB for relevant knowledge chunks      │
│  (vector DB) │     │ Village-specific + shared results, filtered by     │
│              │     │ distance ≤ 1.2. Injected as baseline context.      │
└──────┬───────┘     └─────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────┐     ┌─────────────────────────────────────────────────────┐
│   Router     │────►│ Haiku (fast, cheap). Zero-shot classification:     │
│              │     │ → village_code | permit | community | vision       │
│   1 LLM call │     │ → general | off_topic                              │
│   ~0.3s      │     │ Also refines query into search-friendly form.      │
│              │     │ Off-topic → immediate polite redirect, pipeline    │
│              │     │ stops.                                              │
└──────┬───────┘     └─────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────┐     ┌─────────────────────────────────────────────────────┐
│   Planner    │────►│ Sonnet. Decomposes query into SearchPlan:          │
│              │     │   • project_type: "fence installation"              │
│   1 LLM call │     │   • applicable_domains: ["zoning", "permits"]      │
│   ~1s        │     │   • complexity: low | medium | high                 │
│              │     │   • steps: [{tool, query, priority}]                │
│  (skipped    │     │   • web_fallback_queries: ["fence permit NY 2026"] │
│   for simple │     │                                                     │
│   queries)   │     │ Complexity drives model selection for Specialist:   │
│              │     │   low/medium → Sonnet (cheaper, faster)             │
│              │     │   high → Opus (best reasoning)                      │
└──────┬───────┘     └─────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────┐     ┌─────────────────────────────────────────────────────┐
│  Specialist  │────►│ Sonnet or Opus (based on Planner's complexity).    │
│              │     │ Has tools and runs an agentic tool-use loop:        │
│  1-8 LLM     │     │                                                     │
│  calls       │     │   while iterations < 8:                             │
│  ~5-20s      │     │     response = LLM(messages + tool_schemas)         │
│              │     │     if no tool_calls → return final answer          │
│              │     │     for each tool_call:                              │
│              │     │       execute tool → append result to messages      │
│              │     │     loop back to LLM with new context               │
│              │     │                                                     │
│              │     │ Available tools per agent type:                     │
│              │     │   • search_codes — ChromaDB code search             │
│              │     │   • search_permits — ChromaDB permit search         │
│              │     │   • search_community — ChromaDB community search    │
│              │     │   • search_social — Live social/Reddit/Yelp search  │
│              │     │   • get_code_section — Fetch specific code section  │
│              │     │   • web_search — Tavily web search (budgeted)       │
│              │     │   • scrape_page — Fetch and parse a web page        │
│              │     │   • get_permit_form — Retrieve permit forms/PDFs    │
└──────┬───────┘     └─────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────┐     ┌─────────────────────────────────────────────────────┐
│   Critic     │────►│ Haiku (fast, cheap). Quality gate:                 │
│              │     │                                                     │
│   1 LLM call │     │ Evaluates: geographic accuracy (CRITICAL),         │
│   ~0.3s      │     │ source relevance, completeness, evidence backing,  │
│              │     │ honesty about gaps.                                 │
│  (skipped    │     │                                                     │
│   for simple │     │ Verdicts:                                           │
│   community  │     │   accept → pipeline done                            │
│   queries)   │     │   retry → re-run Specialist with Opus + feedback   │
│              │     │   insufficient → honest "I don't know" response    │
└──────┬───────┘     └─────────────────────────────────────────────────────┘
       │
       ├─── accept ──► Return response to user
       │
       ├─── retry ──┐
       │            ▼
       │    ┌──────────────┐
       │    │  Specialist   │  Re-run with:
       │    │  (Opus forced)│  • critic_feedback injected into system prompt
       │    │  + Critic #2  │  • model escalated to Opus regardless
       │    │              │  • second Critic pass: accept or insufficient
       │    └──────┬───────┘  (retry NOT allowed on second pass)
       │           │
       │           ├─── accept → Return response
       │           └─── insufficient → "I don't know" response
       │
       └─── insufficient ──► Honest redirect to village offices
```

### Model Routing Strategy

| Role | Claude Model | Gemini Equivalent | When Used |
|---|---|---|---|
| **Router** | Haiku 4.5 | Gemini Flash | Every query — fast classification |
| **Planner** | Sonnet 4 | Gemini Pro | permit, village_code, community queries |
| **Specialist** (low/med) | Sonnet 4 | Gemini Pro | Well-defined queries with a plan |
| **Specialist** (high) | Opus 4 | Gemini Pro | Complex multi-faceted queries |
| **Specialist** (retry) | Opus 4 | Gemini Pro | Always Opus on retry — escalate |
| **Critic** | Haiku 4.5 | Gemini Flash | Quality gate after specialist |
| **Vision** | Opus 4 | Gemini Pro | Image analysis (code compliance) |
| **Fast Mode** | Haiku 4.5 | Gemini Flash | All roles — user toggled |

LiteLLM abstracts the provider. A single `runtime_config.json` switches between Claude and Gemini globally. Per-request `fast_mode` overrides all roles to use the cheapest model (Haiku/Flash).

### System Prompt Construction

Every agent's system prompt is dynamically assembled with layered context:

```
Base system prompt (agent-specific persona)
  + Current date/time + upcoming weekdays (temporal reasoning)
  + Data freshness rules (when to trust KB vs. live search)
  + Response format guidelines (lead with answer, cite sources)
  + Village context + jurisdiction hierarchy (NYS → Nassau → Town → Village)
  + RAG baseline (pre-fetched knowledge chunks)
  + Registry context (high-priority known answers)
  + Debug instructions (admin god-mode overrides)
  + Search plan (Planner's strategy, if generated)
  + Critic feedback (on retry pass only)
  + Language instruction (Chinese support)
  + Conversation history (multi-turn context)
  + User query
```

### Tool Budget System

Web search calls are budgeted per request to control cost:

| Mode | Behavior |
|---|---|
| `off` | No web search tools available |
| `limited` | Max 5 web search calls per request |
| `unlimited` | No cap on web search calls |

Budget is set via `contextvars` (per-request thread-local) so concurrent requests don't interfere.

### Streaming Architecture

The frontend receives real-time pipeline visibility via Server-Sent Events (SSE):

```
Backend ──SSE──► Frontend

Events emitted:
  step:router    → "Classifying query..."        → "Routed to permit"
  step:planner   → plan details                  → "3 search steps planned"
  tool:           → {tool: "search_codes", ...}   (each tool call/result)
  step:specialist → "Completed (4 tool calls)"
  step:critic    → "Verdict: accept (92%)"
  step:retry     → (only if critic rejects)
  response       → final answer + sources + conversation_id
  error          → user-friendly error message
  debug          → (admin-only) raw routing, model selection, critic data
```

The Specialist's tool calls stream in real-time using an `asyncio.Queue` bridge: the agent runs in a background task, pushes tool events to the queue, and the SSE generator yields them as they arrive.

---

## Current Stack vs. Scalable Alternatives

### Data Layer

| Component | Current (Velocity) | Scale-Up | Scale-Out | Notes |
|---|---|---|---|---|
| **User/Conversation DB** | SQLite (WAL mode, file on disk) | PostgreSQL (single instance) | PostgreSQL + read replicas, or CockroachDB | SQLite hits wall at ~100 concurrent writers. Swap is straightforward — same SQL schema, use `asyncpg` or `SQLAlchemy` |
| **Vector Store** | ChromaDB (on-disk, default embeddings) | PostgreSQL + pgvector | Pinecone, Weaviate, or Qdrant (managed) | pgvector lets you consolidate to one DB. Managed vector DBs give you auto-scaling and filtered search without collection-per-village workaround |
| **Embeddings** | ChromaDB built-in (all-MiniLM-L6-v2) | OpenAI `text-embedding-3-small` | Cohere Embed v3, or self-hosted via vLLM | Current embeddings are decent but not state-of-art. Better embeddings = fewer irrelevant RAG results = fewer LLM tokens wasted |
| **File/Knowledge Storage** | GCS bucket mounted as filesystem | Same (GCS is already scalable) | S3 / R2 with CDN | GCS mount works but adds cold-start latency. Consider pre-loading into vector DB at ingest time instead of runtime file reads |
| **Caching** | In-memory dict (social search, 10min TTL) | Redis (single node) | Redis Cluster or Memcached | Current cache dies with the process. Redis survives deploys and can be shared across instances |

### Compute Layer

| Component | Current (Velocity) | Scale-Up | Scale-Out | Notes |
|---|---|---|---|---|
| **Backend Runtime** | Cloud Run (1-3 instances, sync) | Cloud Run with higher instance count | Kubernetes (GKE) with HPA | Cloud Run auto-scales well to ~50 concurrent requests. Beyond that, K8s gives you more control over pod scheduling and resource limits |
| **Request Processing** | Synchronous per-request | Same + connection pooling | Task queue (Cloud Tasks, Celery + Redis, or BullMQ) | Current: each request holds a Cloud Run instance for 10-30s during LLM calls. At scale, a queue decouples intake from processing — accept request instantly, process async, push result via WebSocket/SSE |
| **Frontend Hosting** | Cloud Run (nginx, static files) | Same | Cloud CDN / Cloudflare Pages / Vercel | Static files on Cloud Run is overkill. CDN gives global edge caching, zero cold starts, and is cheaper |
| **Background Jobs** | None (ingestion is manual CLI) | Cloud Run Jobs | Cloud Tasks + Cloud Run, or Temporal | Ingestion, re-indexing, and stale-data cleanup should be scheduled. Cloud Run Jobs or a proper workflow engine handles retries and scheduling |

### AI/LLM Layer

| Component | Current (Velocity) | Scale-Up | Scale-Out | Notes |
|---|---|---|---|---|
| **LLM Provider** | Claude (Anthropic) + Gemini (Google), hot-swappable via LiteLLM | Same + add OpenAI, Groq, or Mistral as fallbacks | Multi-provider load balancing with fallback chains | LiteLLM already abstracts this. Add a priority list: try Claude → fall back to Gemini → fall back to Groq. Eliminates single-provider outage risk |
| **Model Routing** | Complexity-based (Planner decides Opus vs Sonnet) | Same + cost tracking per query | Adaptive routing based on latency + cost budgets | Track cost-per-query. Route cheap questions to Flash/Haiku, reserve Opus for complex multi-step queries |
| **Streaming** | SSE (Server-Sent Events) | Same | WebSockets for bidirectional, or SSE + Redis Pub/Sub for multi-instance fan-out | SSE works great for single-instance. With multiple backend instances behind a load balancer, you need sticky sessions or a pub/sub layer so the instance that finishes processing can push to the instance holding the SSE connection |
| **Rate Limiting** | None (relies on LLM provider limits) | Per-user rate limit in middleware | Token bucket in Redis (e.g., `fastapi-limiter`) | Without rate limiting, one user can exhaust your API quota. Add per-user limits: e.g., 20 queries/hour for free, 100 for authenticated |

### Auth & Security

| Component | Current (Velocity) | Scale-Up | Scale-Out | Notes |
|---|---|---|---|---|
| **Authentication** | Google OAuth + JWT (self-managed) | Add Apple Sign-In, email/password | Auth0, Clerk, or Supabase Auth (managed) | Self-managed JWT works but you own the security surface. Managed auth gives you MFA, session management, and compliance out of the box |
| **API Security** | CORS + optional JWT | Add API key tier for integrations | OAuth2 scopes, API gateway (Kong, Apigee) | If you open an API for third parties (other village apps), you need proper API key management and usage tracking |

---

## Scalability Pain Points & Solutions

### 1. SQLite Concurrency (Critical at ~100 users)

**Problem:** SQLite allows only one writer at a time. Under load, conversation saves and user upserts will queue and timeout.

**Solution:**
```
SQLite ──► PostgreSQL (Supabase, Cloud SQL, or Neon)
```
- Same schema, swap `db.py` connection layer
- pgvector extension eliminates ChromaDB entirely — one database for everything
- Connection pooling via `asyncpg` or `SQLAlchemy[asyncio]`

### 2. Vector Search on GCS Mount (Cold Start + I/O)

**Problem:** ChromaDB files live on a GCS FUSE mount. Cold starts load the entire index into memory. Cloud Run instances that scale to zero must re-mount and re-load on every cold start (~5-10s).

**Solution (near-term):** Set `min-instances=1` to avoid cold starts (already done).

**Solution (long-term):**
```
ChromaDB on GCS ──► pgvector in PostgreSQL
                 or Pinecone / Qdrant (managed, always-hot)
```

### 3. LLM Calls Hold Instances (Cost at Scale)

**Problem:** Each chat request occupies a Cloud Run instance for 10-30 seconds while waiting for LLM API responses. At 100 concurrent users, you need 100 instances just waiting on I/O.

**Solution:**
```
Synchronous processing ──► Queue-based async processing

   User ──► API (accepts, returns job_id) ──► Task Queue ──► Worker processes
                                                              │
   User ◄── WebSocket / polling ◄── Result pushed back ◄─────┘
```
- **Near-term:** Cloud Tasks + Cloud Run (serverless queue)
- **Long-term:** Celery + Redis, or Temporal for complex orchestration
- SSE stream can be backed by Redis Pub/Sub so any instance can push results

### 4. No Rate Limiting (Abuse Risk)

**Problem:** A single user (or bot) can send unlimited requests, burning through your LLM API budget.

**Solution:**
```python
# Per-user rate limiting with Redis
from fastapi_limiter import FastAPILimiter
# Free tier: 20 queries/hour
# Authenticated: 100 queries/hour
# Admin: unlimited
```

### 5. Single-Region Deployment (Latency)

**Problem:** All infra is in `us-east1`. Users on the west coast or internationally see higher latency.

**Solution:**
```
Single region ──► Multi-region with global LB

Frontend: Deploy to CDN (Cloudflare Pages / Vercel) — instant global edge
Backend: Multi-region Cloud Run with Cloud Load Balancer
Database: Cloud SQL with cross-region read replicas
```

### 6. Ingestion is Manual (Data Freshness)

**Problem:** Knowledge base updates require running `python -m scripts.ingest_all` manually. Village codes can change without notice.

**Solution:**
```
Manual CLI ──► Scheduled Cloud Run Jobs

- Daily: Re-scrape ecode360 codes, diff against existing chunks
- Weekly: Re-crawl village websites for new content
- On-demand: Admin triggers re-ingestion from dashboard
- Alert: Notify admin when significant changes detected
```

### 7. No Observability (Blind Spots)

**Problem:** No structured logging, no metrics, no tracing. Can't answer "why was this response slow?" or "which agent fails most?"

**Solution:**
```
Console logs ──► Structured observability stack

- Logging: Cloud Logging (already available) + structured JSON logs
- Metrics: Track per-request: latency, token count, cost, agent used, critic verdict
- Tracing: OpenTelemetry → Cloud Trace (see full pipeline span)
- Dashboard: Grafana or Looker Studio for query volume, cost, and quality trends
```

---

## Recommended Migration Path

```
Phase 1 — Harden (100s of users)
├── Add Redis for caching + rate limiting
├── Add per-user rate limits
├── Move frontend to CDN (Vercel or Cloudflare Pages)
├── Add structured logging + basic metrics
└── Schedule ingestion jobs (Cloud Run Jobs, daily)

Phase 2 — Scale (1,000s of users)
├── SQLite → PostgreSQL (Cloud SQL or Supabase)
├── ChromaDB → pgvector (consolidate into one DB)
├── Upgrade embeddings (OpenAI or Cohere)
├── Add LLM provider fallback chain
├── WebSocket support for real-time streaming across instances
└── Add OpenTelemetry tracing

Phase 3 — Platform (10,000s+ / multi-tenant)
├── Queue-based async processing (Cloud Tasks or Celery)
├── Multi-region deployment
├── API gateway with usage tiers and API keys
├── Managed auth (Auth0 or Clerk)
├── Per-tenant knowledge isolation
└── Cost tracking and billing per organization
```

---

## Tech Stack Summary

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | Next.js 14, React 18, Tailwind CSS, TypeScript | Static SPA with SSE streaming |
| Backend | FastAPI, Python 3.11, Uvicorn | API server, agent orchestration |
| LLM | LiteLLM → Claude (Anthropic) + Gemini (Google) | Multi-provider LLM abstraction |
| Vector DB | ChromaDB (on-disk, default embeddings) | RAG knowledge retrieval |
| Database | SQLite (WAL mode) | Users, conversations, messages |
| Auth | Google OAuth 2.0 + JWT (python-jose) | Authentication |
| Web Search | Tavily API | Real-time web augmentation |
| Scraping | httpx + BeautifulSoup + Crawl4AI | Knowledge ingestion |
| Storage | GCS (FUSE mount on Cloud Run) | Knowledge files + ChromaDB persistence |
| Hosting | GCP Cloud Run + Cloud Load Balancer | Serverless containers |
| CI/CD | Google Cloud Build | Automated build + deploy |
| DNS/TLS | GCP managed SSL certificate | HTTPS for greatneck.ai |
