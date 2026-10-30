export class RequestBodyError extends Error {
  constructor(
    public readonly code: "INVALID_UPLOAD" | "CSV_LIMIT_EXCEEDED",
    message: string,
    public readonly status: 400 | 413,
  ) {
    super(message);
    this.name = "RequestBodyError";
  }
}

export async function readBoundedRequestBody(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array> {
  const rawLength = request.headers.get("content-length");
  let declaredLength: number | null = null;
  if (rawLength !== null) {
    if (!/^\d+$/u.test(rawLength) || !Number.isSafeInteger(Number(rawLength))) {
      throw new RequestBodyError("INVALID_UPLOAD", "Upload request has an invalid Content-Length.", 400);
    }
    declaredLength = Number(rawLength);
    if (declaredLength > maxBytes) {
      throw new RequestBodyError("CSV_LIMIT_EXCEEDED", "CSV upload request exceeds the maximum size.", 413);
    }
  }

  if (!request.body) {
    if (declaredLength !== null && declaredLength !== 0) {
      throw new RequestBodyError("INVALID_UPLOAD", "Upload request body is incomplete.", 400);
    }
    return new Uint8Array();
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > maxBytes - totalBytes) {
        await reader.cancel().catch((error: unknown) => {
          console.error("Oversized upload stream cancellation failed", {
            name: error instanceof Error ? error.name : "UnknownError",
          });
        });
        throw new RequestBodyError(
          "CSV_LIMIT_EXCEEDED",
          "CSV upload request exceeds the maximum size.",
          413,
        );
      }
      totalBytes += value.byteLength;
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof RequestBodyError) throw error;
    throw new RequestBodyError("INVALID_UPLOAD", "Upload request body could not be read.", 400);
  } finally {
    reader.releaseLock();
  }

  if (declaredLength !== null && totalBytes !== declaredLength) {
    throw new RequestBodyError("INVALID_UPLOAD", "Upload request body does not match Content-Length.", 400);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
