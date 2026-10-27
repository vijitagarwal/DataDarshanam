# DataDarshanam Mission 8 — Secure Vector Retrieval

## Outcome and scope

Mission 8 adds authenticated vector retrieval over Mission 7C persisted embeddings. It does not generate answers, add a chat/RAG endpoint, implement citations in generated prose, change `/api/query`, redesign the frontend, or modify the legacy FastAPI backend.

The new server route is `POST /api/retrieval`. It accepts a query, an optional set of document IDs, and a bounded result limit. It returns canonical source chunk text and citation-ready source metadata, but never returns vectors, provider credentials, service-role credentials, or raw database/provider errors.

There is no workspace or collection-membership schema in the repository. Retrieval therefore scopes to the authenticated user's documents. Optional document IDs only narrow that owner scope; they do not grant access. A document ID belonging to another user produces no match.

## Architecture

1. The route verifies the bearer token with the existing Supabase authentication helper.
2. The route creates a user-scoped Supabase client using that same access token. It does not use a service-role client for reads/retrieval.
3. Request parsing enforces a 20 KB streaming body limit, non-empty query up to 5,000 JavaScript characters, at most 50 UUID document IDs, and a result limit of 1–20.
4. The server-only Gemini provider creates a query vector with the existing `RETRIEVAL_QUERY` task configuration.
5. The retrieval service requires the supported `gemini-embedding-001`, 768-dimensional, `RETRIEVAL_DOCUMENT` / `RETRIEVAL_QUERY`, `l2-unit-v1` identity. It checks the query result identity against the provider identity and rejects malformed/non-finite/zero-norm vectors. It derives the exact same embedding-space key used by Mission 7C and sends the normalized vector to the database RPC.
6. `public.retrieve_document_chunks` is a `SECURITY DEFINER` function granted to `authenticated`. It obtains the caller from `auth.uid()`; it has no `user_id` input. It filters by owner, exact embedding space/model/dimension/normalization, ready document and ready embedding-job states, and a join to the canonical chunk with matching source hash and valid source bounds.
7. The RPC ranks with pgvector cosine distance and collapses multiple prepared embedding parts to one result per canonical source chunk using that chunk's best part similarity. Results are ordered by similarity descending with deterministic document/chunk tie-breaks.

## Ranking and result contract

- The similarity score is `1 - cosine_distance`; document and query embeddings use the same local L2 unit normalization policy.
- The default result limit is **5**, configurable per request from **1 through 20**.
- No similarity threshold is applied. The project has no retrieval relevance evaluation/calibration from which to choose a defensible cutoff; top-k results are returned and callers must treat the score as a ranking signal, not a relevance guarantee.
- The RPC returns one row per canonical chunk, even when that chunk was split into multiple embedding inputs.
- Each result includes document ID/name, canonical chunk ID/index/text, zero-based end-exclusive JavaScript UTF-16 source offsets, available page/section metadata, and similarity. The vector itself is not selected or serialized.
- No ANN index was added. This provides exact ranking for the current proof of concept but may require a measured indexing decision as the corpus grows.

## Database migration and SECURITY DEFINER hardening

Added [20261027112000_mission8_secure_vector_retrieval.sql](/D:/BCA_sem5/genai/GFG_Hackathon/DataDarshan/supabase/migrations/20261027112000_mission8_secure_vector_retrieval.sql).

The migration:

- Adds a single authenticated retrieval RPC. Its `search_path` is only `pg_catalog`; relations, `auth.uid()`, vector type, and pgvector operators are schema-qualified.
- Makes `postgres` the retrieval function owner so it can safely read the RLS-protected tables without granting users table access.
- Revokes execution from `PUBLIC` and `anon`, then grants execution to `authenticated`.
- Rejects invalid model/dimension/normalization, query vector norm, result bounds, and overlarge/null-containing document filters.
- Moves pgcrypto into the controlled `extensions` schema when necessary, revokes schema `CREATE` from `PUBLIC`, `anon`, and `authenticated`, and pins existing Mission 6/7C definer-function search paths so untrusted `public` objects cannot shadow `digest`.

The reviewed but unapplied Mission 7C migration was also hardened: it ensures the `extensions` schema, places pgcrypto there, uses `extensions.digest`, and removes `public` from the affected definer-function search paths. The Mission 8 migration repeats the extension/function hardening for environments where Mission 7C was already applied before this source update.

`ALTER EXTENSION pgcrypto SET SCHEMA extensions` is non-destructive but changes the extension namespace. The migrations were not run against PostgreSQL/Supabase; verify extension ownership, relocatability, schema permissions, existing dependencies, and the `postgres` role in a non-production project before applying.

## Changed files

- `frontend/src/lib/embeddings/provider.ts` — centralizes the embedding-space identity string builder used by both persistence and retrieval.
- `frontend/src/lib/embeddings/embeddingService.ts` — reuses the shared identity builder; persistence behavior is otherwise unchanged.
- `frontend/src/lib/embeddings/retrievalService.ts` — validates identity/query/vector inputs, calls the owner-bound RPC, maps safe citation-ready results, and classifies failures.
- `frontend/src/lib/embeddings/retrievalService.test.ts` — tests query validation, exact identity/scope parameters, result ordering/metadata, empty results, mismatches, and provider/database failure handling.
- `frontend/src/app/api/retrieval/route.ts` — adds authenticated bounded retrieval over the user-token Supabase client.
- `frontend/src/app/api/retrieval/route.test.ts` — tests authentication, user-token client usage, input validation, response shape, and error sanitization.
- `frontend/TESTING.md` — documents Mission 8 test boundaries and live checks.
- `supabase/migrations/20261027010000_mission7c_embedding_persistence.sql` — hardens pgcrypto namespace and persistence function search paths.
- `supabase/migrations/20261027112000_mission8_secure_vector_retrieval.sql` — adds the secure retrieval RPC and migration-time definer-function hardening.
- `DATADARSHANAM_MISSION_8_COMPLETION.md` — this report.

The repository already had unrelated modified and untracked Mission 0–7C work before Mission 8. Those files were preserved.

## Verification

Ran from `frontend`:

| Command | Result |
|---|---|
| `npx tsc --noEmit` | **PASS**, exit 0, no diagnostics. |
| `npm test` | **PASS**, 23 test files and 105 tests. |
| `npm run lint` | **PASS**, exit 0; 2 existing warnings in `src/components/ChartView.tsx` for `plotData`/`plotLayout` Hook dependencies. No Mission 8 lint warning remains. |
| `npm run build` | **PASS**, production build completed. |
| `git diff --check` | **PASS**, no whitespace errors. Git reported LF-to-CRLF conversion notices for seven pre-existing modified frontend files; these are not whitespace failures. |

Retrieval tests mock Supabase and Gemini. The service test verifies that the application sends an exact embedding-space key and preserves the database-returned ranking order; it does not execute cosine ranking in PostgreSQL. Route tests prove the route passes a verified bearer token to a user-scoped client in the mocked boundary. They do not prove PostgREST JWT claims, database grants, RLS bypass under the function owner, SQL correctness, or cross-user isolation on a live project.

## Live verification status and required non-production checks

**UNVERIFIED:** no Supabase migration was applied, no production database accessed, no deployment performed, and no live Gemini request made. Credentials were not requested or invented.

Before enabling retrieval:

1. Apply Mission 4, Mission 6, Mission 7C, and Mission 8 migrations only to an authorized non-production Supabase project. Confirm `pgcrypto` and `vector` extension schemas, relocatability/ownership, vector operators, `postgres` function ownership, and effective schema grants.
2. Inspect `pg_get_functiondef` and effective ACLs. Confirm `retrieve_document_chunks` has `search_path=pg_catalog`, owner `postgres`, execution for `authenticated`, and no execution for `anon`/`PUBLIC`; confirm users have no direct embedding or manifest table access.
3. With two test users and ready documents, retrieve as each user. Try the other user's document UUID in `documentIds`; verify zero rows and no text/metadata leakage. Confirm absent, `queued`, `processing`, `failed`, and not-yet-embedded documents do not appear.
4. Call the RPC directly as authenticated with another user's scope, invalid model/dimension/normalization, wrong vector dimension, non-unit/zero vector, and out-of-range limit; confirm safe rejection. Attempt calls as anon and confirm permission denial.
5. Embed a non-sensitive query using the authorized non-production Gemini configuration and verify the query identity matches stored `embedding_space`, model, dimension, task configuration, and normalization.
6. Compare RPC similarity ordering against a small manually computed fixture, confirm duplicate derived parts collapse to one canonical chunk using the best score, and test tie ordering, optional document filters, empty results, and top-k bounds.
7. Measure query-embedding latency, exact SQL ranking latency, response size, and resource use at expected corpus scale. No ANN index or latency claim is included.

## Limitations and remaining blockers before Mission 9

- Live pgvector operator resolution, grants, `auth.uid()` behavior under `SECURITY DEFINER`, and owner isolation are not established by mocked tests.
- The migration assumes Supabase provides the standard `postgres`, `authenticated`, `anon`, `auth.uid()`, pgcrypto, and pgvector facilities. The schema move and RPC owner assignment must be confirmed against the target project's extension/role state before application.
- Supabase role and migration ownership are not established from repository source; a non-production migration run is a prerequisite, not a passed check.
- Gemini model access/quota and Vercel execution behavior are unverified. Retrieval synchronously waits for a query embedding and SQL RPC.
- No similarity threshold, answer-generation prompt, citation synthesis, abstention policy, hybrid router, frontend search UI, or vector index is included.
- Because there is no workspace/collection membership schema, shared workspaces are unsupported; retrieval remains private per authenticated user.
