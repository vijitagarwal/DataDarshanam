# DataDarshanam Mission 7C — Embedding Persistence Completion

## Scope and outcome

Mission 7C adds persistence for embeddings over the existing Mission 6 chunks. It does not add retrieval, similarity search, an index, RAG answers, citations, or changes to `/api/query`. The legacy FastAPI backend was not modified. No migration was applied and nothing was deployed.

The authenticated endpoint is `POST /api/documents/[documentId]/embeddings`. It loads only a ready document owned by the authenticated user, prepares the existing chunks, embeds missing inputs, persists them through narrowly granted database functions, and marks the job ready only after the expected parts exist. Existing Mission 6 chunk text and offsets are not changed.

Embedding-space identity includes provider, model, dimension, document/query task, normalization policy, and version. Document and query vectors use the same local `l2-unit-v1` normalization policy. The persistence implementation currently accepts the verified stable `gemini-embedding-001` configuration at 768 dimensions; changing the model or dimension requires an explicit new embedding identity and schema review.

## Changes made for Mission 7C

- `supabase/migrations/20261027010000_mission7c_embedding_persistence.sql`
  - Adds the embedding-job, immutable expected-part manifest, and `document_chunk_embeddings` tables.
  - Adds composite owner/document/chunk foreign keys, owner-readable job status, and RLS with no authenticated embedding/manifest DML grants.
  - Adds `SECURITY DEFINER` claim, batch-persist, finish, and fail RPCs with pinned `search_path`; execution is revoked from `PUBLIC`, `anon`, and `authenticated`, and granted to `service_role`.
  - Uses a 768-dimensional pgvector column, uniqueness constraints, job leases, claim IDs, and manifest checks. It deliberately creates no vector similarity index.
- `frontend/src/lib/embeddings/embeddingService.ts` and `embeddingService.test.ts`
  - Add bounded, owner-scoped embedding processing; manifest/hash validation; retry-aware claims; reuse of identical saved parts; and validation of existing and newly returned vector dimensions, finite values, and unit norm.
  - A document lookup database error is surfaced as a sanitized persistence failure rather than being confused with a missing document.
- `frontend/src/app/api/documents/[documentId]/embeddings/route.ts` and `route.test.ts`
  - Add an authenticated server-side endpoint with safe public status and error responses.
- `frontend/src/lib/embeddings/provider.ts`, `gemini.ts`, `gemini.test.ts`, and `provider.test.ts`
  - Include the normalization policy in embedding identity and normalize both document and query vectors consistently.
- `frontend/.env.example`, `frontend/TESTING.md`, and `DATADARSHANAM_RAG_IMPLEMENTATION_PLAN.md`
  - Document server-only configuration, mock/live verification boundaries, and the staged persistence scope.

The repository worktree also contains earlier Mission 0–7B changes and reports. They were preserved; this completion report does not claim those other pre-existing worktree changes were introduced by Mission 7C.

## Persistence and safety behavior

- The persistence table is separate from `document_chunks`, retaining source-chunk ID, derived-part index, source and provider-input hashes/text, source offsets, embedding identity, and vector.
- Source offsets are retained as zero-based, end-exclusive JavaScript UTF-16 offsets. The service verifies derived text against source slices in JavaScript; PostgreSQL character positions are not treated as UTF-16 offsets.
- Composite foreign keys require each job, manifest part, embedding, document, and source chunk to agree on ownership and document identity. Deleting the owning document or source chunk cascades its dependent records.
- The claim RPC serializes work using row locks and a lease. A concurrent active claim returns `processing`; stale claims may be reclaimed. Batch persistence is transaction-bound to the RPC call and checks the claim and manifest. Finalization checks expected-part completeness. Unique keys and exact identity checks prevent silently overwriting conflicting vectors.
- Reprocessing in the same embedding space reuses matching persisted parts. A changed source, prepared input, or identity is not silently overwritten.
- Application bounds include at most 2,000 source chunks, 10,000 prepared parts, and batches of 32. Provider-side token limits and aggregate request limits remain those implemented by the Mission 7B.1 adapter.
- Processing is synchronous in the API request. Those application bounds do not prove that a particular Vercel runtime can complete a largest-allowed job within its CPU, memory, or request-time limits. A controlled worker may be required before production use.
- The manifest and embedding records contain document-derived input text. Access is restricted by the intended server-side/service-role boundary; retention, backup, and operational access must be reviewed for the target Supabase project.

## Verification results

Executed from `frontend`:

| Command | Result |
|---|---|
| `npm test` | PASS — 21 test files, 91 tests |
| `npm run lint` | PASS — 0 errors; 2 existing `ChartView.tsx` hook-dependency warnings |
| `npm run build` | PASS — Next.js production build and its TypeScript validation completed |
| `npx tsc --noEmit` | FAIL — existing test typing errors: 9 `Request` versus `NextRequest` errors in `src/app/api/query/route.test.ts`, and 3 `rpc` property errors in `src/lib/ingestion/ingestionService.test.ts`. The production build's TypeScript validation passed. |
| `git diff --check` | PASS — no whitespace errors; Git emitted line-ending conversion warnings for existing modified files. |

The unit tests mock Gemini and Supabase. They cover idempotent reuse, partial persistence/retry, conflicts, processing claims, input identity, vector validity, route authentication/error mapping, and sanitized database lookup failures. They do not establish database transaction, concurrency, grants, RLS, pgvector, provider access, or deployment runtime behavior.

## Migration and live verification status

**UNVERIFIED — no live Supabase or Gemini execution was performed.** No relevant Gemini API key or Supabase service-role configuration was available in the inspected environment/configuration. Local `psql` and Supabase CLI tooling were unavailable. The SQL was reviewed locally but was not parsed or executed by PostgreSQL. Do not treat migration assumptions or mocked RPC tests as proof of live security.

Before any production use:

1. Use a dedicated non-production Supabase project and back up its schema/data. Confirm the existing Mission 4/6 migrations are applied and that the `extensions` schema, `vector` extension, `public.touch_updated_at()` function, roles, and required foreign-key columns match this migration.
2. Apply the migration only to that non-production project through the team's normal migration workflow. Confirm the resulting vector column dimension and inspect all constraints, policies, function definitions, function `search_path`, and effective grants.
3. Verify that `authenticated`/`anon` cannot execute any of the four RPCs or read/write embedding and manifest tables; confirm `authenticated` can read only its own job rows and `service_role` has the intended function execution rights.
4. Create two non-production users and ready documents. Call the endpoint with each user's bearer token; verify only that owner's job is visible and that a different owner cannot access or trigger processing for the document.
5. With an authorized non-production Gemini key configured server-side, process a small non-sensitive fixture. Verify the expected part count, `ready` state, 768 finite values with unit norm, source mapping, and `l2-unit-v1` identity. Repeat the same request and confirm exact parts are reused.
6. Submit simultaneous requests for one document and confirm only one active claim, then simulate an interrupted/failed attempt and retry after the lease/recovery path. Confirm no duplicate parts, no stale claim can finish, and `ready` is reached only when every manifest part is present.
7. Confirm an attempted conflicting part/input is rejected, then delete a test document and verify its jobs, manifest parts, and vectors are removed by ownership-consistent cascades.
8. Record results and database/provider versions. Never use production documents or credentials in these tests, and do not infer live behavior from unit tests.

Items specifically blocked on live verification include actual pgvector extension schema/version and 768-dimension support, migration compatibility with the deployed Mission 4/6 schema, SQL concurrency and atomicity, effective PostgREST privileges/RLS, `service_role` function grants, Gemini model/key/region/quota access, and Vercel execution limits.

## Rollback

No rollback was executed because the migration was not applied. If this migration is later applied to a non-production database and must be reverted:

1. Stop calls to the embedding endpoint and preserve any required diagnostic/backup data.
2. In the same database, drop only the Mission 7C functions and tables, then the two uniqueness constraints it added:

```sql
drop function if exists public.fail_document_embedding_job(uuid, uuid, text, uuid, text);
drop function if exists public.finish_document_embedding_job(uuid, uuid, text, uuid);
drop function if exists public.persist_document_embedding_batch(uuid, uuid, text, uuid, jsonb);
drop function if exists public.claim_document_embedding_job(uuid, uuid, text, text, integer, text, integer, text, jsonb);

drop table if exists public.document_chunk_embeddings;
drop table if exists public.document_embedding_job_parts;
drop table if exists public.document_embedding_jobs;

alter table public.document_chunks
  drop constraint if exists document_chunks_id_document_user_unique;
alter table public.documents
  drop constraint if exists documents_id_user_id_unique;
```

3. Do not drop the `vector` extension as part of this rollback: it may predate Mission 7C or be used by other project features.
4. Revert the Mission 7C application changes as a coordinated source change. Preserve unrelated earlier Mission changes and reports.
