import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/supabase/auth";
import { DatasetStoreError, listUserDatasets } from "@/lib/supabase/datasets";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth }, { status: 401 });
  }

  try {
    const datasets = await listUserDatasets(auth.user.id);
    return NextResponse.json({ success: true, datasets });
  } catch (error) {
    if (error instanceof DatasetStoreError) {
      return NextResponse.json({
        success: false,
        error: { code: error.code, message: error.message },
      }, { status: 503 });
    }
    console.error("Dataset listing failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({
      success: false,
      error: { code: "DATASET_STORE_FAILED", message: "Unable to list saved datasets." },
    }, { status: 503 });
  }
}
