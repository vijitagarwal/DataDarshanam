"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getBrowserSupabaseClient } from "@/lib/supabase/browser";
import { completeCallbackSession } from "./callbackSession";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [message, setMessage] = useState("Verifying your account...");

  useEffect(() => {
    const completeSignIn = async () => {
      const supabase = getBrowserSupabaseClient();
      const result = await completeCallbackSession(window.location.href, supabase.auth);
      if (result.status === "authenticated") {
        router.replace(result.redirectTo);
        return;
      }
      setMessage(result.message);
    };
    void completeSignIn();
  }, [router]);

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <p role="status">{message}</p>
    </main>
  );
}
