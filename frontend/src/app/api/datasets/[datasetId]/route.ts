import { NextResponse } from "next/server";
import { isValidDatasetId } from "@/lib/engine/datasetSelection";
import { authenticateRequest } from "@/lib/supabase/auth";
import { DatasetStoreError, deleteUserDataset } from "@/lib/supabase/datasets";

export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ datasetId: string }> },
) {
  const auth = await authenticateRequest(request);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth }, { status: 401 });
  }

  const { datasetId } = await context.params;
  if (!isValidDatasetId(datasetId)) {
    return NextResponse.json({
      success: false,
      error: { code: "INVALID_DATASET_ID", message: "The dataset ID is invalid." },
    }, { status: 400 });
  }

  try {
    const deleted = await deleteUserDataset(auth.user.id, datasetId);
    if (!deleted) {
      return NextResponse.json({
        success: false,
        error: { code: "DATASET_NOT_FOUND", message: "The dataset was not found." },
      }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof DatasetStoreError) {
      return NextResponse.json({
        success: false,
        error: { code: error.code, message: error.message },
      }, { status: 503 });
    }
    console.error("Dataset deletion failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({
      success: false,
      error: { code: "DATASET_STORE_FAILED", message: "Unable to delete the dataset." },
    }, { status: 503 });
  }
}
