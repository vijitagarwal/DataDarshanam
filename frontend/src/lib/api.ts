import { QueryResponse, DashboardResponse, SchemaResponse, UploadResponse, QueryResultData } from "./types";

// ✅ Same-origin API: frontend and backend are both on the same Vercel deployment.
// All API routes live under /api/* — no external URL or environment variable needed.

function getWorkspaceId(): string {
  const key = "datadarshan-workspace-id";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  window.localStorage.setItem(key, created);
  return created;
}

async function fetchApi(path: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 60_000);
  try {
    return await fetch(path, {
      ...init,
      headers: {
        ...(init?.headers || {}),
        "X-Workspace-ID": getWorkspaceId(),
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
    throw new Error(errorData.error || errorData.detail || `Query failed (${res.status})`);
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
    throw new Error(errorData.error || errorData.detail || `Dashboard generation failed (${res.status})`);
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
  return res.json();
}
