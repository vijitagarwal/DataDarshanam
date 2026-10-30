import {
  QueryResponse,
  DashboardResponse,
  SchemaResponse,
  UploadResponse,
  QueryResultData,
  DatasetSummary,
} from "./types";
import { DATASET_ID_HEADER, DATASET_MODE_HEADER } from "./constants";
import { getBrowserSupabaseClient } from "./supabase/browser";

// ✅ Same-origin API: frontend and backend are both on the same Vercel deployment.
// All API routes live under /api/* — no external URL or environment variable needed.

const DATASET_MODE_KEY = "datadarshan-dataset-mode";
const DATASET_ID_KEY = "datadarshan-dataset-id";
const DATASET_NAME_KEY = "datadarshan-dataset-name";

function getDatasetMode(): "demo" | "custom" {
  const existingMode = window.localStorage.getItem(DATASET_MODE_KEY);
  if (existingMode === "demo" || existingMode === "custom") return existingMode;

  const hasLegacySelection =
    window.localStorage.getItem("datadarshan-workspace-id") !== null ||
    window.localStorage.getItem(DATASET_ID_KEY) !== null;
  const mode = hasLegacySelection ? "custom" : "demo";
  window.localStorage.setItem(DATASET_MODE_KEY, mode);
  return mode;
}

function getDatasetId(): string | null {
  return window.localStorage.getItem(DATASET_ID_KEY);
}

export function selectDemoDataset(): void {
  window.localStorage.setItem(DATASET_MODE_KEY, "demo");
  window.localStorage.removeItem(DATASET_ID_KEY);
  window.localStorage.removeItem(DATASET_NAME_KEY);
  window.localStorage.removeItem("datadarshan-workspace-id");
}

export function selectCustomDataset(datasetId: string, filename?: string): void {
  window.localStorage.setItem(DATASET_MODE_KEY, "custom");
  window.localStorage.setItem(DATASET_ID_KEY, datasetId);
  if (filename) window.localStorage.setItem(DATASET_NAME_KEY, filename);
  window.localStorage.removeItem("datadarshan-workspace-id");
}

export function clearCustomDatasetSelection(): void {
  window.localStorage.setItem(DATASET_MODE_KEY, "custom");
  window.localStorage.removeItem(DATASET_ID_KEY);
  window.localStorage.removeItem(DATASET_NAME_KEY);
  window.localStorage.removeItem("datadarshan-workspace-id");
}

export function getSelectedDatasetName(): string | null {
  return window.localStorage.getItem(DATASET_NAME_KEY);
}

async function getAccessToken(): Promise<string> {
  try {
    const { data, error } = await getBrowserSupabaseClient().auth.getSession();
    if (error) throw error;
    if (!data.session?.access_token) {
      throw new Error("Sign in to access your saved datasets.");
    }
    return data.session.access_token;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Sign in")) throw error;
    if (error instanceof Error && error.message.includes("not configured")) {
      throw new Error("Supabase authentication is not configured for this environment.");
    }
    throw new Error("Unable to verify your sign-in session. Please try again.");
  }
}

async function fetchApi(
  path: string,
  init?: RequestInit,
  options: { requiresAuth?: boolean; includeDataset?: boolean; datasetId?: string } = {},
): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 60_000);
  try {
    const datasetMode = options.datasetId ? "custom" : getDatasetMode();
    const includeDataset = options.includeDataset !== false;
    const datasetId = options.datasetId ?? (
      includeDataset && datasetMode === "custom" ? getDatasetId() : null
    );
    if (datasetMode === "custom" && includeDataset && !datasetId) {
      throw new Error("No saved CSV is selected. Choose a saved dataset, upload a CSV, or explicitly select the demo dataset.");
    }

    const headers = new Headers(init?.headers);
    headers.set(DATASET_MODE_HEADER, datasetMode);
    if (datasetId) headers.set(DATASET_ID_HEADER, datasetId);
    if (options.requiresAuth ?? (datasetMode === "custom" && includeDataset)) {
      headers.set("Authorization", `Bearer ${await getAccessToken()}`);
    }

    return await fetch(path, {
      ...init,
      headers,
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

export async function fetchSchema(datasetId?: string): Promise<SchemaResponse> {
  const res = await fetchApi("/api/schema", {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  }, datasetId ? { datasetId, includeDataset: true } : undefined);
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
  }, { requiresAuth: true, includeDataset: false });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || errorData.detail || `CSV upload failed (${res.status})`);
  }
  const response = await res.json() as UploadResponse;
  selectCustomDataset(response.dataset_id, response.filename);
  return response;
}

export async function fetchUserDatasets(): Promise<DatasetSummary[]> {
  const response = await fetchApi("/api/datasets", {}, { requiresAuth: true, includeDataset: false });
  const body = await response.json() as {
    success: boolean;
    datasets?: DatasetSummary[];
    error?: { message?: string };
  };
  if (!response.ok || !body.success) {
    throw new Error(body.error?.message ?? `Unable to list saved datasets (${response.status}).`);
  }
  return body.datasets ?? [];
}

export async function deleteUserDataset(datasetId: string): Promise<void> {
  const response = await fetchApi(
    `/api/datasets/${encodeURIComponent(datasetId)}`,
    { method: "DELETE" },
    { requiresAuth: true, includeDataset: false },
  );
  const body = await response.json() as {
    success: boolean;
    error?: { message?: string };
  };
  if (!response.ok || !body.success) {
    throw new Error(body.error?.message ?? `Unable to delete dataset (${response.status}).`);
  }
}
