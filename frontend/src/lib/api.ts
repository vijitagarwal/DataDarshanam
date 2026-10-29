import { QueryResponse, DashboardResponse, SchemaResponse, UploadResponse, QueryResultData } from "./types";
import { DATASET_MODE_HEADER, WORKSPACE_ID_HEADER } from "./constants";

// ✅ Same-origin API: frontend and backend are both on the same Vercel deployment.
// All API routes live under /api/* — no external URL or environment variable needed.

const WORKSPACE_ID_KEY = "datadarshan-workspace-id";
const DATASET_MODE_KEY = "datadarshan-dataset-mode";

function getDatasetMode(): "demo" | "custom" {
  const existingMode = window.localStorage.getItem(DATASET_MODE_KEY);
  if (existingMode === "demo" || existingMode === "custom") return existingMode;

  const hasLegacyWorkspace = window.localStorage.getItem(WORKSPACE_ID_KEY) !== null;
  const mode = hasLegacyWorkspace ? "custom" : "demo";
  window.localStorage.setItem(DATASET_MODE_KEY, mode);
  return mode;
}

function getWorkspaceId(): string {
  const existing = window.localStorage.getItem(WORKSPACE_ID_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  window.localStorage.setItem(WORKSPACE_ID_KEY, created);
  return created;
}

export function selectDemoDataset(): void {
  window.localStorage.setItem(DATASET_MODE_KEY, "demo");
}

async function fetchApi(path: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 60_000);
  try {
    const datasetMode = getDatasetMode();
    const workspaceId = getWorkspaceId();
    return await fetch(path, {
      ...init,
      headers: {
        ...(init?.headers || {}),
        [WORKSPACE_ID_HEADER]: workspaceId,
        [DATASET_MODE_HEADER]: datasetMode,
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("The request timed out. Please try again.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function fetchSchema(): Promise<SchemaResponse> {
  const res = await fetchApi("/api/schema", {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to fetch dataset schema: ${res.statusText}`);
  }
  return res.json();
}

export async function postQuery(
  query: string,
  previousContext?: QueryResultData
): Promise<QueryResponse> {
  const res = await fetchApi("/api/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      previous_context: previousContext || null,
    }),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error((typeof errorData.error === "string" && errorData.error) ||
      errorData.message || errorData.detail || `Query failed (${res.status})`);
  }
  return res.json();
}

export async function postDashboardQuery(
  query: string = "generate full dashboard overview"
): Promise<DashboardResponse> {
  const res = await fetchApi("/api/dashboard", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error((typeof errorData.error === "string" && errorData.error) ||
      errorData.message || errorData.detail || `Dashboard generation failed (${res.status})`);
  }
  return res.json();
}

export async function uploadCSVFile(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetchApi("/api/upload", {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || errorData.detail || `CSV upload failed (${res.status})`);
  }
  const response = await res.json() as UploadResponse;
  window.localStorage.setItem(DATASET_MODE_KEY, "custom");
  return response;
}
