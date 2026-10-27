import type { SupabaseClient } from "@supabase/supabase-js";

export interface OwnedDocument {
  id: string;
  user_id: string;
  display_name: string;
  status: string;
}

export async function getOwnedDocument(
  client: SupabaseClient,
  userId: string,
  documentId: string,
): Promise<{ document: OwnedDocument | null; error: Error | null }> {
  const { data, error } = await client
    .from("documents")
    .select("id,user_id,display_name,status")
    .eq("id", documentId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return { document: null, error };
  return { document: data as OwnedDocument | null, error: null };
}
