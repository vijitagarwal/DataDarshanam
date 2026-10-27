import type { User } from "@supabase/supabase-js";
import { createUserSupabaseClient } from "./server";

export interface AuthenticatedUser {
  user: User;
}

export interface AuthFailure {
  error: true;
  code: "UNAUTHENTICATED";
  message: string;
}

export function getBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;

  const match = authorization.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
}

export async function authenticateRequest(
  request: Request,
): Promise<AuthenticatedUser | AuthFailure> {
  const token = getBearerToken(request);
  if (!token) {
    return {
      error: true,
      code: "UNAUTHENTICATED",
      message: "Authentication is required.",
    };
  }

  try {
    const { data, error } = await createUserSupabaseClient(token).auth.getUser(token);
    if (error || !data.user) {
      return {
        error: true,
        code: "UNAUTHENTICATED",
        message: "Authentication is required.",
      };
    }
    return { user: data.user };
  } catch {
    return {
      error: true,
      code: "UNAUTHENTICATED",
      message: "Authentication is required.",
    };
  }
}
