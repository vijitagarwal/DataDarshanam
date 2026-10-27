# DataDarshanam Mission 9 — Grounded RAG Answer Generation

## Outcome

Added authenticated evidence-grounded document question answering at `POST /api/answers`. The route calls the existing Mission 8 retrieval service directly; it does not make an internal HTTP request, duplicate embedding/retrieval, trust client-supplied ownership, or use a service-role shortcut.

The endpoint is **disabled by default**. It returns `FEATURE_DISABLED` unless the server-only `DOCUMENT_RAG_ANSWERS_ENABLED=true` flag is explicitly set. Keep it disabled until the required non-production Supabase, Gemini, Groq, and deployment checks in this report have passed. No feature flag was set in a runtime environment by this work.

No frontend chat UI, retrieval changes, new migrations, hybrid search, reranking, or changes to `/api/query`, CSV analytics, document processing, or canonical Mission 6 chunks were made.

## Endpoint and response contract

`POST /api/answers`

Request JSON:

```json
{
  "question": "How many days of annual leave are provided?",
  "documentIds": ["11111111-1111-4111-8111-111111111111"]
}
```

`documentIds` is optional and accepts at most 50 unique UUIDs. The IDs only narrow the authenticated user's corpus. The route caps the streamed body at 20,000 bytes, trims and validates a 1–5,000-character question, rejects unknown request fields, and uses the existing retrieval default limit of 5.

Success response when passages were retrieved and the model returned a supported answer:

```json
{
  "success": true,
  "status": "answered",
  "answer": "The policy provides 20 days of annual leave.",
  "sources": [
    {
      "documentId": "11111111-1111-4111-8111-111111111111",
      "documentName": "Employee policies",
      "chunkId": "33333333-3333-4333-8333-333333333333",
      "chunkIndex": 2,
      "sourceStart": 120,
      "sourceEnd": 186,
      "pageStart": 4,
      "pageEnd": 4,
      "sectionPath": ["Leave", "Annual"]
    }
  ]
}
```

Stable success statuses:

- `answered` — generated answer has at least one validated source reference.
- `insufficient_evidence` — passages were retrieved, but the model abstained; the API returns a fixed server-authored abstention and an empty source list.
- `no_evidence` — retrieval returned no passages; `answer` is `null`, `sources` is empty, and Groq is not called.

Errors use `{ "success": false, "error": { "code": "...", "message": "..." } }` with 400 for invalid input, 401 for unauthenticated callers, 413 for oversized requests/context, 502 for malformed model output, and 503 for disabled feature, provider, retrieval, database, or incompatible-configuration failures. Messages are sanitized.

## Retrieval-to-generation flow

1. The endpoint verifies the bearer token through the existing Supabase auth helper.
2. The endpoint creates the same user-JWT Supabase client used by Mission 8 and invokes `retrieveDocumentChunks` directly with the Gemini provider and optional document scope. Ownership continues to be derived by the Mission 8 database RPC from `auth.uid()`.
3. If retrieval returns no records, the route returns `no_evidence` before constructing or calling Groq.
4. The answer service serializes the retrieved passage metadata and text as bounded evidence. Context is capped at 24,000 JavaScript characters. It fails instead of truncating when evidence exceeds this bound.
5. A dedicated Groq call uses the existing `GROQ_MODEL` configuration and existing default (`openai/gpt-oss-120b`); the analytics model setting and `/api/query` behavior are unchanged. The request uses temperature 0, JSON response mode, a 900-token output cap, a 20-second SDK timeout, and no automatic SDK retries.
6. The system instruction says all evidence values are untrusted data, must not be followed as instructions, and answers must use only evidence. It requires abstention when support is insufficient and asks the model to paraphrase without inline citations, quotes, page numbers, IDs, or links.
7. Provider output is parsed and validated against a strict shape and answer-size bound. Every `source_chunk_id` must be unique and exactly match a chunk retrieved for this request. Unknown, malformed, missing, duplicated, or inconsistent references are rejected; they are not repaired by guessing.
8. The server constructs each source from the matched retrieval record. Model-supplied document names, IDs, offsets, pages, links, or quotes are never accepted as citation metadata. Answer text containing URL/link patterns, UUIDs, page-number patterns, or quote marks is rejected.

The route also sets a 45-second Next.js `maxDuration` bound. This is a declared route limit, not proof that the deployed Vercel plan accepts or can meet it.

## Security boundaries and citation integrity

- The route remains disabled unless explicitly enabled server-side.
- Authentication is verified before processing. Database retrieval uses the verified user's bearer token; no caller-provided `user_id` is accepted.
- Optional document IDs only narrow results. The Mission 8 RPC remains responsible for authorization and filters owner, ready document/job state, and the exact embedding identity.
- The new answer service never reads vectors or directly accesses the database.
- Groq and Gemini failures are converted to safe internal errors. No raw provider errors, prompts, document text, keys, or database details are logged or returned.
- Sources include document ID/name, canonical chunk ID/index, zero-based end-exclusive UTF-16 offsets, and available page/section data, all copied from validated retrieval results.
- Instructions inside the retrieved document text are explicitly treated as untrusted evidence. Delimiters/JSON structure do not make model prompt-injection resistance absolute.
- Citation validation proves that a returned source reference points to an item in the exact retrieval result set. It cannot prove that every natural-language assertion in a model-generated answer is entailed by that source. Semantic grounding still needs human-reviewed evaluation and monitoring before production enablement.

## Files changed

- `frontend/src/app/api/answers/route.ts` — new authenticated, feature-gated, bounded answer endpoint.
- `frontend/src/app/api/answers/route.test.ts` — authentication, feature gate, request validation, retrieval scope, no-evidence behavior, abstention, source response, and sanitized failures.
- `frontend/src/lib/groundedAnswer.ts` — dedicated Groq generation boundary, evidence budget, untrusted-evidence system instruction, strict response parsing, citation validation, fixed abstention, and server-built sources.
- `frontend/src/lib/groundedAnswer.test.ts` — empty evidence, grounded references, abstention, fabricated/malformed/duplicate citations, injection handling, provider failures, malformed/oversized outputs, and context limits.
- `frontend/.env.example` — documents `DOCUMENT_RAG_ANSWERS_ENABLED=false` as the safe default.
- `frontend/TESTING.md` — describes mocked test and live verification boundaries.
- `DATADARSHANAM_MISSION_9_COMPLETION.md` — this report.

All other pre-existing modified and untracked files were preserved.

## Verification results

Commands were run from `frontend` unless otherwise noted:

| Command | Result |
|---|---|
| `npx tsc --noEmit` | **PASS**, exit 0, no diagnostics. |
| `npm test` | **PASS on rerun**, 25 files and 122 tests passed. One preceding full-suite run had 121 passes and a 5-second timeout in the existing PDF/DOCX extraction fixture test; the focused extraction test then passed (1 file, 5 tests), followed by a clean full-suite rerun. |
| `npm run lint` | **PASS**, exit 0, no errors and 2 existing warnings in unchanged `src/components/ChartView.tsx` lines 55–56 (`plotData`/`plotLayout` Hook dependencies). No Mission 9 warning. |
| `npm run build` | **PASS**, exit 0, production build succeeded. |
| `git diff --check` | **PASS**, exit 0, no whitespace errors. Git printed line-ending conversion warnings for seven pre-existing modified frontend files; these are not whitespace failures. |

The test suite mocks Gemini, Groq, and Supabase. It does not prove live retrieval/RPC authorization, vector ranking, prompt-injection resistance, factual grounding, citation quality beyond exact ID membership, or provider availability.

## Live verification and remaining limitations

**UNVERIFIED:** no Supabase migration was applied, no production database accessed, no live Gemini/Groq request made, no Vercel deployment or runtime test performed, and no credential was requested or inspected for this mission.

Before setting `DOCUMENT_RAG_ANSWERS_ENABLED=true` in any deployed environment:

1. Apply Mission 4, 6, 7C, and 8 migrations only to an authorized non-production Supabase project. Verify extension schema/ownership, RPC definitions and grants, `auth.uid()` behavior under the retrieval `SECURITY DEFINER` function, and two-user cross-account isolation.
2. Verify Mission 8 retrieval returns only ready, owner-matched chunks with the expected `gemini-embedding-001`, 768-dimensional, `l2-unit-v1` identity.
3. With authorized non-production credentials and a non-sensitive fixture, execute one query embedding and one Groq answer. Verify model configuration, timeout/error mapping, JSON mode behavior, and no source-ID invention for that test.
4. Evaluate prompt injection using documents containing explicit instructions, fake citation IDs, fake page numbers, and requests to reveal secrets. Confirm the model abstains or answers only from factual evidence; the unit prompt test is not a security guarantee.
5. Human-review a representative answer set for supported claims, abstention, citation precision/recall, multilingual/Unicode content, and malformed provider outputs. Establish evaluation criteria before enabling real users.
6. Test response-time and memory limits in the intended non-production Vercel plan. The route performs Gemini token counting/embedding, database retrieval, and Groq generation synchronously; the declared 45-second route setting may not be supported by all plans.
7. Keep the feature flag false until these checks pass. No production enablement is implied by implementing the route.

Other limitations: no chat history, streaming, frontend UI, source navigation implementation, answer-quality scoring, similarity threshold, reranking, fallback to general model knowledge, or quote extraction is included. Generated language can still be factually unsupported despite prompt constraints and valid source IDs; do not treat citation-ID validation as semantic entailment proof.
