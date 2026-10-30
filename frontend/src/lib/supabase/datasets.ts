import { randomUUID } from "node:crypto";
import type { DatasetProfile, DataRow } from "@/lib/engine/types";
import type { DatasetSummary } from "@/lib/types";
import { decodeCsvBytes } from "@/lib/engine/csv";
import { getDatasetProfile, loadFromCSVText } from "@/lib/engine/dataEngine";
import { createServiceRoleSupabaseClient } from "./server";

export const DATASET_BUCKET = "datasets";

interface DatasetRecord extends DatasetSummary {
  user_id: string;
  storage_bucket: string;
  storage_path: string;
  status: "uploading" | "ready" | "failed" | "deleting";
  schema: Record<string, unknown>;
}

export class DatasetStoreError extends Error {
  constructor(
    public readonly code: "DATASET_STORE_FAILED" | "DATASET_QUOTA_EXCEEDED" | "DATASET_FILE_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "DatasetStoreError";
  }
}

function safeProfile(profile: DatasetProfile): Record<string, unknown> {
  return {
    rows: profile.rows,
    column_count: profile.column_count,
    columns: profile.columns.map(({ name, dtype, role, unique, missing, missing_pct }) => ({
      name,
      dtype,
      role,
      unique,
      missing,
      missing_pct,
    })),
    numeric_columns: profile.numeric_columns,
    categorical_columns: profile.categorical_columns,
    date_columns: profile.date_columns,
    text_columns: profile.text_columns,
  };
}

function mapDataset(record: DatasetRecord): DatasetSummary {
  return {
    id: record.id,
    original_filename: record.original_filename,
    file_size: Number(record.file_size),
    row_count: Number(record.row_count),
    column_count: Number(record.column_count),
    created_at: record.created_at,
    status: record.status,
  };
}

export async function listUserDatasets(userId: string): Promise<DatasetSummary[]> {
  const { data, error } = await createServiceRoleSupabaseClient()
    .from("datasets")
    .select("id,user_id,original_filename,file_size,row_count,column_count,created_at,storage_bucket,storage_path,status,schema")
    .eq("user_id", userId)
    .in("status", ["uploading", "ready", "failed", "deleting"])
    .order("created_at", { ascending: false });

  if (error) {
    throw new DatasetStoreError("DATASET_STORE_FAILED", "Unable to list saved datasets.");
  }
  return ((data ?? []) as DatasetRecord[]).map(mapDataset);
}

async function findUserDataset(
  userId: string,
  datasetId: string,
  statuses: string[] = ["ready"],
  client = createServiceRoleSupabaseClient(),
): Promise<DatasetRecord | null> {
  const { data, error } = await client
    .from("datasets")
    .select("id,user_id,original_filename,file_size,row_count,column_count,created_at,storage_bucket,storage_path,status,schema")
    .eq("id", datasetId)
    .eq("user_id", userId)
    .in("status", statuses)
    .maybeSingle();

  if (error) {
    throw new DatasetStoreError("DATASET_STORE_FAILED", "Unable to load the selected dataset.");
  }
  return data as DatasetRecord | null;
}

export async function loadUserDatasetRows(
  userId: string,
  datasetId: string,
): Promise<{ dataset: DatasetSummary; rows: DataRow[] } | null> {
  const client = createServiceRoleSupabaseClient();
  const record = await findUserDataset(userId, datasetId, ["ready"], client);
  if (!record) return null;

  const { data, error } = await client.storage
    .from(DATASET_BUCKET)
    .download(record.storage_path);
  if (error || !data) {
    throw new DatasetStoreError("DATASET_FILE_UNAVAILABLE", "The saved dataset file is unavailable.");
  }

  let rows: DataRow[];
  try {
    rows = loadFromCSVText(decodeCsvBytes(new Uint8Array(await data.arrayBuffer())));
  } catch {
    throw new DatasetStoreError("DATASET_FILE_UNAVAILABLE", "The saved dataset file failed its integrity check.");
  }
  if (rows.length !== record.row_count || (rows.length > 0 && getDatasetProfile(rows).column_count !== record.column_count)) {
    throw new DatasetStoreError("DATASET_FILE_UNAVAILABLE", "The saved dataset file failed its integrity check.");
  }

  return { dataset: mapDataset(record), rows };
}

async function removeReservation(
  client: ReturnType<typeof createServiceRoleSupabaseClient>,
  userId: string,
  datasetId: string,
  storagePath: string,
  removeFile: boolean,
): Promise<void> {
  if (removeFile) {
    try {
      const { error } = await client.storage.from(DATASET_BUCKET).remove([storagePath]);
      if (error) console.error("Dataset upload cleanup failed", { code: error.name ?? "STORAGE_ERROR" });
    } catch {
      console.error("Dataset upload cleanup failed");
    }
  }
  try {
    const { error } = await client
      .from("datasets")
      .delete()
      .eq("id", datasetId)
      .eq("user_id", userId)
      .eq("status", "uploading");
    if (error) console.error("Dataset reservation cleanup failed", { code: error.code ?? "DATABASE_ERROR" });
  } catch {
    console.error("Dataset reservation cleanup failed");
  }
}

export async function createUserDataset(
  userId: string,
  filename: string,
  bytes: Uint8Array,
  rows: DataRow[],
  profile: DatasetProfile,
): Promise<DatasetSummary> {
  const client = createServiceRoleSupabaseClient();
  const id = randomUUID();
  const storagePath = `${userId}/${id}.csv`;
  let reserveError: { code?: string } | null;
  try {
    const result = await client.rpc("reserve_user_dataset", {
      p_dataset_id: id,
      p_user_id: userId,
      p_original_filename: filename,
      p_storage_path: storagePath,
      p_file_size: bytes.byteLength,
    });
    reserveError = result.error;
  } catch {
    await removeReservation(client, userId, id, storagePath, false);
    throw new DatasetStoreError("DATASET_STORE_FAILED", "Unable to reserve storage for this dataset.");
  }

  if (reserveError) {
    if (reserveError.code === "54000") {
      throw new DatasetStoreError(
        "DATASET_QUOTA_EXCEEDED",
        "Your saved-dataset limit has been reached. Delete a dataset before uploading another.",
      );
    }
    await removeReservation(client, userId, id, storagePath, false);
    throw new DatasetStoreError("DATASET_STORE_FAILED", "Unable to reserve storage for this dataset.");
  }

  try {
    const { error: uploadError } = await client.storage
      .from(DATASET_BUCKET)
      .upload(storagePath, Buffer.from(bytes), { contentType: "text/csv", upsert: false });
    if (uploadError) throw uploadError;
  } catch {
    await removeReservation(client, userId, id, storagePath, true);
    throw new DatasetStoreError("DATASET_STORE_FAILED", "Unable to save the CSV file.");
  }

  const safeSchema = safeProfile(profile);
  try {
    const { data, error: completeError } = await client
      .from("datasets")
      .update({
        row_count: rows.length,
        column_count: profile.column_count,
        schema: safeSchema,
        status: "ready",
        completed_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", userId)
      .eq("status", "uploading")
      .select("id,user_id,original_filename,file_size,row_count,column_count,created_at,storage_bucket,storage_path,status,schema")
      .single();
    if (completeError || !data) throw new Error("Dataset metadata completion failed.");
    return mapDataset(data as DatasetRecord);
  } catch {
    await removeReservation(client, userId, id, storagePath, true);
    throw new DatasetStoreError("DATASET_STORE_FAILED", "Unable to finish saving the CSV dataset.");
  }
}

export async function deleteUserDataset(userId: string, datasetId: string): Promise<boolean> {
  const client = createServiceRoleSupabaseClient();
  const record = await findUserDataset(
    userId,
    datasetId,
    ["uploading", "ready", "failed", "deleting"],
    client,
  );
  if (!record) return false;

  if (record.status !== "deleting") {
    const { data: marked, error: markError } = await client
      .from("datasets")
      .update({ status: "deleting" })
      .eq("id", datasetId)
      .eq("user_id", userId)
      .eq("status", record.status)
      .select("id")
      .maybeSingle();
    if (markError) {
      throw new DatasetStoreError("DATASET_STORE_FAILED", "Unable to prepare the dataset for deletion.");
    }
    if (!marked) return false;
  }

  const { error: storageError } = await client.storage
    .from(DATASET_BUCKET)
    .remove([record.storage_path]);
  if (storageError) {
    if (record.status === "ready") {
      const { error: restoreError } = await client
        .from("datasets")
        .update({ status: "ready" })
        .eq("id", datasetId)
        .eq("user_id", userId)
        .eq("status", "deleting");
      if (restoreError) console.error("Dataset delete recovery failed", { code: restoreError.code ?? "DATABASE_ERROR" });
    }
    throw new DatasetStoreError("DATASET_STORE_FAILED", "Unable to remove the dataset file.");
  }

  const { error: deleteError } = await client
    .from("datasets")
    .delete()
    .eq("id", datasetId)
    .eq("user_id", userId)
    .eq("status", "deleting");
  if (deleteError) {
    throw new DatasetStoreError("DATASET_STORE_FAILED", "The file was removed, but dataset metadata could not be deleted.");
  }
  return true;
}
