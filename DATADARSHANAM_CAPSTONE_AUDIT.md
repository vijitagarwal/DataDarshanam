# DataDarshanam Capstone Audit

**Audit date:** 2026-10-26\
**Audit scope:** read-only repository inspection and safe local validation\
**Repository:** `vijitagarwal/DataDarshan`\
**Auditor stance:** senior GenAI engineering, RAG architecture, and software reliability review

## 1. Executive summary

DataDarshanam is currently a working conversational CSV business-intelligence demo, not a RAG application.

The verified product flow is:

```text
Browser
  -> same-origin Next.js route
  -> CSV profiling/aggregation in TypeScript
  -> Groq structured query parsing for natural-language analytics
  -> Plotly specification + KPI summary
  -> Groq-generated insight or deterministic fallback
```

The repository contains no verified implementation of document ingestion, text extraction, chunking, embeddings, vector storage, retrieval, retrieved-context prompting, source citations, or RAG evaluation. Search results found no RAG-specific module, dependency, endpoint, or test fixture. Therefore:

> **RAG status: MISSING.**

The current application is valuable as the structured-analytics half of a hybrid RAG capstone. The lowest-risk path is to preserve the existing CSV analytics route and add a separate document knowledge route, then introduce an explicit router that chooses structured analytics, document RAG, or both.

### Highest-priority blockers

1. **No RAG pipeline exists.** There is no document-to-answer path.
2. **No evaluation harness exists.** There are no automated tests, golden questions, evidence labels, retrieval metrics, or answer-grounding checks.
3. **No durable data layer exists for uploads.** The current TypeScript upload store is process-local memory and is unsuitable for reliable multi-instance Vercel behavior.
4. **No source evidence contract exists.** Current AI insights return prose without source documents, chunk IDs, quotes, or citations.
5. **Architecture documentation is stale.** The root README presents FastAPI as the main architecture, but the deployed implementation is the same-origin Next.js API route set.
6. **The LLM output boundary is weakly validated.** The prompt requests a schema, but parsed model output is not comprehensively validated against the profiled dataset before aggregation.

## 2. Evidence and repository status

### 2.1 Repository state

Verified before creating this report:

- Branch: `main`
- HEAD: `a6a869b fix: reject incomplete AI insights`
- `origin/main`: same commit at audit start
- Worktree: clean before this report was created
- Existing ignored environment files were detected by filename but their contents were not printed.
- No secrets, tokens, or API-key values were exposed during the audit.

The report itself is the only new file requested by this mission.

### 2.2 Reference-document verification

The existing [AI_REFERENCE.md](./AI_REFERENCE.md) is useful but partly stale:

- **Verified:** same-origin Next.js routes exist under `frontend/src/app/api/`.
- **Verified:** the TypeScript data engine, Groq parser, chart builder, and insight generator exist.
- **Verified:** the Python backend is a separate implementation.
- **Verified:** workspace IDs are browser-generated and are not authentication.
- **Verified:** uploads are kept in an in-memory map in the TypeScript engine.
- **Stale/incomplete:** it describes the Python FastAPI architecture prominently even though the current Vercel route flow is Next.js-only.
- **Stale/incomplete:** it does not describe the absence of RAG as a capstone gap in a dedicated requirements assessment.
- **Historical:** its 2026-10-21 production incident describes retired Groq models. That incident was fixed in later commits, but the historical section remains intentionally preserved.

## 3. Actual architecture and request flow

### 3.1 Production-facing Next.js architecture

The deployed application is organized under [frontend/](./frontend/):

- [frontend/src/app/page.tsx](./frontend/src/app/page.tsx) owns browser chat state, schema loading, uploads, query history, saved charts, and dashboard actions.
- [frontend/src/lib/api.ts](./frontend/src/lib/api.ts) calls same-origin `/api/*` routes and adds `X-Workspace-ID`.
- [frontend/src/app/api/schema/route.ts](./frontend/src/app/api/schema/route.ts) loads the workspace/default dataset, profiles it, and returns suggested questions.
- [frontend/src/app/api/query/route.ts](./frontend/src/app/api/query/route.ts) performs the main natural-language analytics flow.
- [frontend/src/app/api/dashboard/route.ts](./frontend/src/app/api/dashboard/route.ts) generates deterministic overview charts.
- [frontend/src/app/api/upload/route.ts](./frontend/src/app/api/upload/route.ts) parses and stores uploaded CSV rows.
- [frontend/src/app/api/health/route.ts](./frontend/src/app/api/health/route.ts) reports service status and whether a Groq key is configured.

### 3.2 Main query request flow

`POST /api/query` currently does the following:

1. Parses JSON and trims `body.query`.
2. Normalizes the workspace ID with `/^[A-Za-z0-9_-]{8,64}$/`; invalid IDs fall back to `"default"` rather than returning an error.
3. Reads the workspace dataset from the process-local map or loads `frontend/public/sales.csv`.
4. Calls `parseQuery()` in [frontend/src/lib/engine/llmParser.ts](./frontend/src/lib/engine/llmParser.ts).
5. Gives the model a generated schema context and asks for a structured analytics JSON object.
6. Runs `runQuery()` in [frontend/src/lib/engine/dataEngine.ts](./frontend/src/lib/engine/dataEngine.ts).
7. Builds dark and light Plotly specifications with `buildChart()`.
8. Calls `generateInsight()` in [frontend/src/lib/engine/insightGen.ts](./frontend/src/lib/engine/insightGen.ts).
9. Returns parsed intent, aggregate result, insight, fallback indicator, and Plotly specs.

This is LLM-assisted structured analytics, not retrieval-augmented generation: the model sees a schema and aggregate-result prompt, not retrieved document chunks with source metadata.

### 3.3 CSV upload flow

`POST /api/upload`:

1. Accepts a multipart field named `file`.
2. Requires a filename ending in `.csv`.
3. Enforces 25 MB, 250,000-row, and 100-column limits.
4. Parses text with the custom `parseCSV()` implementation.
5. Coerces simple numbers and null markers.
6. Adds date-derived fields when a date-like column name is recognized.
7. Stores rows in `_datasets: Map<string, DataRow[]>`.
8. Returns a profile and suggested questions.

There is no durable object-storage key, database record, upload checksum, tenant ownership record, or ingestion job ID.

## 4. Existing RAG components

### 4.1 Search result

Repository search covered source, documentation, package metadata, and backend files for:

`RAG`, `embedding`, `vector`, `chroma`, `pinecone`, `weaviate`, `qdrant`, `faiss`, `retriev`, `chunk`, `citation`, `document`, `pdf`, `semantic`, and `similarity`.

The matches are existing CSV analytics, schema, SQL, and documentation references. No genuine RAG component was found.

### 4.2 Requirement classification

| RAG capability | Status | Evidence |
|---|---|---|
| Document ingestion and validation | **MISSING** | Only CSV upload exists in `frontend/src/app/api/upload/route.ts` and legacy `backend/routers/upload.py`. No document knowledge ingestion endpoint. |
| Text extraction | **MISSING** | No PDF, DOCX, HTML, or plain-document extraction pipeline exists. |
| Chunking | **MISSING** | No chunking function or chunk metadata model exists. |
| Embedding generation | **MISSING** | No embedding SDK, model call, batcher, retry policy, or embedding cache exists. |
| Vector storage | **MISSING** | No vector database, index, persistence layer, or namespace implementation exists. |
| Retrieval | **MISSING** | No similarity search, metadata filter, top-k selection, or hybrid retriever exists. |
| Retrieval relevance metadata | **MISSING** | No score, document ID, page, section, chunk ID, or source metadata contract exists. |
| Grounded answer generation | **MISSING** | Groq calls parse analytics JSON or produce result-based insight; no retrieved context is passed to an answer prompt. |
| Citations/evidence references | **MISSING** | Responses have no citation array, source URL, document name, page, quote, or evidence span. |
| Structured CSV analytics | **IMPLEMENTED** | TypeScript profiling, filtering, grouping, sorting, summaries, and Plotly specs exist. |
| Hybrid analytics/RAG routing | **MISSING** | No intent router distinguishes a data aggregation question from a document question. |
| Quota/latency controls | **PARTIAL** | Client timeout, route `maxDuration`, one parser retry, and insight fallback exist; no embedding batching, cache, budget, rate limit, or retrieval latency budget exists. |
| RAG evaluation | **MISSING** | No fixed question set, expected evidence, retrieval metrics, answer rubric, or regression runner exists. |

### 4.3 What is sometimes mistaken for RAG

- The schema context in `llmParser.ts` is structured metadata, not retrieved knowledge.
- `previous_context` is conversational context, not document retrieval.
- CSV aggregation results supplied to `insightGen.ts` are computed data, not a vector-retrieved corpus.
- The legacy Gemini service uses conversation history and database schema prompting, but it does not embed or retrieve documents.

## 5. Legacy FastAPI/Pandas backend assessment

The Python implementation under [backend/](./backend/) is a second analytics implementation:

- [backend/main.py](./backend/main.py) directly defines FastAPI routes.
- [backend/data_engine.py](./backend/data_engine.py) uses Pandas and process-local workspace state.
- [backend/llm_parser.py](./backend/llm_parser.py) uses Groq for structured query parsing.
- [backend/insight_gen.py](./backend/insight_gen.py) uses Groq for result-based prose.
- [backend/routers/query.py](./backend/routers/query.py) and [backend/routers/upload.py](./backend/routers/upload.py) define another route/service design.
- [backend/services/gemini_service.py](./backend/services/gemini_service.py), [backend/services/schema_service.py](./backend/services/schema_service.py), and [backend/services/sql_service.py](./backend/services/sql_service.py) form an older Gemini/SQLite SQL pipeline.

### Verified wiring concerns

- `backend/main.py` defines its own route set and does not include the `routers.query.router` or `routers.upload.router` objects.
- The legacy router modules therefore appear to be alternate/unused code paths rather than the route implementation used by `main.py`.
- The legacy service layer uses Gemini model configuration and imports that are not declared in the current [backend/requirements.txt](./backend/requirements.txt), which only lists FastAPI, Pandas, Plotly, Groq, dotenv, and multipart.
- This creates drift and makes it unsafe to treat the Python tree as a single reliable backend without a separate integration test.

**Classification:** legacy backend **PARTIAL / UNVERIFIED for production use**. It is syntactically valid, but its production deployment role is not established by the repository.

## 6. Confirmed risks and bugs

### 6.1 Reliability and correctness

1. **Process-local dataset state — BROKEN for durable multi-instance persistence.**\
   `dataEngine.ts` stores uploads in a module-level `Map`. Serverless restarts or another instance can lose the dataset. A workspace ID does not solve this.

2. **Workspace ID is not a security boundary — BROKEN for multi-tenant security.**\
   The ID is generated and stored in browser `localStorage`, then accepted from a request header. Any caller can choose another valid ID. There is no authentication or authorization.

3. **Model output validation is incomplete — PARTIAL.**\
   `parseQuery()` extracts JSON, but the route does not validate every field against a runtime schema or confirm that metric, dimensions, filter fields, operators, limits, and chart types are valid before `runQuery()`.

4. **Missing-column behavior is not consistently safe — PARTIAL/BROKEN.**\
   The prompt says not to invent fields, but the TypeScript engine does not comprehensively reject a missing metric/dimension before aggregation. Malformed model output can produce misleading zero/empty/invalid summaries rather than a clear validation error.

5. **Insight quality is only partially enforced — PARTIAL.**\
   The frontend now rejects empty or one-sentence model output and uses a fallback, but there is no factuality checker or evidence binding. The fallback assumes currency for metric names containing `revenue`, `price`, `cost`, or `amount`.

6. **Summary semantics can mislead — PARTIAL.**\
   Results are limited before `buildSummary()`, so displayed `summary.total` is the total of the limited groups, not necessarily the dataset-wide total. This is documented in [AI_REFERENCE.md](./AI_REFERENCE.md) but remains a product semantics issue.

7. **Custom CSV parser is not a full streaming parser — PARTIAL.**\
   It handles basic quoted fields but reads the entire upload into memory and has no robust malformed-CSV diagnostics, encoding negotiation, schema consistency checks, or streaming aggregation.

8. **Date handling is heuristic — PARTIAL.**\
   Date enrichment depends on column names containing date-like terms and JavaScript date parsing. Ambiguous dates and multiple date columns are not explicitly resolved by the user.

9. **No automated regression protection — MISSING.**\
   There are no unit, route, integration, or browser tests.

### 6.2 Security

- Secrets are ignored through root and frontend ignore rules, and the audit did not print secret values.
- API keys are read server-side from environment variables in the TypeScript Groq modules.
- The health endpoint exposes only a boolean `ai_configured`, which is appropriate as a basic readiness signal but does not validate provider access.
- The model is instructed to produce JSON, but prompt injection and untrusted CSV cell content are not explicitly isolated. For RAG, document text must be treated as untrusted content and separated from system instructions.
- Upload limits exist, but there is no per-user quota, rate limit, content scanning, persistent ownership, or abuse monitoring.
- The legacy SQL validator allows only one SELECT and blocks several dangerous keywords, but this path is not a substitute for parameterization, table authorization, and a production database policy.

## 7. Baseline checks

The following checks were run locally without installing, upgrading, deleting, or modifying dependencies:

| Check | Result | Evidence |
|---|---|---|
| Git branch/history/status | **PASS** | `main` at `a6a869b`; worktree was clean before report creation. |
| Frontend lint | **PASS WITH WARNINGS** | `npm run lint` completed with exit code 0; two `react-hooks/exhaustive-deps` warnings in `frontend/src/components/ChartView.tsx`; zero errors. |
| Frontend production build | **PASS** | `npm run build` completed successfully and listed routes `/`, `/api/dashboard`, `/api/health`, `/api/query`, `/api/schema`, and `/api/upload`. |
| Python syntax | **PASS** | Read-only AST parsing passed for 19 Python files. |
| Automated test suite | **UNAVAILABLE / MISSING** | No test files and no `test`, `jest`, `vitest`, `pytest`, or equivalent project script were found. |
| Dependency installation/audit | **NOT RUN** | Per instruction, no install/upgrade was performed; no dependency audit command was configured. |
| Production API smoke test | **NOT RUN** | This mission explicitly prohibited contacting production endpoints or consuming paid API quota. |

One initial Python command used a Windows wildcard incorrectly and failed before parsing source; it was not treated as a code failure. The subsequent AST validation was the actual syntax result.

## 8. Gap analysis for a genuine RAG capstone

### 8.1 Minimal RAG workflow required

A portfolio-quality RAG implementation must demonstrate this observable chain:

```text
Document upload
  -> validation and extraction
  -> normalized text + metadata
  -> deterministic chunking
  -> embeddings
  -> persistent vector index
  -> top-k retrieval with scores/metadata
  -> grounded answer prompt
  -> answer + citations/evidence
  -> evaluation against expected evidence
```

None of the document-side stages currently exists.

### 8.2 Recommended hybrid behavior

Preserve the current structured route and add explicit routing:

| User intent | Route | Output |
|---|---|---|
| “Revenue by category” | Structured analytics | Aggregate, chart, KPI, computed insight |
| “What is the refund policy?” | Document RAG | Answer, citations, supporting excerpts |
| “Which region had the highest sales, and what policy explains its returns?” | Hybrid | Structured result plus retrieved policy evidence |
| Ambiguous request | Clarification | Ask whether the user means dataset metrics or uploaded documents |

The router must not let an LLM silently fabricate a document answer when no evidence was retrieved.

## 9. Recommended architecture and minimal viable stack

### 9.1 Architectural principle

Do not introduce a separate backend merely to add RAG. Keep the existing Next.js App Router and add server-only modules/routes. Introduce a persistent store only where serverless memory is inadequate.

### 9.2 MVP components

1. **Document ingestion route**
   - Accept a deliberately scoped set first: `.txt`, `.md`, and optionally `.pdf`.
   - Validate file size, MIME/extension, UTF-8 handling, and empty content.
   - Assign `document_id`, `workspace_id`, filename, checksum, and ingestion status.

2. **Extraction and normalization**
   - Convert each supported document into normalized text.
   - Preserve page/section/heading metadata where available.
   - Reject unsupported or extraction-empty documents with explicit errors.

3. **Chunking**
   - Deterministic token/character target with overlap.
   - Store `chunk_id`, ordinal, document ID, title, page/section, and content hash.
   - Never mix chunks from different workspaces.

4. **Embeddings**
   - Use one server-side embedding provider and configure model/dimensions through environment variables.
   - Batch requests, retry bounded transient failures, and record usage/errors.
   - Cache by content hash and embedding-model version.

5. **Vector persistence**
   - For a Vercel-friendly capstone, use a managed vector store with workspace/document metadata filtering.
   - A Postgres provider with vector support is preferable if relational document metadata and evaluation results are also needed.
   - Do not use an in-memory vector array as the production implementation.

6. **Retrieval**
   - Retrieve top-k candidates with scores and metadata.
   - Add metadata filters for workspace, document, and optionally date/type.
   - Add lexical/hybrid retrieval later if semantic-only retrieval misses exact policy terms.

7. **Grounded generation**
   - Pass retrieved chunks in a clearly delimited context block.
   - Require the answer to cite chunk/source IDs.
   - Require an abstention response when evidence is insufficient.

8. **Hybrid router**
   - Start with deterministic signals and schema/document availability.
   - Use structured analytics for metric/group/filter/time questions.
   - Use RAG for explanatory/document questions.
   - Use both only when the request contains both a measurable dataset operation and a knowledge request.

9. **Evidence response contract**

   ```json
   {
     "answer": "...",
     "mode": "rag",
     "citations": [
       {
         "document_id": "...",
         "filename": "...",
         "chunk_id": "...",
         "page": 3,
         "quote": "...",
         "score": 0.87
       }
     ],
     "grounded": true
   }
   ```

10. **Evaluation**
    - Keep a versioned, non-secret dataset of questions, expected mode, expected document/chunk evidence, and acceptable answer facts.
    - Run retrieval and answer evaluations in CI or a repeatable local command.

### 9.3 Avoid premature scope

Do not begin with multi-agent orchestration, graph RAG, fine-tuning, or multiple vector databases. They add complexity before the core ingestion-to-citation chain is measurable.

## 10. Prioritized implementation roadmap

### Phase 0 — Contract and test foundation

**Status:** MISSING\
**Dependencies:** none\
**Work:**

- Define TypeScript schemas for query mode, document metadata, chunk metadata, retrieval candidates, citations, and errors.
- Add unit-test infrastructure without changing runtime behavior.
- Freeze current structured analytics behavior with fixture-based tests.

**Acceptance criteria:**

- A test command exists.
- Current CSV profile, aggregation, sorting, filter, and fallback behavior have deterministic tests.
- Invalid model output is rejected with a structured error.

### Phase 1 — Durable workspace/document metadata

**Status:** MISSING\
**Dependencies:** Phase 0\
**Work:**

- Add authenticated or signed workspace identity before exposing private documents.
- Add persistent document records and ingestion status.
- Define deletion and ownership semantics.

**Acceptance criteria:**

- A document cannot be retrieved by another workspace.
- Restarting a serverless instance does not erase document metadata.
- Upload, delete, and status transitions are observable.

### Phase 2 — Text ingestion and chunking

**Status:** MISSING\
**Dependencies:** Phase 1\
**Work:**

- Add scoped document formats.
- Extract text and metadata.
- Implement deterministic chunking and fixture snapshots.

**Acceptance criteria:**

- Every stored chunk has document ID, workspace ID, ordinal, content hash, and source location where available.
- Empty, malformed, oversized, and unsupported files fail explicitly.
- Re-uploading the same content is idempotent.

### Phase 3 — Embeddings and vector retrieval

**Status:** MISSING\
**Dependencies:** Phase 2\
**Work:**

- Add provider-configured embeddings.
- Add batching, bounded retries, cache keys, and vector persistence.
- Implement top-k retrieval with metadata filtering and score reporting.

**Acceptance criteria:**

- A fixed retrieval fixture returns the expected evidence in the top-k set.
- Cross-workspace retrieval is impossible through route input.
- Provider failures return actionable errors and do not create false “indexed” status.

### Phase 4 — Grounded RAG answer route

**Status:** MISSING\
**Dependencies:** Phase 3\
**Work:**

- Add a document question route or a mode-aware extension of `/api/query`.
- Prompt the model with delimited retrieved context.
- Enforce citations and abstention.

**Acceptance criteria:**

- Every non-abstained answer cites one or more retrieved chunks.
- Unsupported claims are rejected or marked uncertain.
- No-evidence queries return a clear “I could not find support” response.

### Phase 5 — Hybrid router

**Status:** MISSING\
**Dependencies:** Phase 4; preserve existing structured route\
**Work:**

- Route analytics, RAG, and hybrid questions.
- Keep structured chart/KPI output unchanged for analytics questions.
- Return mode and evidence metadata in the response.

**Acceptance criteria:**

- Router tests cover all three modes and ambiguity.
- A hybrid request returns both computed analytics and document citations.
- A document-only question never silently returns a CSV-only answer.

### Phase 6 — Evaluation and capstone packaging

**Status:** MISSING\
**Dependencies:** Phases 3–5\
**Work:**

- Add a fixed evaluation set.
- Measure retrieval and answer quality.
- Document architecture, trade-offs, latency, cost, and limitations.
- Add a demo dataset and reproducible setup without secrets.

**Acceptance criteria:**

- Evaluation runs locally with one command.
- Results include retrieval recall@k, MRR or nDCG, citation precision, grounded-answer rate, abstention quality, latency, and provider error rate.
- README/demo explains why answers are trustworthy.

## 11. Recommended automated tests and metrics

### Structured analytics tests

- CSV parsing: quoted commas, escaped quotes, CRLF, blank rows, null markers, malformed rows.
- Profiling: numeric/categorical/date/text role detection and missing values.
- Aggregation: sum, mean, count, min, max with and without dimensions.
- Filtering: all operators, invalid fields, invalid categorical values, empty result.
- Sorting: metric, time, month order, ascending/descending.
- Limits and summary semantics.
- Chart specification shape for each supported chart type.
- Upload limits and error responses.

### LLM boundary tests

- JSON extraction with fences, extra prose, malformed JSON, empty response.
- Runtime validation of parser output.
- Unknown metric/dimension/operator rejection.
- Prompt/model provider timeout and quota failure.
- Insight fallback for empty, incomplete, or provider-error output.

### RAG tests

- Extraction fixtures for every supported format.
- Chunk count, overlap, metadata, and deterministic hash snapshots.
- Embedding cache hit/miss behavior.
- Retrieval top-k and workspace isolation.
- Citation IDs must refer to retrieved chunks.
- Abstention when retrieval score is below threshold or context is insufficient.
- Prompt injection content inside documents must not override system instructions.

### Suggested evaluation metrics

- Retrieval recall@k.
- MRR or nDCG.
- Citation precision: cited chunks actually support the claim.
- Citation coverage: answer claims supported by at least one citation.
- Grounded-answer rate.
- Correct abstention rate.
- Structured-query exact-match rate for parsed intent.
- End-to-end answer correctness judged against expected facts.
- P50/P95 ingestion, retrieval, and answer latency.
- Provider failure, retry, and quota rates.
- Cost per indexed document and per answered question.

## 12. Deployment and security considerations

### Required before private/business use

- Authentication and authorization.
- Persistent workspace/document ownership.
- Server-side workspace identity; do not trust a browser-provided ID as authorization.
- Vector metadata filters enforced server-side.
- File type, size, content, and extraction limits.
- Rate limiting and per-workspace quotas.
- Secret rotation and provider spend limits.
- Structured logs with request IDs but no document secrets or API keys.
- Deletion semantics for documents, chunks, embeddings, and cached answers.

### Vercel constraints

- Serverless memory is not durable; do not store uploaded documents or vectors only in module globals.
- Bound route execution time and provider retries.
- Avoid sending full documents to the LLM; retrieve bounded chunks.
- Use a managed persistent vector/metadata service compatible with serverless connections.
- Keep embedding and generation keys server-only.
- Track model and embedding versions in stored metadata so reindexing is deterministic.

### Prompt/data security

- Treat CSV cells and document text as untrusted input.
- Delimit retrieved context and explicitly state that it is reference data, not instructions.
- Do not allow retrieved text to change tools, routing, SQL, or authorization.
- Validate all structured LLM output with a runtime schema before execution.
- Never return raw provider errors containing secrets or internal request details to end users.

## 13. Files likely to require changes in future missions

This is a forward-looking change map, not work performed in this audit.

### Existing files

- [frontend/src/app/page.tsx](./frontend/src/app/page.tsx): mode-aware chat state and evidence display.
- [frontend/src/lib/api.ts](./frontend/src/lib/api.ts): document upload, retrieval, and mode-aware response clients.
- [frontend/src/app/api/query/route.ts](./frontend/src/app/api/query/route.ts): hybrid routing contract or delegation.
- [frontend/src/app/api/upload/route.ts](./frontend/src/app/api/upload/route.ts): keep CSV behavior separate from document ingestion.
- [frontend/src/lib/engine/dataEngine.ts](./frontend/src/lib/engine/dataEngine.ts): preserve structured analytics and add validation.
- [frontend/src/lib/engine/llmParser.ts](./frontend/src/lib/engine/llmParser.ts): validate parser output and possibly classify mode.
- [frontend/src/lib/engine/insightGen.ts](./frontend/src/lib/engine/insightGen.ts): keep deterministic fallback; do not make it the RAG answer generator.
- [frontend/src/lib/types.ts](./frontend/src/lib/types.ts): add runtime-compatible response/domain types.
- [frontend/package.json](./frontend/package.json): only when adding deliberately chosen extraction, validation, embedding, or test dependencies.
- [README.md](./README.md): document actual Next.js deployment and RAG setup once implemented.
- [AI_REFERENCE.md](./AI_REFERENCE.md): update the agent reference after architecture changes.

### Likely future additions

- `frontend/src/app/api/documents/route.ts`
- `frontend/src/app/api/documents/[id]/route.ts`
- `frontend/src/app/api/rag/query/route.ts` or a clearly versioned mode-aware query route
- `frontend/src/lib/rag/ingestion.ts`
- `frontend/src/lib/rag/extraction.ts`
- `frontend/src/lib/rag/chunking.ts`
- `frontend/src/lib/rag/embeddings.ts`
- `frontend/src/lib/rag/vectorStore.ts`
- `frontend/src/lib/rag/retrieval.ts`
- `frontend/src/lib/rag/answer.ts`
- `frontend/src/lib/rag/citations.ts`
- `frontend/src/lib/routing/queryRouter.ts`
- `frontend/tests/` or an equivalent test directory
- `evaluation/` containing non-secret questions, expected evidence, and metric scripts

### Legacy backend decision

Before adding RAG code to Python, explicitly choose one of:

1. Retire the legacy backend and keep all new work in Next.js.
2. Make Python the authoritative backend and migrate deployment deliberately.
3. Keep Python as a separate supported service with contract tests.

Do not add a third implementation.

## 14. Final assessment

### Verified current status

- Structured CSV BI: **IMPLEMENTED**
- Same-origin Next.js API architecture: **IMPLEMENTED**
- Groq query parsing and insight generation: **IMPLEMENTED, provider-dependent**
- CSV upload/profile: **IMPLEMENTED, process-local and non-durable**
- Dashboard/chart generation: **IMPLEMENTED**
- Legacy Python backend: **PARTIAL / UNVERIFIED as production path**
- Document RAG: **MISSING**
- Citations/evidence: **MISSING**
- Hybrid routing: **MISSING**
- Automated tests: **MISSING**
- Evaluation: **MISSING**

### Recommended implementation order

1. Add test and response-contract foundations.
2. Add durable workspace/document metadata and authorization.
3. Implement scoped document extraction and deterministic chunking.
4. Add embeddings and persistent vector retrieval.
5. Add grounded answers with mandatory citations and abstention.
6. Add hybrid routing while preserving CSV analytics.
7. Add evaluation, latency/cost measurement, and capstone documentation.

Until steps 3–6 exist and are evaluated, the project should be described as an AI-assisted conversational BI dashboard, not as a RAG system.
