# DataDarshanam Persistent RAG Implementation Plan

**Mission:** 3 — persistent RAG architecture specification\
**Status:** Design only; no implementation performed\
**Date:** 2026-10-26\
**Repository:** `vijitagarwal/DataDarshan`

## 1. Executive summary

DataDarshanam is currently an LLM-assisted CSV business-intelligence application. The deployed architecture is a Next.js application under `frontend/`, with same-origin route handlers, a TypeScript CSV engine, Plotly specification generation, and Groq calls for structured query parsing and short insights. The legacy FastAPI/Pandas backend is separate and is not part of the production request path verified in the repository.

Persistent document RAG is not implemented. The repository has no authentication, durable document metadata, private object storage integration, document extraction, chunking, embeddings, vector database, retrieval, citations, hybrid router, or RAG evaluation harness.

The recommended implementation preserves the current CSV analytics flow and adds a separately authorized document knowledge flow:

```text
Authenticated browser
  -> same-origin Next.js route
  -> Supabase Auth identity verification
  -> private Supabase Storage object
  -> document metadata and ingestion job
  -> extraction and deterministic chunking
  -> Gemini embedding generation
  -> Supabase Postgres + pgvector
  -> filtered similarity retrieval
  -> Groq grounded answer generation
  -> answer + citation metadata + abstention state
```

The first implementation priority is identity and persistence, not embeddings. A client-generated workspace ID must remain a UI convenience only and must never authorize access to documents or vectors.

## 2. Verified current state

### 2.1 Repository evidence

The following facts were verified from the requested reference documents and source files:

| Area | Verified state | Reusable component |
|---|---|---|
| Web application | Next.js, React, TypeScript under `frontend/` | Existing App Router and same-origin API architecture |
| Analytics | `frontend/src/lib/engine/dataEngine.ts` parses, profiles, filters, aggregates, sorts, and summarizes CSV rows | Structured analytics branch of a future hybrid router |
| LLM query parsing | `frontend/src/lib/engine/llmParser.ts` calls Groq and now performs runtime validation against profiled columns and supported operations | Groq client pattern, response/error contracts, validation boundary |
| Charts | `frontend/src/lib/engine/chartBuilder.ts` creates Plotly-compatible specifications | Existing analytics response rendering |
| Insights | `frontend/src/lib/engine/insightGen.ts` calls Groq with a deterministic fallback | Generation provider pattern; must not be used as evidence by itself |
| API | `frontend/src/app/api/query/route.ts` is the main analytics route; upload, schema, dashboard, and health routes also exist | Same-origin route conventions and structured JSON responses |
| Uploads | `frontend/src/app/api/upload/route.ts` accepts CSV only, limits size/rows/columns, and stores rows in an in-memory map | Validation and error-message conventions only; storage implementation must be replaced for documents |
| Browser identity | `frontend/src/lib/api.ts` sends a random `X-Workspace-ID` from local storage | Non-authoritative UI correlation only; must not be used for authorization |
| Testing | Vitest tests cover the engine, chart builder, insight fallback, parser validation, and `/api/query` route | Test runner, mocking style, route-level test patterns |
| Persistence | TypeScript datasets are process-local; no database or object storage integration exists | None; a new persistence foundation is required |
| RAG | No ingestion, extraction, chunking, embedding, vector, retrieval, citation, or evaluation implementation was found | None |

### 2.2 Important existing behavior to preserve

- The current CSV analytics path remains available and continues to return parsed intent, query results, insight text, fallback status, and dark/light Plotly specifications.
- The current Groq model is configurable through `GROQ_MODEL`; secrets are server-side environment variables.
- The existing parser rejects invalid model-produced analytics queries before `runQuery`.
- Existing API routes are same-origin. A separate backend should not be introduced for RAG.
- The existing `X-Workspace-ID` header is not authentication. Future document routes must derive ownership from Supabase Auth, not from this header.

### 2.3 Assumptions requiring confirmation

These are design assumptions, not current repository facts:

1. Supabase Auth will be acceptable for student authentication and Supabase project-region latency.
2. Supabase Postgres will have the `vector` extension available and permitted for the chosen project tier.
3. Vercel functions will have sufficient execution time and memory for small synchronous ingestion jobs. Larger files will use an asynchronous job pattern.
4. Gemini `gemini-embedding-001` will be available to the project, with a quota and price suitable for the account. Current quota, model availability, request limits, maximum input size, and output dimension must be verified manually from current Google documentation before implementation.
5. Groq will remain the generation provider and will accept the selected grounded-answer prompt and token budget.
6. Initial document limits will be intentionally small enough for a student deployment; exact limits should be configurable rather than hard-coded across routes.

## 3. Target architecture

### 3.1 Components

1. **Browser client**
   - Uses Supabase Auth client-side only for session establishment and refresh.
   - Sends the Supabase access token through the standard `Authorization: Bearer <JWT>` header.
   - Does not receive Supabase service-role credentials.
   - May continue sending `X-Workspace-ID` for legacy CSV behavior, but document routes ignore it for authorization.

2. **Next.js route handlers**
   - Validate authentication, request schemas, file metadata, ownership, and authorization.
   - Use a server-only Supabase client configured with the user JWT for user-scoped reads.
   - Use a separate service-role client only in tightly scoped server-side ingestion operations that require privileged storage or queue operations.
   - Never expose service-role keys, raw provider exceptions, signed URLs beyond their expiry, or unrestricted database queries.

3. **Supabase Auth**
   - Source of the canonical user ID (`auth.uid()`).
   - The JWT is verified by Supabase server helpers or an equivalent server-side verifier.
   - Every document, chunk, and ingestion job is owned by a UUID user ID.

4. **Supabase Storage**
   - Private bucket, for example `documents`.
   - Objects are stored under a deterministic ownership prefix such as `<user_id>/<document_id>/original.<ext>`.
   - The browser uses short-lived signed upload URLs or a controlled upload endpoint.
   - Database metadata is authoritative for ownership; object paths are not trusted as user input.

5. **Supabase Postgres with pgvector**
   - Stores document metadata, chunk text and source metadata, embedding model/version, and vectors.
   - Retrieval always filters by `user_id` or an explicitly authorized collection membership before similarity ordering.
   - RLS is enabled even if all application access normally passes through server routes.

6. **Extraction/chunking worker**
   - Starts as a server-side Next.js ingestion function for small files.
   - If execution or file-size limits are reached, changes to a job table plus a scheduled/worker consumer without changing the document API contract.
   - Extraction libraries are isolated behind format-specific adapters.

7. **Providers**
   - Gemini embedding provider for chunk and query embeddings, subject to quota verification.
   - Existing Groq integration for grounded answer generation.
   - Provider clients are server-only, mockable interfaces with bounded retries and no secret-bearing logs.

### 3.2 Authentication and authorization flow

1. User signs in through Supabase Auth.
2. Browser obtains a short-lived access token and sends it to the Next.js route in `Authorization`.
3. Route rejects missing, expired, malformed, or unverifiable tokens with `401`.
4. Server obtains the authenticated subject (`user_id`) from verified claims or `supabase.auth.getUser()`.
5. Route queries only rows owned by that `user_id`, relying on both:
   - server-side ownership predicates/checks, and
   - database RLS policies using `auth.uid()`.
6. Any document ID supplied by the client is treated as an opaque identifier. The route confirms ownership before reading, deleting, signing, or retrieving it.
7. A service-role client is never used for ordinary user reads. If used for ingestion, the route first creates an owned document record and passes only the server-created document ID to the worker.

### 3.3 Document upload flow

Recommended initial flow: signed direct upload to private Supabase Storage.

1. Authenticated browser sends `POST /api/documents/upload-init` with filename, MIME type, byte size, and optional display name.
2. Route validates extension/MIME/size and creates a document row with `status = 'awaiting_upload'`.
3. Route returns a short-lived signed upload URL or Supabase upload token scoped to the generated object path.
4. Browser uploads bytes directly to the private bucket.
5. Browser calls `POST /api/documents/{id}/complete`, or a storage event/job mechanism marks the upload complete.
6. Server verifies object existence and byte size, then changes status to `queued`.
7. Ingestion extracts text, creates chunks, embeds chunks, and marks the document `ready`, or records a terminal `failed` status and safe error code.
8. Document deletion removes database rows and the private object only after ownership is verified.

For the first student implementation, `complete` may synchronously run ingestion for small files. The API must still expose a status resource so the implementation can become asynchronous without changing the client contract.

### 3.4 Extraction flow

Supported formats:

| Format | Detection | Extraction result |
|---|---|---|
| PDF | `.pdf` plus trusted MIME check | Page-aware text; preserve page number where available |
| DOCX | `.docx` plus trusted MIME check | Paragraph/table text; preserve section or paragraph sequence |
| TXT | `.txt` plus text MIME | UTF-8 text with replacement/error policy |
| Markdown | `.md`/`.markdown` plus text MIME | Markdown source and heading hierarchy; optionally retain plain text plus heading metadata |

Processing rules:

- Do not trust filename extension alone; validate declared MIME, extension, byte signature where practical, and extraction result.
- Reject encrypted/password-protected PDFs initially with a stable `EXTRACTION_UNSUPPORTED` code.
- Reject files with no meaningful extracted text with `NO_TEXT_EXTRACTED`.
- Do not execute macros, embedded scripts, external links, or document relationships.
- Strip or neutralize control characters and enforce a maximum extracted character count.
- Keep original bytes private and immutable. Reprocessing uses the stored object.
- Store extraction version and parser name so future reprocessing is reproducible.

### 3.5 Chunking and metadata preservation

Initial deterministic strategy:

- Normalize line endings and whitespace without destroying meaningful Markdown headings.
- Prefer structural boundaries: PDF pages, DOCX headings/paragraphs, Markdown headings.
- Target approximately 800 tokens per chunk with 120-token overlap.
- Enforce a hard character/token ceiling per chunk.
- Never split a source locator silently; if a page/section boundary is crossed, record all relevant source ranges or choose the dominant range deterministically.
- Preserve:
  - `document_id`
  - `chunk_index`
  - `text`
  - `page_start`, `page_end` where applicable
  - `section_path`
  - source character offsets
  - extraction version
  - content hash

Chunk IDs should be stable for the same document content, extraction version, and chunking configuration. A recommended identity is a UUID generated from a content hash plus chunk index, or a stored UUID with a unique `(document_id, chunk_index, content_hash)` constraint.

### 3.6 Embedding generation and persistence

1. Embed normalized chunk text with `gemini-embedding-001`.
2. Store the exact provider model ID, embedding dimension, task type, and embedding version with every vector.
3. Store the query embedding using the provider’s retrieval/query task configuration if supported.
4. Batch requests conservatively and enforce provider input-size limits.
5. Retry only transient failures with exponential backoff and a small maximum attempt count.
6. Never retry authentication, invalid-request, quota-exhausted, or unsupported-model errors indefinitely.
7. On partial failure, mark the document failed or retry the exact missing chunk set; do not mark a document ready with silently missing vectors.
8. Avoid repeated calls using content hashes and a unique embedding identity. Reuse an existing vector only when model ID, dimension, task configuration, normalized text hash, and embedding version all match.

The vector dimension must be explicitly configured after manual verification of the selected Gemini model. It must not be inferred from the first response or silently changed. A dimension mismatch must fail ingestion with a clear operator-visible error.

### 3.7 Retrieval flow

1. Authenticate the user.
2. Validate query text, collection/document filters, and `top_k` bounds.
3. Embed the query using the same verified model/version.
4. Execute a server-side RPC or parameterized SQL query that:
   - filters `user_id = auth.uid()` before similarity ordering,
   - excludes non-ready documents,
   - optionally filters document IDs that the user owns,
   - orders by cosine distance,
   - returns a bounded top-k result,
   - includes source metadata and a relevance score.
5. Apply a minimum similarity threshold and optional diversity rule.
6. If no result clears the threshold, return an abstention-ready empty evidence set.
7. Never retrieve globally and filter in application memory; that risks cross-user leakage and wastes database work.

Initial retrieval parameters should be configurable:

- `top_k`: default 5, maximum 8.
- Similarity threshold: begin as an evaluation-tuned configuration, not an arbitrary permanent constant.
- Maximum context characters/tokens: bounded before generation.
- Optional per-document result cap to prevent one document dominating every answer.

### 3.8 Grounded answers, citations, and abstention

The answer generator receives:

- the user question,
- a system instruction to answer only from supplied evidence,
- numbered evidence blocks containing chunk text and source metadata,
- explicit instruction to abstain when evidence is insufficient.

The generator should return a validated structured object:

```json
{
  "answer": "string",
  "abstained": false,
  "citations": [
    {
      "chunk_id": "uuid",
      "document_id": "uuid",
      "document_name": "string",
      "page_start": 3,
      "page_end": 3,
      "section_path": ["Policy", "Returns"],
      "quote": "short exact supporting excerpt"
    }
  ]
}
```

Rules:

- Citation IDs must refer only to retrieved chunks supplied to the model.
- Server verifies returned citation IDs against the retrieved evidence before returning them.
- Quotes are selected from retrieved text or validated as substrings with normalization; fabricated source metadata is discarded.
- If no evidence clears the threshold, return `abstained: true`, an actionable message, and an empty citation list.
- If the model returns invalid JSON, unsupported citation IDs, or an answer without required citations when evidence is required, use a safe structured failure or deterministic abstention. Do not return an ungrounded success.
- The UI may display document name, page, section, and a short quote; it must not expose private storage paths.

### 3.9 Hybrid routing

Add a server-side router only after the standalone analytics and RAG branches are reliable. It should classify into:

1. **Structured analytics** — questions about CSV measures, dimensions, filters, trends, rankings, or charts.
2. **Document RAG** — questions about uploaded business documents, policies, contracts, procedures, or narrative facts.
3. **Combined** — questions requiring both CSV computation and document evidence.

Routing must be conservative:

- Prefer explicit user intent and available dataset/document context.
- Never let the router bypass authorization or validation.
- A combined request runs both branches independently, then provides their typed outputs to a final synthesis step.
- If either branch fails, the response identifies which source is unavailable rather than fabricating a unified answer.
- Existing `/api/query` behavior should remain stable until a versioned or explicitly routed hybrid contract is ready.

## 4. Database and storage design

### 4.1 Minimal relational model

The following is proposed migration content for review. It is not executed in Mission 3. The exact vector dimension must be replaced with the verified Gemini dimension before applying the migration.

```sql
create extension if not exists vector;
create extension if not exists pgcrypto;

create type public.document_status as enum (
  'awaiting_upload',
  'queued',
  'processing',
  'ready',
  'failed',
  'deleting',
  'deleted'
);

create type public.ingestion_status as enum (
  'queued',
  'processing',
  'ready',
  'failed'
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  original_filename text not null,
  media_type text not null,
  file_extension text not null,
  byte_size bigint not null check (byte_size > 0),
  storage_bucket text not null default 'documents',
  storage_path text not null unique,
  sha256 text,
  status public.document_status not null default 'awaiting_upload',
  ingestion_error_code text,
  ingestion_error_message text,
  extraction_version text,
  chunking_version text,
  embedding_model text,
  embedding_dimension integer,
  chunk_count integer not null default 0 check (chunk_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  deleted_at timestamptz,
  unique (user_id, id)
);

create index documents_user_created_idx
  on public.documents (user_id, created_at desc);
create index documents_user_status_idx
  on public.documents (user_id, status);
create unique index documents_user_hash_idx
  on public.documents (user_id, sha256)
  where sha256 is not null and deleted_at is null;

create table public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  content text not null check (length(content) > 0),
  content_sha256 text not null,
  page_start integer,
  page_end integer,
  section_path text[] not null default '{}',
  source_start integer,
  source_end integer,
  extraction_version text not null,
  chunking_version text not null,
  embedding_model text not null,
  embedding_dimension integer not null,
  embedding vector(/* VERIFIED_GEMINI_DIMENSION */) not null,
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index),
  unique (document_id, chunk_index, content_sha256)
);

create index document_chunks_document_idx
  on public.document_chunks (document_id, chunk_index);
create index document_chunks_user_idx
  on public.document_chunks (user_id);

-- Use the exact operator class and dimension after verifying the model output.
create index document_chunks_embedding_idx
  on public.document_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 50);

create table public.ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status public.ingestion_status not null default 'queued',
  attempt_count integer not null default 0 check (attempt_count >= 0),
  error_code text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index ingestion_jobs_status_idx
  on public.ingestion_jobs (status, created_at);
create index ingestion_jobs_user_idx
  on public.ingestion_jobs (user_id, created_at desc);

alter table public.documents enable row level security;
alter table public.document_chunks enable row level security;
alter table public.ingestion_jobs enable row level security;

create policy "users read own documents"
  on public.documents for select
  using (auth.uid() = user_id);

create policy "users create own documents"
  on public.documents for insert
  with check (auth.uid() = user_id);

create policy "users update own documents"
  on public.documents for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "users delete own documents"
  on public.documents for delete
  using (auth.uid() = user_id);

create policy "users read own chunks"
  on public.document_chunks for select
  using (auth.uid() = user_id);

create policy "users read own ingestion jobs"
  on public.ingestion_jobs for select
  using (auth.uid() = user_id);

-- Writes from ingestion use a server-side, narrowly scoped path. Do not grant
-- service-role-equivalent access to the browser or anonymous role.
revoke all on public.documents from anon;
revoke all on public.document_chunks from anon;
revoke all on public.ingestion_jobs from anon;
grant select, insert, update, delete on public.documents to authenticated;
grant select on public.document_chunks to authenticated;
grant select on public.ingestion_jobs to authenticated;
```

### 4.2 Retrieval function

Do not expose an arbitrary SQL endpoint. Use a typed RPC or server-side parameterized query whose implementation enforces ownership before vector ordering:

```sql
-- Illustrative shape; apply the verified vector dimension and security design
create or replace function public.match_document_chunks(
  query_embedding vector(/* VERIFIED_GEMINI_DIMENSION */),
  match_count integer,
  similarity_threshold real,
  requested_document_ids uuid[] default null
)
returns table (
  chunk_id uuid,
  document_id uuid,
  document_name text,
  content text,
  page_start integer,
  page_end integer,
  section_path text[],
  similarity real
)
language sql
security invoker
set search_path = public
as $$
  select
    c.id,
    c.document_id,
    d.display_name,
    c.content,
    c.page_start,
    c.page_end,
    c.section_path,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.document_chunks c
  join public.documents d on d.id = c.document_id
  where c.user_id = auth.uid()
    and d.user_id = auth.uid()
    and d.status = 'ready'
    and d.deleted_at is null
    and (
      requested_document_ids is null
      or c.document_id = any(requested_document_ids)
    )
    and 1 - (c.embedding <=> query_embedding) >= similarity_threshold
  order by c.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 8);
$$;
```

Before applying this function, verify that `SECURITY INVOKER`, RLS, and the selected Supabase client preserve `auth.uid()` for the request. If the ingestion client is service-role based, it must never be used for user retrieval.

### 4.3 Ownership and deletion semantics

- `user_id` is copied onto chunks and jobs to make ownership checks explicit and indexable; database constraints and server checks must keep it consistent with the document owner.
- Deleting a document requires ownership verification, marks it `deleting`, removes the storage object, and then deletes the database row or marks it `deleted` according to the retention policy.
- `on delete cascade` removes chunks and jobs when the document row is permanently deleted.
- If storage deletion fails, retain a terminal database state and an operator-visible error rather than claiming success.
- Account deletion should cascade through documents, chunks, jobs, and storage cleanup. Storage cleanup may require a scheduled reconciliation job.
- Do not allow users to change `user_id`, storage bucket, storage path, embedding model, or embedding dimension through ordinary update routes.

### 4.4 Storage policy

Create a private bucket named `documents`. Storage object policies should restrict access to an authenticated user path matching their UID, or storage access should be performed only through short-lived server-generated signed URLs after a database ownership check. The service-role key, if used, must be server-only and excluded from client bundles and logs.

## 5. Proposed API contracts

All document/RAG routes require `Authorization: Bearer <Supabase access token>`. A missing or invalid token returns:

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHENTICATED",
    "message": "Authentication is required."
  }
}
```

Status: `401`.

### 5.1 Initialize upload

`POST /api/documents/upload-init`

Request:

```json
{
  "filename": "return-policy.pdf",
  "media_type": "application/pdf",
  "byte_size": 482193,
  "display_name": "Return policy"
}
```

Validation:

- Supported extension/MIME pair.
- Non-empty safe display name.
- Byte size within the configured initial limit.
- No path traversal or client-supplied storage path.

Success (`201`):

```json
{
  "success": true,
  "document": {
    "id": "uuid",
    "status": "awaiting_upload",
    "display_name": "Return policy",
    "filename": "return-policy.pdf",
    "media_type": "application/pdf",
    "byte_size": 482193
  },
  "upload": {
    "bucket": "documents",
    "path": "user-id/document-id/original.pdf",
    "signed_url": "short-lived-url",
    "expires_at": "timestamp"
  }
}
```

The response must not include service credentials.

### 5.2 Complete upload / start ingestion

`POST /api/documents/{document_id}/complete`

Request:

```json
{
  "sha256": "optional-client-hash"
}
```

The server verifies the authenticated owner, object existence, object size, and optional hash. It returns:

```json
{
  "success": true,
  "document_id": "uuid",
  "status": "queued",
  "job_id": "uuid"
}
```

For a synchronous small-file implementation, `status` may become `ready` before the response returns. The client must still handle `queued`, `processing`, `ready`, and `failed`.

### 5.3 Ingestion status

`GET /api/documents/{document_id}`

Success:

```json
{
  "success": true,
  "document": {
    "id": "uuid",
    "display_name": "Return policy",
    "status": "ready",
    "chunk_count": 14,
    "created_at": "timestamp",
    "updated_at": "timestamp",
    "error": null
  }
}
```

Failure:

```json
{
  "success": true,
  "document": {
    "id": "uuid",
    "status": "failed",
    "error": {
      "code": "EXTRACTION_UNSUPPORTED",
      "message": "The document could not be extracted."
    }
  }
}
```

Do not return raw stack traces, provider responses, storage paths, or secret values.

### 5.4 List and delete documents

- `GET /api/documents` returns only the authenticated user’s documents, with bounded pagination and status filters.
- `DELETE /api/documents/{document_id}` requires ownership and returns `{ "success": true, "status": "deleting" }` or `deleted`.
- Missing documents should return `404` without revealing whether another user owns the ID.
- Deleting an already deleted document may be idempotent.

### 5.5 RAG query

`POST /api/rag/query`

Request:

```json
{
  "query": "What is the return window for damaged items?",
  "document_ids": ["optional-owned-document-uuid"],
  "top_k": 5
}
```

Success with evidence:

```json
{
  "success": true,
  "answer": "Damaged items may be returned within 30 days.",
  "abstained": false,
  "citations": [
    {
      "chunk_id": "uuid",
      "document_id": "uuid",
      "document_name": "Return policy",
      "page_start": 3,
      "page_end": 3,
      "section_path": ["Returns", "Damaged items"],
      "quote": "Damaged items may be returned within 30 days..."
    }
  ],
  "retrieval": {
    "top_k": 5,
    "returned": 2
  }
}
```

Abstention:

```json
{
  "success": true,
  "answer": "I could not find enough evidence in your uploaded documents to answer that.",
  "abstained": true,
  "citations": [],
  "retrieval": {
    "top_k": 5,
    "returned": 0
  }
}
```

Validation/provider failures:

- `400 INVALID_REQUEST` for missing/empty query, invalid UUIDs, unsupported `top_k`, or malformed JSON.
- `401 UNAUTHENTICATED` for missing/invalid identity.
- `403 FORBIDDEN` only when the API needs to distinguish an unauthorized collection request; otherwise `404` is preferable to avoid resource enumeration.
- `409 DOCUMENT_NOT_READY` when an explicitly selected document is still processing.
- `429 PROVIDER_QUOTA` for known rate/quota exhaustion, with no provider secret details.
- `502 PROVIDER_UNAVAILABLE` for bounded transient provider failure after retries.
- `500 INTERNAL_ERROR` for unexpected failures, with correlation ID in logs but not stack traces in the response.

### 5.6 Combined query

Do not overload the current `/api/query` response immediately. Introduce a versioned or explicit hybrid route, for example `POST /api/assistant/query`, with:

```json
{
  "query": "Which category had the highest revenue, and what policy explains its returns?",
  "include_analytics": true,
  "include_documents": true
}
```

The response should contain typed `analytics`, `documents`, and `answer` sections. Each section reports its own failure or absence. The final answer may cite only document evidence and must not present CSV-derived values as document citations.

## 6. File processing and deployment constraints

### 6.1 Initial limits

Start conservatively and make limits environment-configurable:

- Maximum file size: 10 MB for synchronous ingestion.
- Maximum extracted text: 2,000,000 characters.
- Maximum pages/paragraph units: 2,000.
- Maximum chunks per document: 5,000.
- Maximum chunk size: approximately 800 tokens.
- Overlap: approximately 120 tokens.
- Maximum RAG context: approximately 8,000–12,000 tokens, tuned against Groq context limits.
- Maximum `top_k`: 8.

These are proposed safety defaults, not provider guarantees. Measure actual Vercel execution time and memory before increasing them.

### 6.2 Vercel upload strategy

**Direct signed upload — recommended**

- Browser sends metadata only to Next.js.
- Next.js authenticates and creates an owned document row.
- Browser uploads bytes directly to private Supabase Storage.
- Advantages: avoids Vercel request-body limits, lowers function memory, supports resumable/storage-native behavior, and keeps application routes focused on authorization.
- Risks: requires completion verification, signed URL expiry handling, and cleanup of abandoned objects.

**Routing bytes through Next.js — fallback only**

- Browser sends multipart content to a route.
- Route validates and uploads to Supabase Storage.
- Advantages: one endpoint and simpler early prototype.
- Risks: Vercel request-body and function-duration limits, memory pressure, duplicate buffering, and greater denial-of-service exposure.

Do not assume the documented platform limit is constant across Vercel plans or runtimes. Verify the current plan-specific request-body, duration, memory, and streaming behavior before selecting a synchronous threshold.

### 6.3 Serverless execution

- Keep extraction and embedding work bounded and observable.
- Use an ingestion job row with idempotent status transitions.
- A worker must claim jobs safely and update heartbeat/error fields.
- Never run unbounded retries inside one request.
- If a document cannot finish within the function budget, return `queued` and continue asynchronously.
- Keep temporary files in memory only for small files; otherwise use private storage and stream/download in bounded chunks where the runtime supports it.

## 7. Provider and cost strategy

### 7.1 Embeddings

Candidate: Google Gemini `gemini-embedding-001`.

Required manual verification before implementation:

- Current model availability for the selected Google AI/Vertex API.
- Exact embedding dimension and whether it is configurable.
- Task types for document and query embeddings.
- Maximum input size, batch behavior, rate limits, pricing, and student/free quota.
- Data handling and retention terms appropriate for uploaded business documents.

This plan intentionally does not claim a free quota or cost because quotas change and were not externally verified in this design-only mission.

Required environment variables, names proposed for implementation:

```env
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_STORAGE_BUCKET=documents
GOOGLE_GENERATIVE_AI_API_KEY=...
RAG_EMBEDDING_MODEL=gemini-embedding-001
RAG_EMBEDDING_DIMENSION=verified-before-migration
RAG_CHUNKING_VERSION=v1
RAG_SIMILARITY_THRESHOLD=verified-by-evaluation
```

Only the anon key may be exposed to a browser Supabase client. The service-role and Google provider keys must be server-only. Existing `GROQ_API_KEY` and `GROQ_MODEL` remain server-only.

### 7.2 Generation

Reuse the existing Groq SDK integration and model configuration for grounded answer generation. Add a separate prompt/client function rather than changing the structured analytics parser. Validate the generated answer object and citations exactly as the parser validates analytics output.

Generation controls:

- Low temperature for factual grounded answers.
- Bounded max tokens.
- One bounded retry only for malformed structured output.
- No retry for invalid credentials, quota exhaustion, or unsupported model.
- Redact provider error bodies from client responses and logs.

### 7.3 Caching and quota protection

- Cache embeddings by normalized content hash, model ID, task type, and embedding version.
- Do not re-embed unchanged chunks during a retry or reprocessing operation.
- Cache query embeddings briefly only if query privacy and user scope are acceptable; otherwise skip query caching.
- Deduplicate identical uploads by per-user SHA-256 where policy permits.
- Limit per-user concurrent ingestion jobs.
- Track provider request counts, failures, latency, and token/input sizes without storing secrets or unnecessary document content.
- Return `429` or a safe queued state when local quotas are exhausted.

### 7.4 Provider comparison

| Concern | Gemini embeddings + Groq generation | Single-provider embeddings/generation | Local embeddings |
|---|---|---|---|
| Fit to requirements | Explicitly requested and reuses current Groq path | Fewer integrations but changes current generation architecture | No API quota but difficult on Vercel |
| Cost | Potentially low, subject to current quotas/pricing | Must verify both capabilities and quotas | Runtime/hosting cost and model packaging |
| Operational complexity | Two provider contracts and two failure modes | One provider dependency | High memory/cold-start risk |
| Recommendation | Preferred initial architecture after quota/dimension verification | Keep as fallback option | Not recommended for first deployment |

## 8. Testing and evaluation

### 8.1 Unit tests

Add deterministic tests for:

- MIME/extension/signature validation.
- Filename normalization and path traversal rejection.
- Upload limit enforcement.
- PDF/DOCX/TXT/Markdown extraction adapters with fixtures.
- Empty/encrypted/corrupt extraction failures.
- Chunk boundaries, overlap, stable IDs, and source metadata.
- Embedding cache keys and dimension validation.
- Retrieval parameter bounds.
- Citation ID and quote validation.
- Grounded response schema validation and abstention.
- Authorization helper behavior for missing, mismatched, and valid user IDs.
- Status transition rules and idempotent retries.

### 8.2 Integration and authorization tests

- Authenticate a test user and create a document.
- Verify another user cannot list, read, sign, retrieve, or delete it.
- Verify RLS blocks direct cross-user row access.
- Verify retrieval filters ownership before similarity ordering.
- Verify storage paths cannot be changed by the client.
- Verify deleted documents are absent from retrieval and citations.
- Mock Gemini and Groq provider responses; test timeout, malformed output, quota, and transient errors.
- Test upload completion and ingestion status transitions.
- Test `/api/rag/query` with ready, processing, failed, and nonexistent documents.
- Test combined analytics/RAG failure isolation.

### 8.3 Golden evaluation dataset

Create a versioned, non-sensitive fixture set of 3–5 small documents across PDF, DOCX, TXT, and Markdown. Label:

- source document,
- page/section,
- expected evidence chunk IDs or source spans,
- answer facts,
- unanswerable questions,
- distractor passages,
- multi-document questions,
- authorization scenarios.

Initial target: 30 questions:

- 15 directly answerable single-document questions,
- 5 multi-hop or multi-document questions,
- 5 unanswerable/abstention questions,
- 5 hybrid CSV-plus-document questions.

The expected evidence should be maintained independently of the model output and reviewed manually before use.

### 8.4 Metrics and initial gates

Measure by test set and by question class:

- **Recall@k:** expected evidence retrieved in top-k.
- **MRR:** rank of the first expected evidence chunk.
- **Citation precision:** returned citations that support the answer and belong to retrieved evidence.
- **Citation coverage/recall:** required supporting facts covered by citations.
- **Grounded-answer rate:** answers judged supported by retrieved evidence.
- **Abstention precision:** unanswerable questions abstained from without unsupported claims.
- **Answer correctness:** rubric or manually labeled fact correctness.
- **Latency:** p50/p95 upload completion, ingestion, retrieval, and total answer time.
- **Provider failure rate:** grouped by provider and error code.
- **Cross-user leakage count:** must be zero.

Suggested pre-release gates for the first milestone, subject to calibration:

- Cross-user leakage: 0.
- Citation precision: at least 0.95.
- Grounded-answer rate on answerable questions: at least 0.90.
- Abstention precision on unanswerable questions: at least 0.90.
- Recall@5: at least 0.85.
- p95 retrieval latency: under 500 ms in the deployed region, excluding provider embedding time.

These are engineering gates to tune with the small fixture set, not claims about current system performance.

## 9. Ordered implementation missions

Each mission should be independently reviewable and deployable. Do not begin a later mission until its prerequisites and acceptance criteria pass.

### Mission 4 — Authentication and persistence foundation

**Dependencies:** none beyond current Next.js application.\
**Scope:**

- Add Supabase Auth session handling.
- Add server-side token verification helper.
- Add server-only Supabase clients.
- Create and review the database/storage migration.
- Add RLS and ownership tests.
- Keep existing CSV route behavior unchanged; do not reinterpret the legacy workspace ID as identity.

**Expected files:** Supabase migration files, server auth/client helpers, environment example updates only when implementation is authorized, auth tests, narrowly scoped route guards.\
**Acceptance:** authenticated test user can be identified server-side; unauthenticated document requests return `401`; direct cross-user database access is denied; service-role key is absent from client output.\
**Rollback:** remove new document routes and disable auth-gated document UI; retain existing analytics routes.

### Mission 5 — Secure document upload and metadata

**Dependencies:** Mission 4.\
**Scope:**

- Implement upload-init, completion, listing, status, and deletion routes.
- Create private bucket and signed direct-upload flow.
- Validate metadata and ownership.
- Add abandoned-object cleanup strategy.

**Expected files:** document routes, storage helpers, validation schemas, client upload API, route tests.\
**Acceptance:** users can upload only supported files to their private path; another user cannot read/sign/delete them; status is durable and deletion is idempotent.\
**Rollback:** disable document upload routes and remove only created metadata/storage objects.

### Mission 6 — Extraction and chunking

**Dependencies:** Mission 5.\
**Scope:**

- Add format adapters for PDF, DOCX, TXT, and Markdown.
- Implement bounded extraction, normalization, chunking, and metadata persistence.
- Add idempotent ingestion status transitions.

**Expected files:** extraction adapters, chunker, ingestion service/worker, fixtures, tests.\
**Acceptance:** all four supported formats produce deterministic chunks and source metadata; corrupt/empty/unsupported files fail safely; no document is marked ready with zero or missing chunks.\
**Rollback:** mark affected jobs failed and preserve original objects for reprocessing.

### Mission 7 — Embeddings and vector retrieval

**Dependencies:** Missions 4–6 and manual Gemini verification.\
**Scope:**

- Integrate the verified Gemini embedding model.
- Enforce model/dimension/version identity.
- Add cache/deduplication and bounded retry behavior.
- Add pgvector retrieval RPC with ownership and ready-state filters.

**Expected files:** provider adapter, embedding cache logic, retrieval service, migration/RPC updates, mocked provider and retrieval tests.\
**Acceptance:** chunks have vectors of the configured dimension; retrieval returns only owned ready-document chunks with scores and metadata; provider failures are classified and bounded.\
**Rollback:** disable new ingestion/retrieval while preserving document metadata and original files; reprocess after provider correction.

**Implementation staging update (Mission 7C):** treat persistence and retrieval as separate deliverables. Mission 7C introduces versioned, owner-scoped embedding persistence and idempotent processing only; it does not add vector similarity indexes or retrieval RPCs. The configured 768-dimension schema is a proposed, fixed initial space and requires manual verification against the intended Supabase project before applying the migration. Gemini and live Supabase behavior remain unverified until exercised with authorized non-production credentials.

### Mission 8 — Grounded answers and citations

**Dependencies:** Mission 7.\
**Scope:**

- Add `/api/rag/query`.
- Add Groq grounded-answer prompt and structured validator.
- Verify citations against retrieved chunks.
- Implement abstention and provider error contracts.

**Expected files:** RAG route, prompt/provider adapter, response schemas, citation validator, tests.\
**Acceptance:** answerable questions return supported citations; unanswerable questions abstain; fabricated or unknown citation IDs never reach the client; no provider secret appears in responses.\
**Rollback:** return a controlled “knowledge answers unavailable” response and leave retrieval data intact.

### Mission 9 — Hybrid analytics/RAG routing

**Dependencies:** Missions 0–2 and Mission 8.\
**Scope:**

- Add explicit route or versioned assistant contract.
- Route structured, document, and combined questions.
- Preserve existing `/api/query` behavior for legacy analytics clients.
- Define synthesis rules separating CSV facts from document citations.

**Expected files:** router, hybrid route, request/response types, route tests, UI API client updates.\
**Acceptance:** each class reaches the correct branch; combined failures are explicit; citations refer only to documents; analytics output remains correct.\
**Rollback:** disable hybrid route and keep separate analytics/RAG endpoints.

### Mission 10 — Evaluation, observability, and deployment hardening

**Dependencies:** Missions 4–9.\
**Scope:**

- Add the golden dataset and evaluation runner.
- Measure retrieval, citation, grounding, abstention, latency, and provider failures.
- Add structured logs/metrics with redaction.
- Verify Vercel limits, Supabase RLS, storage policies, environment configuration, and rollback procedure.

**Expected files:** evaluation fixtures/runner, CI commands, operational documentation, dashboards or log conventions, deployment checks.\
**Acceptance:** metrics are reproducible; gates are enforced; zero cross-user leakage is demonstrated; a failed provider or ingestion job has a safe recovery path.\
**Rollback:** disable RAG/hybrid routes without altering the established CSV analytics path.

## 10. Unresolved decisions and risks

1. **Gemini model dimension and quota:** must be verified before migration because vector dimensions are schema-level decisions.
2. **Supabase Auth UX:** choose email/password, magic link, or OAuth; this affects UI scope but not server authorization.
3. **Ingestion execution model:** synchronous small-file processing is simplest, but Vercel duration may require a worker or scheduled job.
4. **Storage upload completion:** choose client callback versus storage event; both require server-side object verification.
5. **Embedding data policy:** confirm whether student/sample documents may be sent to the selected provider.
6. **Chunk size and threshold:** tune on the golden set rather than assuming generic values are optimal.
7. **Document sharing:** initial implementation should be private per user. Shared workspaces or team membership should be a separate authorization design, not inferred from the existing workspace header.
8. **Deletion retention:** decide whether legal/audit retention is required; default recommendation is user-initiated hard deletion with asynchronous storage reconciliation.
9. **Hybrid answer semantics:** define whether combined answers require at least one document citation, a CSV result, or both for a successful response.
10. **Provider budget controls:** establish per-user and project-wide limits before enabling uploads or embeddings in production.
11. **Sensitive content:** business documents may contain personal or confidential data. Add privacy notice, logging redaction, retention rules, and provider data-processing review before real customer use.
12. **Legacy backend divergence:** do not implement RAG in the FastAPI backend unless deployment architecture explicitly changes. Duplicating the RAG pipeline would create inconsistent authorization and evaluation behavior.

## 11. Final status

This document is an implementation plan only. DataDarshanam does **not** have persistent RAG functionality yet. No application code, configuration, package, lockfile, migration, environment file, deployment setting, Supabase project, provider API, or existing documentation was modified for this mission.
