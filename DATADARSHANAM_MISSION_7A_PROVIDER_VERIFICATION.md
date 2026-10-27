# DataDarshanam Mission 7A — Embedding Provider Verification

**Status:** Planning and provider verification only\
**Access date:** 2026-10-26\
**Repository:** `vijitagarwal/DataDarshan`\
**Scope:** Gemini embedding-provider evaluation and pgvector architecture decisions. No embedding pipeline, migration, dependency, environment, or deployment changes were made.

## 1. Executive summary

The current repository has no Gemini embedding provider, embedding migration, vector column, vector index, retrieval function, or embedding credential configured.

The official Google documentation currently identifies these relevant models:

| Model | Official status | Input | Input limit | Output dimensions |
|---|---|---|---:|---|
| `gemini-embedding-001` | Stable | Text | 2,048 tokens | Flexible; 128–3072, with 768, 1536, and 3072 recommended |
| `gemini-embedding-2-preview` | Preview | Text, image, video, audio, PDF | 8,192 tokens | Flexible; 128–3072, with 768, 1536, and 3072 recommended |

The user-requested name `gemini-embedding-2` should not be treated as a stable production identifier without checking the current model catalog. The official page retrieved for this verification uses `gemini-embedding-2-preview`.

### Recommendation

For the first text-only proof of concept:

1. Prefer the stable `gemini-embedding-001`.
2. Use asymmetric retrieval task types:
   - Documents: `RETRIEVAL_DOCUMENT`
   - User queries: `RETRIEVAL_QUERY`
3. Use a candidate output dimension of **768** after a live test confirms the project returns exactly 768 finite values.
4. Do not create the pgvector migration until:
   - the selected model is confirmed available to the intended API project,
   - the requested dimension is confirmed,
   - quota and privacy settings are accepted,
   - a non-sensitive live document/query pair succeeds.

The 4,000-character Mission 6 chunk target must not be assumed to fit the 2,048-token limit. Mission 7 must count tokens or use a conservative tokenizer-aware splitter before embedding and must reject or split oversized chunks rather than silently truncating them.

## 2. Official sources

All sources below are official Google or Supabase documentation accessed on 2026-10-26.

### Google Gemini API

1. [Gemini API embeddings](https://ai.google.dev/gemini-api/docs/embeddings)
   - Embedding generation through `embedContent`
   - JavaScript usage with `@google/genai`
   - Retrieval task types
   - Embedding 2 text task prefixes
   - Output dimensionality and MRL behavior

2. [Gemini Embedding 001 model page](https://ai.google.dev/gemini-api/docs/models/gemini-embedding-001)
   - Stable model identifier
   - Text-only input
   - 2,048-token input limit
   - Supported output dimensions and recommendations

3. [Gemini Embedding 2 Preview model page](https://ai.google.dev/gemini-api/docs/models/gemini-embedding-2-preview)
   - Preview model identifier
   - Multimodal input support
   - 8,192-token input limit
   - Supported output dimensions and latest documented update

4. [Gemini API rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)
   - Project-level quota dimensions
   - Requests-per-minute, tokens-per-minute, and requests-per-day concepts
   - AI Studio location for checking active project limits

5. [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)
   - Free, paid, and enterprise tier distinctions
   - Batch API availability on paid tiers
   - Free-tier and paid-tier data-use distinction

6. [Gemini API Batch API](https://ai.google.dev/gemini-api/docs/batch-api)
   - Batch-processing behavior and availability must be checked again when implementation begins.

7. [Gemini API token counting](https://ai.google.dev/gemini-api/docs/tokens)
   - Token counts must be measured with the provider/token-counting mechanism rather than inferred from character count.

### Supabase and pgvector

8. [Supabase vector indexes](https://supabase.com/docs/guides/ai/vector-indexes)
   - HNSW and IVFFlat options
   - Distance operators
   - pgvector dimension limits

9. [Supabase HNSW indexes](https://supabase.com/docs/guides/ai/vector-indexes/hnsw-indexes)
   - HNSW syntax and operator classes
   - Current indexed dimension limits

10. [Supabase IVFFlat indexes](https://supabase.com/docs/guides/ai/vector-indexes/ivf-indexes)
    - IVFFlat syntax, list/probe tradeoffs, and approximate-search behavior

## 3. Confirmed model behavior

### 3.1 `gemini-embedding-001`

The official model page documents:

- Stable model code: `gemini-embedding-001`
- Text input and text embeddings output
- Input token limit: 2,048
- Flexible output dimensions from 128 through 3072
- Recommended dimensions: 768, 1536, and 3072
- Latest documented update: June 2025

The embeddings guide documents retrieval-specific task types:

- `RETRIEVAL_DOCUMENT` for documents being indexed
- `RETRIEVAL_QUERY` for user search queries

This is the most conservative choice for DataDarshanam because the current use case is text-only document search and stable model behavior is preferable before the first vector migration.

### 3.2 `gemini-embedding-2-preview`

The official model page currently uses the identifier `gemini-embedding-2-preview`, not a stable `gemini-embedding-2` identifier.

Documented behavior:

- Preview status
- Multimodal input: text, image, video, audio, and PDF
- Input token limit: 8,192
- Flexible output dimensions from 128 through 3072
- Recommended dimensions: 768, 1536, and 3072
- Latest documented update: March 2026

For text-only asymmetric retrieval, the embeddings guide recommends task-specific input formatting, including:

```text
Query:
task: search result | query: {content}

Document:
title: {title} | text: {content}
```

The exact prompt structure must be centralized in the provider adapter. Document and query formatting must never drift.

### 3.3 API and JavaScript runtime

The official JavaScript examples use the `@google/genai` package and call:

```ts
const response = await ai.models.embedContent({
  model: "gemini-embedding-001",
  contents: "text",
  config: {
    taskType: "RETRIEVAL_DOCUMENT",
    outputDimensionality: 768,
  },
});
```

The official REST endpoint is documented under the Gemini API `v1beta` API surface:

```text
https://generativelanguage.googleapis.com/v1beta/models/{model}:embedContent
```

The repository does not currently have `@google/genai` installed. Installing it belongs to the implementation mission, not this verification mission.

### 3.4 Inputs exceeding the token limit

Google documents model token limits, but the repository has not yet verified the exact error payload for an over-limit embedding request. Mission 7 must:

1. Count tokens before calling the provider, using the provider-supported token-counting path where practical.
2. Split oversized chunks deterministically.
3. Preserve canonical source offsets and metadata for derived subchunks.
4. Never silently truncate text.
5. Return a safe, classified error if splitting cannot produce a valid bounded input.

## 4. Current project access and live test

### Credential check

The following environment variable names were checked without printing values:

```text
GEMINI_API_KEY=ABSENT
GOOGLE_API_KEY=ABSENT
GOOGLE_GENAI_API_KEY=ABSENT
GOOGLE_APPLICATION_CREDENTIALS=ABSENT
```

No Gemini credential was found in the process environment or the inspected frontend environment configuration. No unrelated secrets were inspected.

### Live embedding test

**Status: UNVERIFIED**

No live provider request was made because no Gemini credential is configured. No project, region, quota, model access, returned dimension, or provider error category can be confirmed from this repository.

No private document, user data, production content, or production endpoint was sent to Google.

### Manual non-sensitive verification procedure

Before creating an embedding migration, perform the following using a dedicated non-production Gemini API project and a non-sensitive fixture:

1. Configure a server-only `GEMINI_API_KEY`.
2. Confirm the key belongs to the intended project.
3. Call `embedContent` once with:
   - model `gemini-embedding-001`,
   - content such as `Quarterly revenue increased in the final period.`,
   - `taskType: RETRIEVAL_DOCUMENT`,
   - requested `outputDimensionality: 768`.
4. Validate:
   - HTTP/provider success,
   - one returned embedding,
   - exactly 768 values,
   - every value is finite,
   - vector norm is non-zero.
5. Call `embedContent` once with:
   - the corresponding query text,
   - `taskType: RETRIEVAL_QUERY`,
   - the same requested dimension.
6. Confirm the query vector also has exactly 768 finite values.
7. Record only:
   - model identifier,
   - requested dimension,
   - actual dimension,
   - safe error category,
   - project quota tier.
8. Do not record the API key or document text.

Repeat the same non-sensitive test for `gemini-embedding-2-preview` only if preview adoption is being considered.

## 5. Model comparison for DataDarshanam

| Criterion | `gemini-embedding-001` | `gemini-embedding-2-preview` |
|---|---|---|
| Stability | Stable | Preview |
| Current use case | Direct fit for text-only retrieval | More capability than currently needed |
| Modalities | Text | Text, image, video, audio, PDF |
| Input limit | 2,048 tokens | 8,192 tokens |
| Retrieval configuration | Explicit `RETRIEVAL_DOCUMENT` / `RETRIEVAL_QUERY` task types | Task-specific text prefixes recommended |
| Output dimensions | 128–3072; 768/1536/3072 recommended | 128–3072; 768/1536/3072 recommended |
| Migration cost | Lower initial risk | Requires a new embedding space if later adopted |
| Main risk | Mission 6’s 4,000-character chunks may exceed 2,048 tokens | Preview behavior, model availability, and future model changes |

### Recommendation for the proof of concept

Use `gemini-embedding-001` with 768 dimensions, subject to the live test and project quota confirmation.

Reasons:

- Stable rather than preview
- Text-only use case does not require multimodal capability
- 768 dimensions reduce storage and index cost relative to 1536 or 3072
- 768 is an officially recommended output size
- 768 is well within current pgvector indexed-vector limits

This recommendation is not a claim that 768 has been live-verified. It remains a candidate until the manual test succeeds.

### Chunk-size implications

Mission 6 currently targets 4,000 characters, not tokens. Character count is not token count. Code, punctuation, Unicode, and language differences can produce materially different token counts.

Before embedding:

- Measure token count for each chunk.
- Preserve the current canonical text and offsets.
- Split only oversized chunks using deterministic boundaries.
- Assign each derived subchunk a stable derived content hash and source range.
- Keep document and query task configuration compatible.

Do not silently drop, truncate, or replace text with a summary.

## 6. Dimension and pgvector compatibility

### Provider dimensions

Both relevant Google model pages document output dimensions from 128 through 3072 and recommend 768, 1536, or 3072.

### Supabase/pgvector constraints

The current Supabase documentation states for pgvector 0.7.0 and later:

- `vector`: indexed dimensions up to 2,000
- `halfvec`: indexed dimensions up to 4,000
- `bit`: indexed dimensions up to 64,000

The exact pgvector version in the future Supabase project is not known because no project is configured.

Both HNSW and IVFFlat support cosine, inner-product, and L2 operator classes. Supabase generally recommends HNSW for performance and robustness with changing data. IVFFlat requires list/probe tuning and is approximate; its clustering should be built after sufficient data exists.

### Candidate dimension analysis

| Dimension | Storage/index implication | Recommendation |
|---:|---|---|
| 768 | Lowest recommended candidate; comfortably indexable with `vector(768)` | Best initial POC candidate |
| 1536 | Higher storage and compute; still within indexed `vector` limits | Strong quality alternative |
| 3072 | Highest documented default/recommended size; more storage and index cost | Avoid for initial student deployment unless evaluation shows meaningful gains |

The eventual migration should verify the live pgvector extension version and declare one explicit dimension. The application must validate provider response length against the configured dimension before persistence.

### Similarity metric

Use cosine distance (`<=>`) for the initial text retrieval design unless the live provider evaluation demonstrates a better metric. The provider adapter and retrieval RPC must use the same metric consistently.

### Index choice

Use HNSW for the initial retrieval implementation after the table contains representative data and query latency/recall are measured. Keep exact sequential scans for the small evaluation fixture so recall can be compared against approximate search.

Do not create an HNSW or IVFFlat index in this mission.

## 7. Cost, quota, and data-processing considerations

Google documents:

- Rate limits are project-level and commonly expressed as RPM, TPM, and RPD.
- Active limits must be checked in AI Studio for the actual project.
- Free tier has limited model access and states that content may be used to improve Google products.
- Paid tier provides higher limits and states content is not used to improve Google products.
- Paid tier includes Batch API access and the pricing page describes Batch API as a 50% cost reduction feature.

Exact effective Gemini embedding pricing, quota values, and availability for this student project are **not independently verified** here. They depend on the selected project, billing tier, region, model, and current Google account configuration.

Recommended controls:

- Per-user document/chunk embedding quotas
- Project-wide daily token budget
- Maximum chunks per job
- Maximum provider requests per job
- Bounded concurrency
- Retry only transient failures and rate limits
- Respect `Retry-After` where provided
- Do not retry authentication, invalid-request, dimension, or permanent quota failures indefinitely
- Prefer batch processing for non-urgent bulk ingestion only after the project’s batch behavior and billing are confirmed
- Deduplicate by content hash, model identity, task configuration, requested dimension, and embedding-version identity

## 8. Architecture decision

### Provider interface

Use a server-only interface with separate document/query methods:

```ts
interface EmbeddingProvider {
  embedDocuments(inputs: readonly EmbeddingDocumentInput[]): Promise<EmbeddingResult[]>;
  embedQuery(input: string): Promise<EmbeddingResult>;
  getIdentity(): EmbeddingIdentity;
}
```

The interface should enforce:

- model identity,
- provider identity,
- task configuration,
- requested dimension,
- finite non-zero vectors,
- exact result count,
- exact vector length.

Provider implementations must not be imported by browser components or client routes.

### Stable embedding identity

Recommended identity format:

```text
google-gemini:
gemini-embedding-001:
retrieval-document-query-v1:
dim-768
```

Store separate fields as well as a canonical version string:

```text
provider = google-gemini
model = gemini-embedding-001
task_pair = retrieval-document-query-v1
dimension = 768
embedding_version = google-gemini/gemini-embedding-001/retrieval-v1/dim-768
```

The identity must change when any of these change:

- provider
- model
- task/prefix strategy
- output dimension
- normalization strategy
- token-splitting strategy

Document and query embeddings must use the same model, dimension, and embedding-space version. Their task configuration may differ only as explicitly defined by the provider’s asymmetric retrieval contract.

### Deduplication and re-embedding

Deduplicate using:

```text
document_id
chunk_id
chunk_content_hash
provider
model
task configuration
requested dimension
embedding_version
```

An existing embedding is reusable only when every identity component matches. Changing model, dimension, task formatting, or chunk content must enqueue a new embedding.

### Separate embedding table

Prefer a separate `document_chunk_embeddings` table over adding one mutable vector field directly to `document_chunks`.

Reasons:

- Supports model migration and re-embedding
- Makes embedding status and failures explicit
- Allows old and new embedding versions to coexist during migration
- Enables rollback by disabling one embedding version
- Keeps Mission 6 extraction data independent of provider choices
- Avoids overwriting canonical chunk content

The table must enforce document/chunk/user consistency at the database layer and deny browser writes.

### Batching and retries

Initial safe defaults should be configuration, not undocumented constants:

- Small bounded batch size
- Bounded total input tokens per request
- One or two retries for transient failures with exponential backoff and jitter
- No unbounded retry loop
- Explicit terminal status for quota exhaustion or invalid input
- Job lease/claim protection so two workers do not embed the same active job

The exact batch-size and concurrency values remain blocked on the project’s active quota and live provider behavior.

## 9. Risks and unresolved assumptions

1. No Gemini key is configured, so model access and returned dimensions are unverified.
2. `gemini-embedding-2-preview` is preview; its adoption would create a migration and model-stability risk.
3. The user-requested `gemini-embedding-2` identifier may not be the current official stable identifier.
4. The project’s billing tier, RPM, TPM, RPD, and batch quota are unknown.
5. Free-tier data-use terms may be inappropriate for confidential business documents.
6. The actual Supabase pgvector extension version is unknown.
7. The actual best dimension for this dataset is unmeasured; 768 is a cost-conscious candidate, not an evaluation result.
8. Mission 6 uses character-based chunks and requires token-aware validation before provider calls.
9. Live concurrency, job leases, RLS, RPC permissions, and vector-index behavior remain unverified.
10. Provider data-processing terms must be reviewed before sending real user documents.

## 10. Next implementation step

The next step should be Mission 7B, but only after the following manual verification is completed:

1. Confirm a dedicated non-production Gemini project and billing/privacy policy.
2. Run the document/query fixture test.
3. Record actual model identifier, requested dimension, returned dimension, quota tier, and safe error category.
4. Confirm the selected model remains available.
5. Confirm the live Supabase project’s pgvector extension version.
6. Freeze the embedding identity and dimension.

Then implement the server-only provider adapter and deterministic mocked tests. Do not create the vector migration until those decisions are recorded.

## 11. Change and verification record

This mission created exactly one file:

- `DATADARSHANAM_MISSION_7A_PROVIDER_VERIFICATION.md`

No source code, package manifest, lockfile, migration, environment file, deployment setting, Supabase project, provider API, or existing report was modified.
