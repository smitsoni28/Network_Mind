# NetworkMind pilot MVP

NetworkMind is a single-tenant relationship-intelligence pilot. It imports real CSV contacts into PostgreSQL, retrieves relevant private records, optionally researches current public information, verifies explicit introduction paths, explains its evidence, drafts outreach, and records recommendation feedback.

The five contacts loaded by the seed and **Load sample network** action are fictional sample contacts. They are labelled `SAMPLE` and are never presented as a CSV import.

## Architecture

```mermaid
flowchart LR
  UI[Next.js UI] --> AUTH[Signed HttpOnly pilot session]
  UI --> API[Zod-validated route handlers]
  API --> SVC[Service layer]
  SVC --> DB[(PostgreSQL via Prisma)]
  SVC --> RET[Deterministic contact retrieval]
  SVC --> WEB[Configurable web provider]
  SVC --> LLM[OpenRouter, optional]
  RET --> EVID[Immutable evidence IDs]
  WEB --> EVID
  EVID --> SCORE[Server-side scoring]
```

Routes authenticate and validate; services own import, retrieval, evidence, scoring, provider, and persistence logic. The client never supplies canonical contact facts to analysis or message generation. Named-introduction answers consider only verified `ContactEdge` records and return exactly `No verified introduction path found.` when none exists.

Priority is calculated on the server as 40% goal match + 20% relationship + 25% evidence confidence + 15% actionability. Each component is rounded and displayed separately; relationship strength is not labelled as general confidence.

## Requirements and local setup

- Node.js 20 or newer
- npm 10 or newer
- Docker with Compose

```sh
cp .env.example .env
docker compose up -d postgres
npm install
npm run db:wait
npm run db:migrate
npm run db:seed
npm run dev
```

The local Docker Compose file maps PostgreSQL to `127.0.0.1:55432` on the host (`55432:5432`) to avoid common Windows conflicts on port 5432. Keep `.env` pointed at:

```sh
DATABASE_URL=postgresql://networkmind:networkmind_local@127.0.0.1:55432/networkmind?schema=public
```

Before seeding, set `PILOT_EMAIL` and a bcrypt hash in `PILOT_PASSWORD_HASH`. One safe local workflow is to read a password without echoing it and hash it:

```sh
read -s PILOT_PASSWORD
export PILOT_PASSWORD
node -e "require('bcryptjs').hash(process.env.PILOT_PASSWORD,12).then(console.log)"
unset PILOT_PASSWORD
```

Copy the printed hash to `.env`; never commit `.env` or a plaintext password. Generate a session secret with `openssl rand -base64 48`.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Server-only PostgreSQL connection string. |
| `SESSION_SECRET` | At least 32 characters in production; signs 12-hour session cookies. |
| `PILOT_EMAIL` | Only permitted pilot login email. No registration exists. |
| `PILOT_PASSWORD_HASH` | Bcrypt hash used by the seeded user. |
| `OPENROUTER_API_KEY` | Optional server-only language-model key. |
| `OPENROUTER_BASE_URL` | OpenRouter-compatible API base. |
| `OPENROUTER_MODEL` | Structured-answer model. |
| `OPENROUTER_PLANNER_MODEL` / `OPENROUTER_CONVERSATION_MODEL` / `OPENROUTER_RESEARCH_MODEL` | Optional role-specific OpenRouter models. |
| `OPENROUTER_PLANNER_MAX_TOKENS` / `OPENROUTER_CONVERSATION_MAX_TOKENS` / `OPENROUTER_RESEARCH_MAX_TOKENS` | Bounded output-token limits. Defaults are clamped by hard maximums. |
| `OPENROUTER_PLANNER_TIMEOUT_MS` / `OPENROUTER_CONVERSATION_TIMEOUT_MS` / `OPENROUTER_RESEARCH_TIMEOUT_MS` | Role-specific request timeouts. |
| `OPENROUTER_SITE_URL` / `OPENROUTER_APP_NAME` | OpenRouter attribution metadata. |
| `WEB_SEARCH_PROVIDER` | Provider label, normally `tavily`. |
| `WEB_SEARCH_API_URL` / `WEB_SEARCH_API_KEY` | Tavily-compatible endpoint and server-only key. |
| `WEB_ENRICHMENT_DEFAULT` | Seeded workspace default; keep `false` for opt-in. |
| `CONTACT_RELEVANCE_THRESHOLD` | Deterministic retrieval cutoff; default `0.22`. |

The expected Tavily endpoint is shown in `.env.example` but remains configurable. General web questions search the original question. Mixed questions search the target/topic. Contact enrichment, where enabled, is bounded to five candidates and sends only name, company, role, and location; email, phone, notes, and relationship history are not sent. If web search is disabled, unconfigured, times out, or yields no valid sources, the UI says current web information could not be retrieved.

OpenRouter is optional. Without it, network analysis and introduction verification remain fully functional and web results are shown as a source digest rather than a synthesized answer. Outreach drafts use OpenRouter only when `OPENROUTER_API_KEY` is configured and the workspace processing acknowledgement is recorded. Drafting prompts contain only contact first name, role and company when available, requested channel and tone, and the user's explicit drafting instruction. They do not include email, phone, private notes, `howMet`, relationship strength, last-contact date, import source, evidence, recommendation reasoning, contact-edge data, or internal scores. When either the key or acknowledgement is missing, the endpoint returns a deterministic local draft with `providerUsed: false`. API keys are read only in server modules.

## Database

The Prisma schema models `Workspace`, `User`, `Contact`, `Interaction`, explicit `ContactEdge`, `ImportJob`, `AnalysisRun`, deterministic `Recommendation`, immutable `Evidence`, `Feedback`, and `AuditLog`. Contacts have workspace-scoped duplicate protection for normalized email, phone, and normalized name plus company. The SQL migration adds a check requiring every edge to target either one stored contact or one external target.

Development migrations use `npm run db:migrate:dev`; deployment uses `npm run db:migrate`. `npm run db:seed` creates the configured pilot user and fictional sample records idempotently.

For daily local development, use either:

```sh
docker compose up -d postgres
npm run db:wait
npm run dev
```

or:

```sh
npm run dev:db
```

For a fresh destructive local reset, use:

```sh
npm run db:reset
npm run dev
```

`npm run db:reset` removes the local Postgres volume, starts Postgres, waits until it accepts `SELECT 1`, then runs migrations and seed. If any wait, migration, or seed step fails, the chained command stops before starting the app.

## CSV import

The import page accepts `.csv` files up to 10 MB and 5,000 rows, detects delimiter and headers, auto-maps common variants, previews 50 rows, and lets the user correct mappings. Unicode and whitespace are normalized. Email and ISO-style dates are validated. Duplicate priority is normalized email, normalized phone, then normalized name plus company. Warning rows are included only when the user chooses; invalid rows never import. Formula-looking values remain inert text and are escaped on CSV export.

## Commands

```sh
npm run dev
npm run build
npm start
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run check
npm run check:models
npm run db:wait
npm run db:reset
npm run dev:db
npm run dev:full
npm run db:migrate
npm run db:seed
```

Playwright starts the production server automatically for the mocked browser smoke test. Install its browser once with `npx playwright install chromium`.

`npm run check:models` tests the configured OpenRouter planner, conversation, and research roles independently. It prints configured model, serving model when returned, latency, and a classified failure status without printing API keys.

## Demo walkthrough

1. Sign in with the configured pilot account.
2. Acknowledge the first-run processing notice.
3. Import a real CSV, review mappings and warnings, and confirm. Alternatively, choose **Load sample network** for explicitly fictional data.
4. Ask “Who in my network works in manufacturing?” and inspect matched fields and private evidence.
5. Ask “Who is Narendra Modi?” Web mode either cites retrieved sources or honestly reports that web information is unavailable.
6. Ask “Who can introduce me to Narendra Modi?” Without a verified edge, the exact no-path response appears.
7. Open a recommendation, generate a draft, and submit useful/not-useful feedback.
8. Export or delete workspace data from Settings. Deletion removes workspace contacts, interactions, edges, imports, conversations, conversation messages, analyses, evidence, recommendations, feedback, and earlier audit logs, then writes one minimal deletion audit event. The workspace, pilot login, authentication configuration, and privacy settings remain.

## Privacy and security notes

Sessions are signed, HttpOnly, SameSite cookies and are Secure in production. Login and expensive routes have process-local rate limits. Login rate-limit identity is derived from bounded, valid deployment IP headers and falls back safely when no usable address is present. This is suitable for one pilot process; horizontally scaled deployment needs a shared limiter such as Redis and centrally managed session revocation. Imported notes and web snippets are delimited and treated as untrusted data in model prompts. Model outputs may cite only known IDs, and canonical names, roles, companies, scores, relationships, and paths are server-constructed.

Configured subprocessors may include the PostgreSQL host, OpenRouter/model provider, Tavily-compatible web provider, and deployment host. Review their contracts, retention, region, and security controls before real-world deployment. AI drafting can send a contact first name, role, and company after acknowledgement; web enrichment can send name, company, role, and location when enabled. Private notes, relationship history, emails, phones, evidence details, and internal scores are not sent to those providers. No contact names, private notes, or user queries are sent to analytics by this application.

**This MVP is not claimed to be GDPR-compliant.** A formal privacy, security, data-protection, retention, lawful-basis, and subprocessors review is still required.

## Deployment and troubleshooting

- Production startup must provide `DATABASE_URL`, `SESSION_SECRET`, `PILOT_EMAIL`, and a seeded user. A missing or short production session secret fails safely.
- Run migrations before starting the app. Terminate TLS at the deployment platform and keep PostgreSQL and provider keys in its secret manager.
- If login fails, verify the lower-cased `PILOT_EMAIL`, regenerate the bcrypt hash, then reseed.
- If Prisma cannot connect, run `npm run db:wait`, check `docker compose ps`, and verify `.env` uses the host port from `docker-compose.yml` (`55432` in the default local setup).
- If web mode says unavailable, enable enrichment in Settings and verify both web variables. The null provider never claims a search occurred.
- If an import row warns about a duplicate, inspect email, phone, then name/company; warning rows marked duplicate are intentionally not inserted.

## Current MVP limitations

This is deliberately single-workspace and single-process. It has no registration, invitations, email sending, background jobs, vector search, shared rate-limit store, enterprise identity provider, or automated data-retention scheduler. Web identity matching is conservative and relevance is lexical rather than semantic. Outreach is always a draft. Legal/compliance readiness, threat modelling, penetration testing, backups, disaster recovery, and production observability remain deployment work.
