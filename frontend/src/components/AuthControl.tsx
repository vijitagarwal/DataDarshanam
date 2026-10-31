"use client";

import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getBrowserSupabaseClient } from "@/lib/supabase/browser";
import { BrandLockup } from "@/components/BrandLockup";
import { Eye, EyeOff, X } from "lucide-react";
import { validateRegistration } from "@/lib/supabase/registration";

interface AuthControlProps {
  isDark: boolean;
  onAuthenticationChange?: (signedIn: boolean) => void;
}

export function AuthControl({ isDark, onAuthenticationChange }: AuthControlProps) {
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [showPassword, setShowPassword] = useState(false);
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
        if (active) {
          const currentUser = data.session?.user ?? null;
          setUser(currentUser);
          onAuthenticationChange?.(Boolean(currentUser));
        }
      }).catch(() => {
        if (active) {
          setConfigured(false);
          onAuthenticationChange?.(false);
        }
      });
      const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
        if (active) {
          setUser(session?.user ?? null);
          onAuthenticationChange?.(Boolean(session?.user));
        }
      });
      return () => {
        active = false;
        subscription.subscription.unsubscribe();
      };
    } catch {
      setConfigured(false);
      onAuthenticationChange?.(false);
      return () => { active = false; };
    }
  }, [onAuthenticationChange]);

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

  function passwordChecks(value: string) {
    return [
      { label: "At least 8 characters", valid: value.length >= 8 },
      { label: "One lowercase letter", valid: /[a-z]/.test(value) },
      { label: "One uppercase letter", valid: /[A-Z]/.test(value) },
      { label: "One number", valid: /\d/.test(value) },
    ];
  }

  async function signUp(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setMessage(null);
    const validation = validateRegistration({ fullName, email, password, confirmPassword });
    if (!validation.valid) {
      setMessage(validation.message ?? "Check the registration details.");
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await getBrowserSupabaseClient().auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { full_name: fullName.trim() },
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) {
        setMessage(error.code === "user_already_exists" || error.code === "email_exists"
          ? "An account already exists for this email. Sign in instead."
          : "We could not create the account. Please try again.");
        return;
      }
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        setMessage("An account already exists for this email. Sign in instead.");
        return;
      }
      if (data.session) {
        setOpen(false);
        setPassword("");
        setConfirmPassword("");
      } else {
        setMessage(`Account created. Check ${email.trim()} for a verification link before signing in.`);
      }
    } catch {
      setMessage("We could not create the account right now.");
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
            <h2 id="sign-in-heading">{mode === "sign-in" ? "Sign in to your account" : "Create your account"}</h2>
          </div>
          <button type="button" className="ledger-icon-button" onClick={() => setOpen(false)} aria-label="Close sign-in dialog">
            <X size={17} aria-hidden="true" />
          </button>
        </div>
        <form onSubmit={mode === "sign-in" ? signIn : signUp}>
          {mode === "sign-up" && (
            <label className="mb-2 block text-xs text-slate-400">
              Full name
              <input required autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} className="ledger-auth-input" />
            </label>
          )}
          <label className="mb-2 block text-xs text-slate-400">
            Email
            <input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="ledger-auth-input" />
          </label>
          <label className="mb-3 block text-xs text-slate-400">
            Password
            <div className="ledger-password-field">
              <input required type={showPassword ? "text" : "password"} minLength={mode === "sign-up" ? 8 : 6} autoComplete={mode === "sign-in" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} className="ledger-auth-input" />
              <button type="button" className="ledger-password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>
          {mode === "sign-up" && (
            <>
              <ul className="ledger-password-checks">
                {passwordChecks(password).map((check) => (
                  <li key={check.label} className={check.valid ? "valid" : ""}>{check.valid ? "✓" : "•"} {check.label}</li>
                ))}
              </ul>
              <label className="mb-3 block text-xs text-slate-400">
                Confirm password
                <input required type={showPassword ? "text" : "password"} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="ledger-auth-input" />
              </label>
            </>
          )}
          {message && <p role="alert" className="mb-2 text-xs text-rose-300">{message}</p>}
          <button type="submit" disabled={busy} className="ledger-button ledger-button-primary w-full">
            {busy ? (mode === "sign-in" ? "Signing in..." : "Creating account...") : (mode === "sign-in" ? "Continue" : "Create account")}
          </button>
        </form>
        <button
          type="button"
          className="ledger-auth-switch"
          disabled={busy}
          onClick={() => { setMode(mode === "sign-in" ? "sign-up" : "sign-in"); setMessage(null); setConfirmPassword(""); }}
        >
          {mode === "sign-in" ? "New to DataDarshanam? Create account" : "Already have an account? Sign in"}
        </button>
        <p className="ledger-caption">Private datasets and document features require an account.</p>
      </dialog>
    </div>
  );
}
