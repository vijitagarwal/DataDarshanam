import { GoogleGenAI } from "@google/genai";
import {
  DEFAULT_EMBEDDING_DIMENSION,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_MAX_INPUT_TOKENS,
  DEFAULT_MAX_REQUEST_TOKENS,
  getEmbeddingConfig,
  type EmbeddingDocumentInput,
  type EmbeddingIdentity,
  type EmbeddingProvider,
  type EmbeddingProviderConfig,
  type EmbeddingResult,
  normalizeEmbeddingValues,
  MAX_EMBEDDING_INPUTS,
  isRetryableEmbeddingError,
} from "./provider";
import { classifyEmbeddingError, EmbeddingProviderError } from "./errors";
import { groupEmbeddingRequests, prepareEmbeddingInput, type PreparedEmbeddingInput } from "./prepare";

const MAX_INPUT_CHARACTERS = 500_000;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 1;

function assertText(input: string): void {
  if (!input.trim() || input.length > MAX_INPUT_CHARACTERS) {
    throw new EmbeddingProviderError("INVALID_INPUT", "Embedding input is empty or exceeds the safe processing limit.");
  }
}

function identityFromConfig(config: EmbeddingProviderConfig): EmbeddingIdentity {
  const model = config.model ?? DEFAULT_EMBEDDING_MODEL;
  const dimension = config.dimension ?? DEFAULT_EMBEDDING_DIMENSION;
  if (!Number.isInteger(dimension) || dimension < 128 || dimension > 3072) {
    throw new EmbeddingProviderError("INVALID_DIMENSION", "Embedding dimension must be an integer between 128 and 3072.");
  }
  return {
    provider: "google-gemini",
    model,
    dimension,
    documentTask: "RETRIEVAL_DOCUMENT",
    queryTask: "RETRIEVAL_QUERY",
    normalization: "l2-unit-v1",
    version: config.version ?? `google-gemini/${model}/retrieval-v1/dim-${dimension}/norm-l2-v1`,
  };
}

function defaultConfig(): EmbeddingProviderConfig {
  const config = getEmbeddingConfig();
  return {
    apiKey: config.apiKey ?? "",
    model: config.model,
    dimension: config.dimension,
    version: config.version,
    maxInputTokens: config.maxInputTokens,
    maxRequestTokens: config.maxRequestTokens,
  };
}

function validateTokenLimits(config: EmbeddingProviderConfig): { maxInputTokens: number; maxRequestTokens: number } {
  const maxInputTokens = config.maxInputTokens ?? DEFAULT_MAX_INPUT_TOKENS;
  const maxRequestTokens = config.maxRequestTokens ?? DEFAULT_MAX_REQUEST_TOKENS;
  if (!Number.isInteger(maxInputTokens) || maxInputTokens < 1 || maxInputTokens > 1_000_000 ||
      !Number.isInteger(maxRequestTokens) || maxRequestTokens < maxInputTokens || maxRequestTokens > 1_000_000) {
    throw new EmbeddingProviderError("INVALID_INPUT", "Embedding token limits are invalid.");
  }
  return { maxInputTokens, maxRequestTokens };
}

function getMaxRetries(config: EmbeddingProviderConfig): number {
  const retries = config.maxRetries ?? MAX_RETRIES;
  if (!Number.isInteger(retries) || retries < 0 || retries > 2) {
    throw new EmbeddingProviderError("INVALID_INPUT", "Embedding retry count must be between zero and two.");
  }
  return retries;
}

export function formatDocumentEmbeddingContent(input: EmbeddingDocumentInput): string {
  return `title: ${input.title ?? "none"} | text: ${input.text}`;
}

function queryContent(input: string): string {
  return `task: search result | query: ${input}`;
}

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  private readonly client: GoogleGenAI;
  private readonly identity: EmbeddingIdentity;
  private readonly maxInputTokens: number;
  private readonly maxRequestTokens: number;
  private readonly maxRetries: number;

  constructor(config: EmbeddingProviderConfig = defaultConfig()) {
    if (!config.apiKey.trim()) {
      throw new EmbeddingProviderError("NOT_CONFIGURED", "Gemini embedding provider is not configured.");
    }
    this.identity = identityFromConfig(config);
    ({ maxInputTokens: this.maxInputTokens, maxRequestTokens: this.maxRequestTokens } = validateTokenLimits(config));
    this.maxRetries = getMaxRetries(config);
    this.client = new GoogleGenAI({
      apiKey: config.apiKey,
      httpOptions: {
        timeout: REQUEST_TIMEOUT_MS,
        retryOptions: { attempts: 1 },
      },
    });
  }

  getIdentity(): EmbeddingIdentity {
    return this.identity;
  }

  async prepareDocuments(inputs: readonly EmbeddingDocumentInput[]): Promise<PreparedEmbeddingInput[]> {
    if (inputs.length > MAX_EMBEDDING_INPUTS) {
      throw new EmbeddingProviderError("INVALID_INPUT", "Embedding batch exceeds the safe adapter limit.");
    }
    return (await Promise.all(inputs.map(input => this.prepareDocument(input)))).flat();
  }

  private async withRetries<T>(request: () => Promise<T>, tokenCountRequest = false): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await request();
      } catch (error) {
        const classified = classifyEmbeddingError(error);
        if (attempt >= this.maxRetries || !isRetryableEmbeddingError(classified.code)) {
          if (tokenCountRequest && classified.code === "UNKNOWN_PROVIDER_ERROR") {
            throw new EmbeddingProviderError("TOKEN_COUNT_FAILED", "Provider token counting failed.");
          }
          throw classified;
        }
        await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
      }
    }
  }

  private async countTextTokens(text: string): Promise<number> {
    const response = await this.withRetries(() => this.client.models.countTokens({
      model: this.identity.model,
      contents: text,
    }), true);
    if (!Number.isInteger(response.totalTokens) || (response.totalTokens ?? -1) < 0) {
      throw new EmbeddingProviderError("TOKEN_COUNT_FAILED", "Provider returned an invalid token count.");
    }
    return response.totalTokens!;
  }

  private async prepareDocument(input: EmbeddingDocumentInput): Promise<PreparedEmbeddingInput[]> {
    assertText(input.text);
    return prepareEmbeddingInput(
      input,
      text => this.countTextTokens(formatDocumentEmbeddingContent({ ...input, text })),
      this.maxInputTokens,
    );
  }

  private resultFor(input: EmbeddingDocumentInput, values: number[]): EmbeddingResult {
    return {
      values,
      inputId: input.id,
      contentHash: input.contentHash,
      sourceContentHash: input.sourceContentHash,
      sourceChunkId: input.sourceChunkId,
      partIndex: input.partIndex,
      documentId: input.documentId,
      ownerId: input.ownerId,
      pageStart: input.pageStart,
      pageEnd: input.pageEnd,
      sectionPath: input.sectionPath ? [...input.sectionPath] : undefined,
      sourceStart: input.sourceStart,
      sourceEnd: input.sourceEnd,
      identity: this.identity,
    };
  }

  async embedDocuments(inputs: readonly EmbeddingDocumentInput[]): Promise<EmbeddingResult[]> {
    if (inputs.length === 0) return [];
    if (inputs.length > MAX_EMBEDDING_INPUTS) {
      throw new EmbeddingProviderError("INVALID_INPUT", "Embedding batch exceeds the safe adapter limit.");
    }
    const inputIds = new Set<string>();
    for (const input of inputs) {
      if (inputIds.has(input.id)) {
        throw new EmbeddingProviderError("INVALID_INPUT", "Embedding input IDs must be unique within a batch.");
      }
      inputIds.add(input.id);
    }

    const prepared = await this.prepareDocuments(inputs);
    const preparedIds = new Set<string>();
    for (const { input } of prepared) {
      if (preparedIds.has(input.id)) {
        throw new EmbeddingProviderError("INVALID_INPUT", "Prepared embedding input IDs are not unique.");
      }
      preparedIds.add(input.id);
    }
    const batches = groupEmbeddingRequests(prepared, MAX_EMBEDDING_INPUTS, this.maxRequestTokens);
    const results: EmbeddingResult[] = [];
    for (const batch of batches) {
      const response = await this.withRetries(() => this.client.models.embedContent({
        model: this.identity.model,
        contents: batch.map(({ input }) => ({
          parts: [{ text: formatDocumentEmbeddingContent(input) }],
        })),
        config: {
          taskType: this.identity.documentTask,
          outputDimensionality: this.identity.dimension,
        },
      }));
      if (!response.embeddings || response.embeddings.length !== batch.length) {
        throw new EmbeddingProviderError("INVALID_PROVIDER_RESPONSE", "Embedding provider returned an unexpected result count.");
      }
      for (const [index, embedding] of response.embeddings.entries()) {
        results.push(this.resultFor(
          batch[index].input,
          normalizeEmbeddingValues(embedding.values, this.identity.dimension),
        ));
      }
    }
    return results;
  }

  async embedQuery(input: string): Promise<EmbeddingResult> {
    assertText(input);
    const content = queryContent(input);
    const tokenCount = await this.countTextTokens(content);
    if (tokenCount > this.maxInputTokens) {
      throw new EmbeddingProviderError("INPUT_TOO_LARGE", "Query exceeds the configured model token limit.");
    }
    if (tokenCount > this.maxRequestTokens) {
      throw new EmbeddingProviderError("AGGREGATE_TOKEN_BUDGET_EXCEEDED", "Query exceeds the configured request token budget.");
    }
    const response = await this.withRetries(() => this.client.models.embedContent({
        model: this.identity.model,
        contents: content,
        config: {
          taskType: this.identity.queryTask,
          outputDimensionality: this.identity.dimension,
        },
      }));
    if (!response.embeddings || response.embeddings.length !== 1) {
      throw new EmbeddingProviderError("INVALID_PROVIDER_RESPONSE", "Embedding provider returned an unexpected result count.");
    }
    return this.resultFor(
      { id: "query", text: input },
      normalizeEmbeddingValues(response.embeddings[0].values, this.identity.dimension),
    );
  }
}
