"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getBrowserSupabaseClient } from "@/lib/supabase/browser";

export function AuthControl() {
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [open, setOpen] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    try {
      const supabase = getBrowserSupabaseClient();
      supabase.auth.getSession().then(({ data }) => {
        if (active) setUser(data.session?.user ?? null);
      });
      const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
        if (active) setUser(session?.user ?? null);
      });
      return () => {
        active = false;
        subscription.subscription.unsubscribe();
      };
    } catch {
      setConfigured(false);
      return () => { active = false; };
    }
  }, []);

  if (!configured) return null;

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const { error } = await getBrowserSupabaseClient().auth.signInWithPassword({ email, password });
      if (error) setMessage("Unable to sign in. Check your email and password.");
      else {
        setOpen(false);
        setPassword("");
      }
    } catch {
      setMessage("Unable to sign in right now.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    setMessage(null);
    try {
      const { error } = await getBrowserSupabaseClient().auth.signOut();
      if (error) setMessage("Unable to sign out right now.");
    } catch {
      setMessage("Unable to sign out right now.");
    } finally {
      setBusy(false);
    }
  }

  if (user) {
    return (
      <div className="flex items-center gap-2">
        <span className="hidden max-w-36 truncate text-xs text-slate-400 sm:inline">{user.email}</span>
        <button
          type="button"
          onClick={signOut}
          disabled={busy}
          className="rounded-lg border border-indigo-500/20 px-3 py-1.5 text-xs text-slate-300 transition hover:border-indigo-400/50 hover:text-white disabled:opacity-50"
        >
          {busy ? "Working..." : "Sign out"}
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => { setOpen((value) => !value); setMessage(null); }}
        className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-xs font-medium text-indigo-200 transition hover:bg-indigo-500/20"
      >
        Sign in
      </button>
      {open && (
        <form onSubmit={signIn} className="absolute right-0 top-10 z-30 w-72 rounded-xl border border-indigo-500/20 bg-[#111827] p-4 shadow-2xl">
          <p className="mb-3 text-sm font-semibold text-white">Sign in to manage documents</p>
          <label className="mb-2 block text-xs text-slate-400">
            Email
            <input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2.5 py-2 text-sm text-white outline-none focus:border-indigo-400" />
          </label>
          <label className="mb-3 block text-xs text-slate-400">
            Password
            <input required type="password" minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2.5 py-2 text-sm text-white outline-none focus:border-indigo-400" />
          </label>
          {message && <p role="alert" className="mb-2 text-xs text-rose-300">{message}</p>}
          <button type="submit" disabled={busy} className="w-full rounded-md bg-indigo-500 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-400 disabled:opacity-50">
            {busy ? "Signing in..." : "Continue"}
          </button>
        </form>
      )}
    </div>
  );
}
