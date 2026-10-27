# DataDarshanam AI Reference

This document is the working reference for an AI agent modifying, debugging, deploying, or reviewing DataDarshanam. It describes the current repository, the runtime architecture, important contracts, deployment behavior, known limitations, and the audit performed on 2026-10-21.

## Product

DataDarshanam (`dataदर्शनम्`) is a conversational business-intelligence dashboard with a private document question-answering workspace. CSV analytics and document Q&A are separate flows. A user can ask a natural-language question about a CSV dataset and receive:

- An aggregated query result.
- An interactive Plotly chart.
- KPI-style summary values.
- A short AI-generated business insight.
- A dataset schema/profile and suggested questions.

Signed-in users can also upload supported documents, process them into canonical chunks and embeddings, retrieve owner-scoped evidence, and request a grounded answer with server-validated source references. This feature remains disabled by default until live provider and database checks pass.

The default dataset is the 50,000-row Amazon sales dataset in `frontend/public/sales.csv`. Users can upload another CSV. Uploaded data is associated with a browser-generated workspace ID, not an authenticated account.

Production URL: <https://datadarshanam.vercel.app>

## Repository map

- `frontend/`: the deployed Next.js application.
  - `src/app/page.tsx`: top-level analytics, document workspace, and Q&A composition.
  - `src/app/api/`: same-origin Next.js route handlers for analytics and authenticated document workflows.
  - `src/components/`: UI, chart, KPI, sidebar, upload, and result components.
  - `src/lib/api.ts`: browser API client; adds `X-Workspace-ID` and a 60-second request timeout.
  - `src/lib/engine/dataEngine.ts`: TypeScript CSV parser, profiling, date enrichment, filtering, aggregation, sorting, and summaries.
  - `src/lib/engine/llmParser.ts`: Groq natural-language query parser.
  - `src/lib/engine/chartBuilder.ts`: Plotly figure-spec builder.
  - `src/lib/engine/insightGen.ts`: Groq insight generation with a deterministic fallback.
  - `src/lib/supabase/`, `src/lib/ingestion/`, and `src/lib/embeddings/`: authenticated document management, bounded ingestion, embedding persistence, and retrieval services.
  - `src/lib/groundedAnswer.ts`: bounded Groq answer generation with retrieved evidence and validated chunk references.
  - `public/sales.csv`: runtime default data loaded by server-side route handlers.
- `backend/`: legacy/standalone FastAPI implementation.
  - `main.py`: `/api/health`, `/api/schema`, `/api/query`, `/api/dashboard`, and `/api/upload`.
  - `data_engine.py`: Pandas-based data engine and workspace state.
  - `llm_parser.py`, `insight_gen.py`: Python Groq integrations.
  - `chart_builder.py`: Python Plotly figure generation.
- `data/`: local SQLite/CSV assets used by the legacy backend.
- `Amazon Sales.csv`: source/sample dataset at repository root.
- `README.md`: developer setup and product overview.

## Runtime architecture

The Vercel application uses the frontend's same-origin route handlers:

```text
Browser
  -> Next.js same-origin /api/* routes
      -> CSV analytics: TypeScript data engine -> Groq parsing/insights
      -> Document Q&A: Supabase Auth/Storage/Postgres -> Gemini embeddings -> Groq answer
      -> Validated JSON/Plotly/source metadata returned to browser
```

The Python FastAPI backend is a separate legacy path and is not required by the current Next.js routes. Do not introduce a new cross-origin dependency unless deployment requirements change. If the Python service is used again, update both implementations consistently. Document ownership is derived from the verified Supabase user and database controls, never from `X-Workspace-ID`.

Vercel should use `frontend/` as the project root. `frontend/vercel.json` declares the Next.js framework, `npm install`, `npm run build`, and `.next` output.

## API contracts

All browser requests include:

```text
X-Workspace-ID: [A-Za-z0-9_-]{8,64}
```

The client creates this value in `localStorage` under `datadarshan-workspace-id`. This is an isolation hint, not authentication.

### `GET /api/health`

Returns service status and whether `GROQ_API_KEY` is configured. A configured key does not prove that the key is valid or that the configured model is available.

### `GET /api/schema`

Returns:

```json
{
  "profile": {
    "rows": 50000,
    "column_count": 17,
    "columns": [],
    "numeric_columns": [],
    "categorical_columns": [],
    "date_columns": [],
    "text_columns": []
  },
  "suggested_questions": []
}
```

The route loads the workspace dataset if present; otherwise it loads `public/sales.csv`.

### `POST /api/query`

Request:

```json
{
  "query": "Show total revenue by product category",
  "previous_context": null
}
```

Success responses include `parsed`, `result`, `insight`, `fallback`, `used_context`, and `plotly_spec.dark/light`. Parser or data errors are returned as structured `success: false` responses where possible.

### `POST /api/dashboard`

Request body contains an optional `query`. The route builds overview query specs from the dataset and returns several chart items. It does not require a separate frontend request for each chart.

### `POST /api/upload`

Accepts a multipart field named `file`. Only `.csv` files are accepted. Limits are 25 MB, 250,000 rows, and 100 columns. The parsed rows are stored in an in-memory workspace map.

### Document APIs

- `GET /api/documents` lists the authenticated user's documents.
- Document upload, completion, status, deletion, and embedding processing use the existing authenticated document routes; ownership is enforced server-side and by Supabase policies/RPCs.
- `POST /api/retrieval` performs owner-scoped retrieval. Optional document IDs only narrow the authenticated user's search.
- `POST /api/answers` calls the retrieval service directly, then performs bounded Groq generation. It returns `answered`, `insufficient_evidence`, or `no_evidence` with source objects built from validated retrieval records.
- `DOCUMENT_RAG_ANSWERS_ENABLED` is server-only and defaults to `false`. Do not enable it for production until non-production Supabase/Gemini/Groq checks and deployment verification are complete.
- The browser renders answer/source fields as data; it must not construct source URLs or trust model-provided citation metadata.

## Query/data behavior

- CSV values are coerced to numbers where possible; blank, `null`, `NA`, and `N/A` become null.
- Date-like columns whose names contain `date`, `time`, `created`, or `updated` are enriched with `year`, `month`, `month_name`, and `quarter`.
- Supported aggregations are `sum`, `mean`, `count`, `max`, and `min`.
- `__row_count` is the special metric for record counts.
- Supported filters are equality, inequality, comparisons, and membership.
- Results are sorted and limited before summary values are calculated. Therefore, `summary.total` is the total of the displayed/limited result, not necessarily the total across all groups.
- Month-name sorting is chronological in the TypeScript engine.
- The LLM must use only profiled columns. Treat model output as untrusted input and preserve validation in the data engine.

## Environment variables

Backend/Next.js server configuration:

```env
GROQ_API_KEY=...
GROQ_MODEL=openai/gpt-oss-120b
```

Legacy FastAPI configuration also supports:

```env
ALLOWED_ORIGINS=http://localhost:3000
MAX_UPLOAD_BYTES=26214400
MAX_UPLOAD_ROWS=250000
MAX_UPLOAD_COLUMNS=100
```

Never commit `.env`, `.env.local`, API keys, or deployment tokens. Only `.env.example` files belong in the repository.

The frontend environment example also lists Supabase public client configuration, server-only service-role and Gemini credentials, the embedding identity, and `DOCUMENT_RAG_ANSWERS_ENABLED=false`. Never expose service-role, Gemini, or Groq credentials to browser code.

The Groq model is configurable specifically to avoid hard-coding a retired model. The default currently used by the source is `openai/gpt-oss-120b`; verify the provider catalog before changing it in a future audit.

## Current verification boundaries

- Automated frontend tests mock Supabase, Gemini, and Groq boundaries. They validate local request handling and response contracts, not live service behavior.
- The Mission 7C/8 migrations have not been verified against a live Supabase project. Effective RLS, Storage policies, grants, RPC execution, pgvector behavior, and cross-user isolation remain unverified.
- No live Gemini, Groq, Supabase, or Vercel integration should be claimed unless a separate recorded non-production verification was actually performed.
- Mission 10 documents current UI limitations: document selection is limited to extraction-ready records, embedding readiness is not exposed by the document-list API, and source metadata does not yet navigate to an excerpt.
- The historical mission reports and their unresolved risks are indexed in [`docs/mission-history/README.md`](./docs/mission-history/README.md).

## Deployment audit: 2026-10-21

### Confirmed production issue

The live page loads successfully and `/api/schema` returns the expected 50,000-row, 17-column profile. The first suggested query fails in the browser with:

```text
Failed to reach AI service:
The model `llama-3.3-70b-versatile` does not exist or you do not have access to it.
```

The same failure was reproduced against:

```text
POST https://datadarshanam.vercel.app/api/query
X-Workspace-ID: audit-workspace-2026
{"query":"Show total revenue by product category"}
```

This is a real production failure, not a screenshot rendering problem. Health/schema success is misleading because they do not call the model.

### Deployment drift

The Vercel screenshot identifies deployment source commit `28465be`, while the checked-out repository is at `ff71cf5`. The repository history includes a migration to same-origin Next.js routes and later model changes, but production was serving an older path/model. Redeploy the current `main` branch after configuring the new model environment variable.

After deployment:

1. Open `/api/health`; verify `ai_configured: true`.
2. Open `/api/schema`; verify the dataset profile.
3. POST a simple query and require `success: true`.
4. Click a suggested query in the UI.
5. Generate the full dashboard.
6. Upload a small CSV and verify its profile is used for a subsequent query.
7. Check Vercel function logs for model, timeout, and upload errors.

### Screenshot interpretation

- The GitHub screenshot only shows repository metadata and does not prove application health.
- The Vercel screenshot shows a `Ready` deployment, which proves build/deployment completion, not that runtime integrations work.
- The stale deployment marker and the live model-not-found error are the important signals.

## Audit results

### Fixed in source

- Groq model selection is now centralized/configurable in both Python and TypeScript paths.
- The default model is `openai/gpt-oss-120b`, replacing retired Llama model IDs.
- README and environment examples describe the configured model instead of the retired model.
- TypeScript lint blockers from unnecessary `any` types, a `prefer-const` violation, and unused imports/variables were corrected.

### Remaining operational risks

1. **No authentication:** workspace IDs are client-generated and spoofable. Do not treat this as a multi-tenant secure data service.
2. **In-memory uploads:** Vercel process restarts lose uploads; different serverless instances do not share the map. Use object storage/database-backed sessions for durable data.
3. **Legacy duplicate backend:** Python and TypeScript engines can diverge. Prefer the TypeScript path for Vercel or explicitly retire the Python path.
4. **Provider dependency:** model availability, quota, and API-key validity are external runtime dependencies. Keep a deterministic parser or provider fallback if high availability is required.
5. **CSV parser scope:** the TypeScript parser handles quoted fields but is not a full streaming CSV implementation; large/malformed files should be tested before production use.
6. **Result summary semantics:** summaries are calculated after result limiting, which can make “total” appear lower than the dataset-wide total.
7. **Client-side stored history:** query history and saved charts are browser state and are not synchronized across devices.

## Validation commands

From `frontend/`:

```powershell
npm run lint
npm run build
```

For a local production smoke test:

```powershell
npm run build
npm run start
```

Then exercise `/api/health`, `/api/schema`, `/api/query`, `/api/dashboard`, and `/api/upload`. Keep API keys in the process environment only.

## Agent change rules

- Preserve the same-origin API design unless explicitly asked to reintroduce a separate backend.
- Update both TypeScript and Python implementations when changing a shared API contract or model behavior.
- Validate model availability before changing provider IDs.
- Keep user-facing errors actionable and do not silently report a successful chart when the query or AI call failed.
- Preserve workspace headers and upload limits.
- Do not add secrets to source control.
- Run the smallest relevant lint/build/smoke checks after changes.
