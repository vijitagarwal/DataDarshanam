export interface CallbackUrlState {
  code: string | null;
  errorDescription: string | null;
}

export function readCallbackUrl(href: string): CallbackUrlState {
  const url = new URL(href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  return {
    code: url.searchParams.get("code"),
    errorDescription: url.searchParams.get("error_description") ?? hash.get("error_description") ??
      (url.searchParams.get("error") ?? hash.get("error") ? "This verification link is invalid or has expired." : null),
  };
}
