import { NextRequest, NextResponse } from "next/server";
import { getDatasetProfile, suggestQuestions, loadFromCSVText } from "@/lib/engine/dataEngine";
import { CsvValidationError, decodeCsvBytes, MAX_CSV_BYTES, MAX_CSV_COLUMNS } from "@/lib/engine/csv";
import { readBoundedRequestBody, RequestBodyError } from "@/lib/requestBody";
import { authenticateRequest } from "@/lib/supabase/auth";
import { createUserDataset, DatasetStoreError } from "@/lib/supabase/datasets";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_MULTIPART_OVERHEAD_BYTES = 65_536;
const MAX_UPLOAD_REQUEST_BYTES = MAX_CSV_BYTES + MAX_MULTIPART_OVERHEAD_BYTES;

export async function POST(req: NextRequest) {
  const auth = await authenticateRequest(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.message, code: auth.code }, { status: 401 });
  }

  try {
    const body = await readBoundedRequestBody(req, MAX_UPLOAD_REQUEST_BYTES);
    let formData: FormData;
    try {
      const bodyBuffer = new ArrayBuffer(body.byteLength);
      new Uint8Array(bodyBuffer).set(body);
      formData = await new Request(req.url, {
        method: "POST",
        headers: req.headers,
        body: bodyBuffer,
      }).formData();
    } catch {
      throw new RequestBodyError("INVALID_UPLOAD", "Upload request must contain valid multipart form data.", 400);
    }
    const entry = formData.get("file");

    if (!entry || typeof entry === "string") {
      return NextResponse.json({ error: "Choose a CSV file to upload.", code: "INVALID_UPLOAD" }, { status: 400 });
    }
    const filename = entry.name
      .split(/[\\/]/)
      .pop()
      ?.replace(/[\u0000-\u001f\u007f]/g, "")
      .trim();
    if (!filename || filename.length > 255 || !filename.toLowerCase().endsWith(".csv")) {
      return NextResponse.json({ error: "Choose a CSV file with a valid filename.", code: "INVALID_UPLOAD" }, { status: 400 });
    }
    if (entry.size < 1 || entry.size > MAX_CSV_BYTES) {
      return NextResponse.json({ error: "CSV file must be between 1 byte and 25 MB.", code: "CSV_LIMIT_EXCEEDED" }, { status: 413 });
    }

    const bytes = new Uint8Array(await entry.arrayBuffer());
    const text = decodeCsvBytes(bytes);
    const rows = loadFromCSVText(text);

    if (rows.length === 0) {
      return NextResponse.json({ error: "CSV file must contain at least one data row.", code: "INVALID_CSV" }, { status: 400 });
    }

    const profile = getDatasetProfile(rows);
    if (profile.column_count > MAX_CSV_COLUMNS) {
      return NextResponse.json({
        error: `CSV file exceeds the ${MAX_CSV_COLUMNS} column limit after date enrichment.`,
        code: "CSV_LIMIT_EXCEEDED",
      }, { status: 413 });
    }
    const suggested = suggestQuestions(rows, 5);
    const dataset = await createUserDataset(auth.user.id, filename, bytes, rows, profile);

    return NextResponse.json({
      success: true,
      dataset_id: dataset.id,
      filename: dataset.original_filename,
      rows: rows.length,
      profile,
      suggested_questions: suggested,
    }, { status: 201 });
  } catch (e) {
    if (e instanceof RequestBodyError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    if (e instanceof CsvValidationError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    if (e instanceof DatasetStoreError) {
      return NextResponse.json(
        { error: e.message, code: e.code },
        { status: e.code === "DATASET_QUOTA_EXCEEDED" ? 429 : 503 },
      );
    }
    console.error("CSV upload failed", { name: e instanceof Error ? e.name : "UnknownError" });
    return NextResponse.json({ error: "CSV upload failed because dataset storage is unavailable.", code: "DATASET_STORE_FAILED" }, { status: 503 });
  }
}
