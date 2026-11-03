import type { DatasetProfile } from "./engine/types";

export const DATASET_PROFILE_VERSION = 1;

export function isStoredProfileCompatible(
  stored: unknown,
  sourceHash: string,
  expectedRows: number,
  expectedColumns: number,
): stored is DatasetProfile & { profile_version: number; source_hash: string } {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return false;
  const profile = stored as Record<string, unknown>;
  const columns = profile.columns;
  const stringArray = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((item) => typeof item === "string");
  const validColumns = Array.isArray(columns) && columns.every((column) => {
    if (!column || typeof column !== "object" || Array.isArray(column)) return false;
    const item = column as Record<string, unknown>;
    return typeof item.name === "string" &&
      typeof item.dtype === "string" &&
      ["numeric", "categorical", "date/time", "text"].includes(String(item.role));
  });
  return profile.profile_version === DATASET_PROFILE_VERSION &&
    profile.source_hash === sourceHash &&
    profile.rows === expectedRows &&
    profile.column_count === expectedColumns &&
    validColumns &&
    columns.length === expectedColumns &&
    stringArray(profile.numeric_columns) &&
    stringArray(profile.categorical_columns) &&
    stringArray(profile.date_columns) &&
    stringArray(profile.text_columns);
}
