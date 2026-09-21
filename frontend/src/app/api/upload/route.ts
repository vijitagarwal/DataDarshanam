import { NextRequest, NextResponse } from "next/server";
import { setDataset, getDatasetProfile, suggestQuestions, loadFromCSVText } from "@/lib/engine/dataEngine";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB
const MAX_UPLOAD_ROWS = 250_000;
const MAX_UPLOAD_COLUMNS = 100;

function getWorkspaceId(req: NextRequest): string {
  const id = req.headers.get("X-Workspace-ID") ?? "default";
  return /^[A-Za-z0-9_-]{8,64}$/.test(id) ? id : "default";
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith(".csv")) {
      return NextResponse.json({ error: "File must be a CSV format" }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: `CSV file exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB limit` }, { status: 413 });
    }

    const text = await file.text();
    const rows = loadFromCSVText(text);

    if (rows.length === 0) {
      return NextResponse.json({ error: "CSV file does not contain any rows" }, { status: 400 });
    }
    if (rows.length > MAX_UPLOAD_ROWS) {
      return NextResponse.json({ error: `CSV file exceeds the ${MAX_UPLOAD_ROWS.toLocaleString()} row limit` }, { status: 413 });
    }
    const colCount = Object.keys(rows[0]).length;
    if (colCount > MAX_UPLOAD_COLUMNS) {
      return NextResponse.json({ error: `CSV file exceeds the ${MAX_UPLOAD_COLUMNS} column limit` }, { status: 413 });
    }

    const workspaceId = getWorkspaceId(req);
    setDataset(workspaceId, rows);

    const profile = getDatasetProfile(rows);
    const suggested = suggestQuestions(rows, 5);

    return NextResponse.json({
      success: true,
      filename: file.name,
      rows: rows.length,
      profile,
      suggested_questions: suggested,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "CSV processing failed" }, { status: 500 });
  }
}
