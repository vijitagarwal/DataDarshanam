"use client";

import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getBrowserSupabaseClient } from "@/lib/supabase/browser";
import { BrandLockup } from "@/components/BrandLockup";
import { X } from "lucide-react";

interface AuthControlProps {
  isDark: boolean;
}

export function AuthControl({ isDark }: AuthControlProps) {
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [open, setOpen] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    let active = true;
    try {
      const supabase = getBrowserSupabaseClient();
      void supabase.auth.getSession().then(({ data }) => {
        if (active) setUser(data.session?.user ?? null);
      }).catch(() => {
        if (active) setConfigured(false);
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

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  if (!configured) return <span className="ledger-account-status">Account unavailable</span>;

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
      <div className="ledger-auth-control flex items-center gap-2">
        <span className="max-w-36 truncate text-xs text-slate-400">{user.email}</span>
        <button
          type="button"
          onClick={signOut}
          disabled={busy}
          className="ledger-auth-button"
        >
          {busy ? "Working..." : "Sign out"}
        </button>
      </div>
    );
  }

  return (
    <div className="ledger-auth-control">
      <button
        type="button"
        onClick={() => { setOpen((value) => !value); setMessage(null); }}
        className="ledger-auth-button"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        Sign in
      </button>
      <dialog
        ref={dialogRef}
        className="ledger-auth-dialog"
        aria-labelledby="sign-in-heading"
        onCancel={() => setOpen(false)}
        onClose={() => setOpen(false)}
      >
        <div className="ledger-auth-dialog-heading">
          <div>
            <BrandLockup isDark={isDark} className="ledger-auth-brand" />
            <h2 id="sign-in-heading">Sign in to your account</h2>
          </div>
          <button type="button" className="ledger-icon-button" onClick={() => setOpen(false)} aria-label="Close sign-in dialog">
            <X size={17} aria-hidden="true" />
          </button>
        </div>
        <form onSubmit={signIn}>
          <label className="mb-2 block text-xs text-slate-400">
            Email
            <input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="ledger-auth-input" />
          </label>
          <label className="mb-3 block text-xs text-slate-400">
            Password
            <input required type="password" minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} className="ledger-auth-input" />
          </label>
          {message && <p role="alert" className="mb-2 text-xs text-rose-300">{message}</p>}
          <button type="submit" disabled={busy} className="ledger-button ledger-button-primary w-full">
            {busy ? "Signing in..." : "Continue"}
          </button>
        </form>
        <p className="ledger-caption">Private document features require an existing account. Public sign-up is not available here.</p>
      </dialog>
    </div>
  );
}
