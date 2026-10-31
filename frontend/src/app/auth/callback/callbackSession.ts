import { readCallbackUrl } from "./callbackState";

export interface CallbackAuthClient {
  exchangeCodeForSession(code: string): Promise<{ error: unknown | null }>;
  getSession(): Promise<{ data: { session: unknown | null }; error: unknown | null }>;
}

export type CallbackSessionResult =
  | { status: "authenticated"; redirectTo: "/" }
  | { status: "verified" | "invalid"; message: string };

export async function completeCallbackSession(href: string, auth: CallbackAuthClient): Promise<CallbackSessionResult> {
  const { code, errorDescription } = readCallbackUrl(href);
  if (errorDescription) {
    return { status: "invalid", message: "This verification link is invalid or has expired." };
  }
  if (code) {
    let exchange: { error: unknown | null };
    try {
      exchange = await auth.exchangeCodeForSession(code);
    } catch {
      return { status: "invalid", message: "This verification link is invalid or has expired." };
    }
    if (exchange.error) {
      return { status: "invalid", message: "This verification link is invalid or has expired." };
    }
  }
  let sessionResult: { data: { session: unknown | null }; error: unknown | null };
  try {
    sessionResult = await auth.getSession();
  } catch {
    return { status: "invalid", message: "We could not establish your verified session. Sign in to continue." };
  }
  if (sessionResult.error) {
    return { status: "invalid", message: "We could not establish your verified session. Sign in to continue." };
  }
  if (sessionResult.data.session) {
    return { status: "authenticated", redirectTo: "/" };
  }
  return {
    status: "verified",
    message: "Your email has been verified. Sign in to continue.",
  };
}
