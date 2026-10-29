import { getDataset, loadDefaultData } from "./dataEngine";
import { DATASET_MODE_HEADER, WORKSPACE_ID_HEADER } from "../constants";
import type { DataRow } from "./types";

export { DATASET_MODE_HEADER, WORKSPACE_ID_HEADER } from "../constants";

const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export class DatasetSelectionError extends Error {
  constructor(
    public readonly code: "INVALID_DATASET_SELECTION" | "DATASET_NOT_FOUND",
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "DatasetSelectionError";
  }
}

export function isValidWorkspaceId(value: string): boolean {
  return WORKSPACE_ID_PATTERN.test(value) && value !== "default";
}

export async function resolveRequestDataset(request: Request): Promise<{
  rows: DataRow[];
  mode: "demo" | "custom";
}> {
  const requestedMode = request.headers.get(DATASET_MODE_HEADER);
  const workspaceId = request.headers.get(WORKSPACE_ID_HEADER);

  if (requestedMode !== null && requestedMode !== "demo" && requestedMode !== "custom") {
    throw new DatasetSelectionError(
      "INVALID_DATASET_SELECTION",
      'Dataset mode must be either "demo" or "custom".',
      400,
    );
  }

  // Legacy requests without a workspace selected the bundled dataset. A
  // supplied non-default workspace is treated as a custom-dataset selection.
  const mode = requestedMode ?? (workspaceId && workspaceId !== "default" ? "custom" : "demo");
  if (mode === "demo") {
    return { rows: await loadDefaultData(), mode };
  }

  if (!workspaceId || !isValidWorkspaceId(workspaceId)) {
    throw new DatasetSelectionError(
      "INVALID_DATASET_SELECTION",
      "A valid workspace ID is required for a custom dataset.",
      400,
    );
  }

  const rows = getDataset(workspaceId);
  if (!rows) {
    throw new DatasetSelectionError(
      "DATASET_NOT_FOUND",
      "The selected custom dataset is unavailable. Upload it again or explicitly select the demo dataset.",
      404,
    );
  }

  return { rows, mode };
}
