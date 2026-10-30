import { loadDefaultData } from "./dataEngine";
import { DATASET_ID_HEADER, DATASET_MODE_HEADER } from "../constants";
import { authenticateRequest } from "@/lib/supabase/auth";
import { DatasetStoreError, loadUserDatasetRows } from "@/lib/supabase/datasets";
import type { DataRow } from "./types";

export { DATASET_ID_HEADER, DATASET_MODE_HEADER } from "../constants";

const DATASET_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class DatasetSelectionError extends Error {
  constructor(
    public readonly code:
      | "INVALID_DATASET_SELECTION"
      | "DATASET_NOT_FOUND"
      | "DATASET_UNAVAILABLE"
      | "UNAUTHENTICATED",
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "DatasetSelectionError";
  }
}

export function isValidDatasetId(value: string): boolean {
  return DATASET_ID_PATTERN.test(value);
}

export async function resolveRequestDataset(request: Request): Promise<{
  rows: DataRow[];
  mode: "demo" | "custom";
  dataset?: { id: string; original_filename: string };
}> {
  const requestedMode = request.headers.get(DATASET_MODE_HEADER);
  const datasetId = request.headers.get(DATASET_ID_HEADER);
  const legacyWorkspaceId = request.headers.get("X-Workspace-ID");

  if (requestedMode !== null && requestedMode !== "demo" && requestedMode !== "custom") {
    throw new DatasetSelectionError(
      "INVALID_DATASET_SELECTION",
      'Dataset mode must be either "demo" or "custom".',
      400,
    );
  }

  const mode = requestedMode ?? (datasetId || legacyWorkspaceId ? "custom" : "demo");
  if (mode === "demo") {
    return { rows: await loadDefaultData(), mode };
  }

  if (!datasetId || !isValidDatasetId(datasetId)) {
    throw new DatasetSelectionError(
      datasetId ? "INVALID_DATASET_SELECTION" : "DATASET_NOT_FOUND",
      "The selected custom dataset is unavailable. Select a saved dataset, upload a CSV, or explicitly select the demo dataset.",
      datasetId ? 400 : 404,
    );
  }

  const auth = await authenticateRequest(request);
  if ("error" in auth) {
    throw new DatasetSelectionError(
      "UNAUTHENTICATED",
      auth.message,
      401,
    );
  }

  try {
    const stored = await loadUserDatasetRows(auth.user.id, datasetId);
    if (!stored) {
      throw new DatasetSelectionError(
        "DATASET_NOT_FOUND",
        "The selected custom dataset is unavailable. Select a saved dataset, upload a CSV, or explicitly select the demo dataset.",
        404,
      );
    }
    return {
      rows: stored.rows,
      mode,
      dataset: { id: stored.dataset.id, original_filename: stored.dataset.original_filename },
    };
  } catch (error) {
    if (error instanceof DatasetSelectionError) throw error;
    if (error instanceof DatasetStoreError) {
      throw new DatasetSelectionError("DATASET_UNAVAILABLE", error.message, 503);
    }
    throw error;
  }
}
