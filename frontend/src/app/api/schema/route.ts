import { NextRequest, NextResponse } from "next/server";
import { getDataset, loadDefaultData, getDatasetProfile, suggestQuestions } from "@/lib/engine/dataEngine";

export const runtime = "nodejs";
export const maxDuration = 30;

function getWorkspaceId(req: NextRequest): string {
  const id = req.headers.get("X-Workspace-ID") ?? "default";
  return /^[A-Za-z0-9_-]{8,64}$/.test(id) ? id : "default";
}

export async function GET(req: NextRequest) {
  try {
    const workspaceId = getWorkspaceId(req);
    let rows = getDataset(workspaceId);
    if (!rows) rows = await loadDefaultData();

    const profile = getDatasetProfile(rows);
    const suggested = suggestQuestions(rows, 5);
    return NextResponse.json({ profile, suggested_questions: suggested });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Unable to load dataset schema" }, { status: 500 });
  }
}
