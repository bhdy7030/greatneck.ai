# greatneck.ai

AI-powered community assistant for Great Neck, NY. Answers questions about village codes, permits, events, and local life using a multi-agent RAG pipeline with tool-augmented retrieval.

**Live**: https://greatneck.ai

## Architecture

```
User Query
    │
    ▼
┌─────────────────────────────────────────────────────┐
│  Registry (in-memory FAQ, <1ms)                     │
│  Semantic Cache (ChromaDB cosine similarity)        │
│  ↓ cache miss                                       │
│  RAG Prefetch (ChromaDB vector search, village-     │
│    filtered, distance ≤ 1.2, parallel)              │
│  ↓                                                  │
│  Router (Gemini 2.5 Flash Lite, zero-shot classify) │
│  → permit | village_code | community | report |     │
│    vision | general | off_topic                     │
│  ↓                                                  │
│  Planner (Gemini 3.1 Pro, streaming preview)        │
│  → SearchPlan: steps, tools, priorities, complexity │
│  → Skipped for simple community queries / fast mode │
│  ↓                                                  │
│  Specialist (Gemini 3.1 Pro, tool-augmented)        │
│  → Multi-hop search: KB → web → social → codes     │
│  → Parallel tool execution within iterations        │
│  → Self-check: verify claims against sources        │
│  ↓                                                  │
│  Critic (Gemini Flash, validation)                  │
│  → Accept / Retry with feedback / Insufficient      │
│  → Skipped for general/off_topic and fast mode      │
│  ↓                                                  │
│  Response (SSE streaming with pipeline events)      │
└─────────────────────────────────────────────────────┘
```

### Agentic Techniques

- **Multi-agent orchestration**: Router → Planner → Specialist → Critic pipeline with conditional stage skipping based on query complexity and agent type
- **Tool-augmented generation**: Specialist agents call tools (search_codes, search_permits, web_search, search_social, search_events, get_code_section, scrape_url) in parallel within each reasoning iteration
- **Streaming preview**: Planner streams a user-facing acknowledgment sentence before its JSON plan, giving perceived instant response while the search plan generates
- **Adaptive complexity**: Planner assesses low/medium/high complexity to select specialist model tier; simple queries skip planning entirely
- **Critic-in-the-loop**: Post-generation validation with single retry on failure, using structured feedback to guide the retry
- **Self-check prompting**: Specialist verifies each claim against retrieved sources before responding (zero-cost accuracy boost)
- **Prompt caching**: Static system prompts marked with `cache_control` for Anthropic/Gemini prompt caching (~0.5s savings on repeated calls)
- **Hierarchical RAG**: Village-specific vector search with shared knowledge fallback, query embedding reused across multiple searches
- **Semantic caching**: ChromaDB cosine similarity on query embeddings to serve cached responses for similar questions
- **Budget-controlled web search**: Per-request Tavily call budget (cap: 6) with Redis-backed result caching

## Tech Stack

### Backend

| Component | Technology |
|-----------|-----------|
| Framework | FastAPI (Python 3.11) |
| LLM | LiteLLM → Gemini 3.1 Pro / 2.5 Flash Lite (Anthropic Claude as fallback) |
| Vector DB | ChromaDB (sentence-transformers embeddings) |
| Database | PostgreSQL (Cloud SQL) |
| Cache | Redis (Upstash) with prefix isolation (dev:/prod:) |
| Web Search | Tavily API (basic depth, 5 results, domain-filtered for social) |
| Web Scraping | Crawl4AI (Playwright), BeautifulSoup, PDFPlumber |
| Auth | Google OAuth + Apple Sign In, JWT (HS256) |
| Background | Metrics rollup, reminder processor, event scraping |

### Frontend

| Component | Technology |
|-----------|-----------|
| Framework | Next.js 14 (React 18, TypeScript) |
| Styling | Tailwind CSS with CSS custom properties for theming |
| Build | Static export (`output: "export"`) → nginx |
| Charts | Recharts (admin metrics dashboard) |
| Mobile | Capacitor 8 (iOS + Android) |
| Markdown | react-markdown + remark-gfm |

### Infrastructure

| Component | Technology |
|-----------|-----------|
| Hosting | GCP Cloud Run (us-east1) |
| CI/CD | GitHub Actions (test → build → deploy) |
| Registry | GCP Artifact Registry |
| Storage | GCS FUSE bucket (knowledge base) |
| Domain | greatneck.ai (Cloud Load Balancer) |

## Project Structure

```
├── backend/
│   ├── agents/          # 8 agent types (router, planner, specialist, critic, etc.)
│   ├── api/             # FastAPI routes (chat, auth, guides, events, admin, etc.)
│   ├── db/              # PostgreSQL schema, migrations, query modules
│   ├── llm/             # LiteLLM provider wrapper, model config, translation
│   ├── rag/             # Chunker, ChromaDB store, ingestion pipeline
│   ├── tools/           # 11 tool modules (search, scrape, web, social, events, etc.)
│   ├── metrics/         # Usage collector, daily rollup, pipeline telemetry
│   ├── cache/           # Redis client, semantic cache, event cache
│   ├── scrapers/        # Library calendar, park district, social media scrapers
│   ├── reminders/       # Background reminder processor
│   ├── config.py        # Model assignments, API keys, feature flags
│   └── main.py          # FastAPI app, middleware, lifespan tasks
├── frontend/
│   ├── src/app/         # 15 Next.js page routes
│   ├── src/components/  # 50+ React components
│   ├── src/lib/         # API client, auth helpers, native utilities
│   ├── src/hooks/       # Push notifications, custom hooks
│   ├── ios/             # Capacitor iOS project (Xcode)
│   ├── android/         # Capacitor Android project (Gradle)
│   ├── capacitor.config.ts
│   └── Dockerfile       # nginx static serving
├── knowledge/           # RAG knowledge base files
├── scripts/             # Ingestion CLI, utilities
├── deploy/              # GCP deployment scripts
├── .github/workflows/   # CI, deploy, mobile build
└── dev.sh               # Local dev entry point
```

## Database

PostgreSQL with 15+ tables:

- **users** — OAuth profiles, tiers (free/pro/admin), promo expiry
- **conversations / messages** — Chat history with agent attribution and sources
- **events** — Scraped community events (library, park district, village)
- **guide_saves / guide_step_status** — Playbook progress tracking with reminders
- **user_guides** — User-created/forked playbooks with publish flow
- **llm_usage** — Per-call cost tracking (prompt/completion tokens, latency, model)
- **pipeline_events** — Execution telemetry (stage durations, tool calls, cache hits)
- **metrics_daily** — Rolled-up daily aggregates (cost, tokens, DAU, latency)
- **device_tokens** — Push notification registration (iOS/Android)
- **invites / waitlist** — Referral system and pre-launch signups

## Local Development

```bash
# Prerequisites: Docker (for Postgres), Node 20, Python 3.11+

./dev.sh start    # Starts Postgres, backend (:8001), frontend (:3000)
./dev.sh test     # Runs pytest (31 fast tests)
./dev.sh test --slow  # Includes LLM golden-set tests (37 total)
./dev.sh build    # Frontend build + backend lint + tests
./dev.sh stop     # Kills all processes
```

Environment: `.env` (backend secrets), `frontend/.env.local` (`NEXT_PUBLIC_API_URL=http://localhost:8001`)

## Deployment

```bash
# Via GitHub Actions (preferred)
gh workflow run Deploy -f target=both     # backend + frontend
gh workflow run Deploy -f target=backend  # backend only

# Local (emergency)
./deploy/gcp-update.sh --backend --frontend
```

## Mobile (iOS / Android)

```bash
cd frontend

# Dev (live reload from local server)
# Set server.url in capacitor.config.ts, then:
npm run build && npx cap sync ios && npx cap open ios

# Production build
NEXT_PUBLIC_API_URL=https://greatneck.ai npm run build
npx cap sync ios
# Open Xcode → Cmd+R on device

# Key files
ios/App/App/SafeAreaBridgeViewController.swift  # Safe area fix
ios/App/App/SceneDelegate.swift                 # UIScene lifecycle
ios/App/App/Info.plist                          # URL schemes, ATS
```

## Model Configuration

| Role | Model | Purpose |
|------|-------|---------|
| Router | gemini-2.5-flash-lite | Query classification (~500ms) |
| Planner | gemini-3.1-pro-preview | Search plan decomposition |
| Specialist | gemini-3.1-pro-preview | Tool-augmented answer generation |
| Critic | gemini-3-flash-preview | Response validation |
| Simple | gemini-3-flash-preview | Community lookups |
| Vision | gemini-3.1-pro-preview | Image analysis |

Configurable via `backend/config.py` or admin UI. Originally built for Anthropic Claude (Haiku/Sonnet/Opus).

## Performance Optimizations

- **Conditional pipeline stages**: Skip planner for simple community queries (<60 chars or fast mode), skip critic for general/off_topic
- **Parallel execution**: RAG prefetch + router run concurrently; tool calls within specialist iterations run in parallel via `asyncio.gather`
- **Streaming**: SSE with preview tokens, pipeline step events, and token-by-token answer streaming
- **Caching layers**: Redis (Tavily results, guide catalog), ChromaDB semantic cache (similar query dedup), in-memory registry (common answers)
- **Budget controls**: Per-request web search cap (6 calls), tier-based query limits
