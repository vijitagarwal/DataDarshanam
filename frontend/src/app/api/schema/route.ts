import { NextRequest, NextResponse } from "next/server";
import { getDatasetProfile, suggestQuestions } from "@/lib/engine/dataEngine";
import { DatasetSelectionError, resolveRequestDataset } from "@/lib/engine/datasetSelection";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  try {
    const { rows, dataset } = await resolveRequestDataset(req);

    const profile = getDatasetProfile(rows);
    const suggested = suggestQuestions(rows, 5);
    return NextResponse.json({
      profile,
      suggested_questions: suggested,
      ...(dataset ? { dataset_id: dataset.id, filename: dataset.original_filename } : {}),
    });
  } catch (e) {
    if (e instanceof DatasetSelectionError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Unable to load dataset schema" }, { status: 500 });
  }
}
