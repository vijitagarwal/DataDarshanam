# Frontend testing

Run the deterministic unit tests with:

```bash
npm test
```

The suite covers the TypeScript data engine, chart specifications, deterministic insight fallback, LLM output validation, and the actual `/api/query` route handler with mocked provider and downstream stages. It does not require a Groq API key or a production service.

The tests do not invoke the live LLM provider. Parser output is validated deterministically against the profiled dataset, while provider integration and quota behavior remain outside the local suite.

Supabase authentication and document ownership tests use mocked clients. They do not require a Supabase project or credentials.

The CSV upload route reads the request stream into a bounded buffer before multipart parsing, including requests without `Content-Length`. The application accepts CSV files up to 25 MiB, but Vercel Functions currently limit request bodies to 4.5 MB; uploads above that platform limit require a future authenticated signed direct-to-Storage flow or a hosting path with a larger ingress limit.

Mission 10 adds deterministic tests for:

- RFC-compliant quoted fields and embedded newlines, currency coercion, strict UTF-8, malformed rows, duplicate headers, and parser row/column limits.
- Verified-user dataset selection, fail-closed missing/custom IDs, owner-filtered dataset listing and lookup, the existing five-row Laptop/Phone/Tablet regression, and upload quota handling.
- Authenticated upload, listing, and deletion route behavior using mocked Supabase and Storage boundaries.

These tests do not execute the SQL migration or prove live Supabase RLS, Storage policy behavior, `SECURITY DEFINER` reservation locking, object cleanup after process interruption, account quotas under concurrent transactions, or two-user isolation. Those checks must be run against the verified non-production staging project before Preview readiness is claimed.

Document upload, listing, completion, and deletion route tests use mocked authentication, database, and Storage boundaries. Live Supabase RLS, Storage policies, signed-upload enforcement, and cleanup behavior still require integration tests against a non-production Supabase project.

Mission 6 adds deterministic tests for:

- UTF-8 text and Markdown normalization.
- PDF/DOCX signature checks and malformed-document mapping.
- Extracted-character limits and safe parser errors.
- Ordered character chunking, overlap, Unicode, source offsets, and chunk-count limits.
- Ownership-scoped ingestion processing, atomic persistence RPC invocation, retry-safe status mapping, and sanitized failures.
- The bounded document-processing route.
- Canonical zero-based, end-exclusive UTF-16 offsets across joined segments, Unicode text, and chunks crossing segment boundaries.

The valid PDF and DOCX cases use small in-memory fixtures; `jszip` is a development-only fixture generator and is not imported by the production extraction service.

The PDF and DOCX tests use small in-memory inputs and do not require a Supabase project. A real ingestion run still requires the Mission 4 and Mission 6 migrations, a configured private Storage bucket, and a server-only service-role key. The processing route is intentionally bounded by upload size, extracted characters, PDF pages, chunk count, and parser timeout; a production deployment should invoke it from a controlled worker or scheduler rather than from an unbounded request chain.

Mission 7B adds mocked embedding-provider contract tests. They do not call Google, require a Gemini key, persist vectors, or verify live model access/quota.

Mission 7B.1 uses the installed `@google/genai` SDK's `models.countTokens` API to count each exact formatted input before embedding. The stable `gemini-embedding-001` default is capped at 2,048 tokens per individual input; the application also applies a configurable aggregate request budget (`GEMINI_EMBEDDING_MAX_REQUEST_TOKENS`) and keeps each request within the 32-input SDK adapter bound. The 8,000-character token-count request window is only a payload-safety bound, never a token estimate. Inputs are split only at Unicode code-point boundaries, with no overlap or dropped text; derived offsets remain zero-based, end-exclusive UTF-16 offsets into canonical text. No Mission 6 stored chunks or extraction text are modified.

Google's token-counting API requires a live network request. Unit tests mock it and prove control flow, offset preservation, and safe error handling; they do not prove actual Gemini tokenization, model availability, credentials, or quota. Response vectors are paired with inputs by the SDK's documented positional order; the API response has no input IDs with which to independently detect an out-of-contract reorder. Live checks are **UNVERIFIED** because no Gemini key is configured. To verify manually, set the server-only `GEMINI_API_KEY` for a non-production environment, use a non-sensitive fixture, call `models.countTokens` for `gemini-embedding-001`, confirm the measured count below/at/above the configured limit, then issue one matching `embedContent` request. Do not use private documents. Authentication, rate-limit, quota, and network failures must remain sanitized; only bounded timeout/transient/rate-limit retry attempts are permitted.

Mission 7C adds server-only embedding persistence tests with mocked Supabase and Gemini boundaries. The implementation uses a separate `document_chunk_embeddings` table and transactionally enforced idempotency RPCs; derived input offsets remain zero-based, end-exclusive UTF-16 offsets and are validated in JavaScript because PostgreSQL character positions are not equivalent to JavaScript UTF-16 code units. The selected normalization identity is `l2-unit-v1`; both document and query vectors are normalized by the provider adapter before use. The migration has not been applied, and mocked tests do not prove live grants, RLS, `SECURITY DEFINER` behavior, pgvector installation/dimension support, SQL concurrency, or Vercel runtime behavior.

Mission 8 adds a mocked authenticated retrieval route and service. Retrieval uses the same server-side Gemini provider identity as persistence, a user-JWT Supabase client, and a database RPC that derives ownership from `auth.uid()`. It returns only canonical source chunk text and citation-ready document/chunk/offset metadata; stored vectors and service-role credentials are never returned. Similarity uses pgvector cosine distance, aggregates multiple derived embedding parts to one best score per canonical chunk, then returns the requested top results. The default limit is 5, bounded to 1–20; no similarity threshold is applied because no relevance evaluation has calibrated one.

Mission 8 unit tests do not execute SQL or prove RLS, function grants, extension schema, pgvector operator resolution, cross-user isolation, or ranking against PostgreSQL. The Mission 7C and Mission 8 migrations have not been applied. Verify those behaviors against a non-production Supabase project, including two users, owner/document scope, ready-state filtering, SQL result ordering, and direct RPC access. Gemini query embedding and Vercel runtime behavior also remain unverified live.

Mission 9 adds a mocked authenticated `POST /api/answers` route. It calls the retrieval service directly with the verified user's JWT client, then passes only bounded retrieved evidence to a dedicated Groq generation path. Empty retrieval results return `no_evidence` without a Groq call. The model must return an `answered` or `insufficient_evidence` JSON result and stable retrieved chunk IDs; the server validates every ID and constructs source metadata from the retrieval records. Untrusted document text is isolated as evidence and explicitly must not be followed as instructions. Answers are paraphrases; inline citations, page numbers, links, IDs, and quotation marks are rejected so future clients consume server-built source objects instead.

Mission 9 mocks Groq, Gemini, and Supabase. It does not prove prompt-injection resistance, factual grounding, citation correctness for all generated text, live provider behavior, or database authorization. No live Groq, Gemini, Supabase, or Vercel check has been executed. The Mission 7C/8 migrations remain unapplied; do not enable this endpoint for production until non-production database/provider verification and evaluation have passed.
