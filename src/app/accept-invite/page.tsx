"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createInvitationClient } from "@/lib/supabase/client";

type ActivationState = "loading" | "ready" | "submitting" | "error";

function friendlyAuthError(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("expired") || normalized.includes("invalid token") || normalized.includes("otp")) {
    return "This invitation is invalid or has expired. Ask the platform administrator to send a new invitation.";
  }
  if (normalized.includes("password") || normalized.includes("weak")) {
    return "Choose a stronger password that meets the workspace password requirements.";
  }
  return "This invitation could not be activated. Ask the platform administrator to send a new invitation.";
}

function invitationError() {
  return "Open this page from the invitation email. The invitation session could not be found.";
}

export default function AcceptInvitePage() {
  const router = useRouter();
  const [state, setState] = useState<ActivationState>("loading");
  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const callbackSearch = window.location.search;
    const callbackHash = window.location.hash;
    const params = new URLSearchParams(callbackSearch);
    const hashParams = new URLSearchParams(callbackHash.replace(/^#/, ""));
    const code = params.get("code");
    const tokenHash = params.get("token_hash");
    const tokenType = params.get("type");
    // Supabase's invite verification returns an implicit session in the
    // fragment. We only inspect the presence of the callback fields; the
    // Supabase client consumes the token values and we never persist them.
    const implicitInviteContext =
      hashParams.get("type") === "invite" &&
      hashParams.has("access_token") &&
      hashParams.has("refresh_token");
    const inviteContext = Boolean(code || (tokenHash && tokenType === "invite") || implicitInviteContext);

    const supabase = createInvitationClient();
    let active = true;

    async function loadInvitationSession() {
      if (!inviteContext || (tokenType && tokenType !== "invite") || (tokenHash && tokenType !== "invite")) {
        setState("error");
        setError(invitationError());
        return;
      }

      if (params.get("error") || hashParams.get("error")) {
        setState("error");
        setError("This invitation is invalid or has expired. Ask the platform administrator to send a new invitation.");
        return;
      }

      let session = null;

      if (code) {
        const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          if (active) {
            setState("error");
            setError("This invitation is invalid or has expired. Ask the platform administrator to send a new invitation.");
          }
          return;
        }
        session = data.session;
      } else if (tokenHash && tokenType === "invite") {
        const { data, error: verifyError } = await supabase.auth.verifyOtp({ type: "invite", token_hash: tokenHash });
        if (verifyError) {
          if (active) {
            setState("error");
            setError("This invitation is invalid or has expired. Ask the platform administrator to send a new invitation.");
          }
          return;
        }
        session = data.session;
      } else if (implicitInviteContext) {
        // getSession waits for the browser client to finish processing the
        // invitation fragment. This avoids relying on a SIGNED_IN event that
        // may fire before the listener is attached.
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) {
          if (active) {
            setState("error");
            setError(invitationError());
          }
          return;
        }
        session = data.session;
      }

      if (!active) return;
      if (!session?.user) {
        setState("error");
        setError(invitationError());
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role, is_active, tenant_id, email")
        .eq("id", session.user.id)
        .maybeSingle();

      if (profileError || !profile || profile.is_active === false || !profile.tenant_id || !["STORE_OWNER", "CASHIER", "KITCHEN_ADMIN"].includes(profile.role) || profile.email.toLowerCase() !== (session.user.email ?? "").toLowerCase()) {
        setState("error");
        setError("This invitation does not match an active workspace account.");
        return;
      }

      setEmail(session.user.email ?? null);
      setState("ready");
      setError(null);
    }

    void loadInvitationSession();
    return () => {
      active = false;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmation) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setState("submitting");
    setError(null);
    const supabase = createInvitationClient();
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session?.user) {
      setState("error");
      setError(invitationError());
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setState("ready");
      setError(friendlyAuthError(updateError.message));
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role, is_active, tenant_id, email")
      .eq("id", sessionData.session.user.id)
      .maybeSingle();

    if (profileError || !profile || profile.is_active === false || !profile.tenant_id || profile.email.toLowerCase() !== (sessionData.session.user.email ?? "").toLowerCase()) {
      setState("error");
      setError("Your account profile could not be verified. Contact the platform administrator.");
      return;
    }

    router.replace(profile.role === "STORE_OWNER" ? "/store/dashboard" : "/portal");
    router.refresh();
  }

  return <main className="login-wrap"><aside className="login-aside"><div className="brand"><span className="brand-mark">K</span><span>Kopi Kasir</span></div><div><h1>Set up your workspace.</h1><p>Choose a password to finish activating your staff account.</p></div><small>Secure account activation</small></aside><section className="login-main"><form className="login-card" onSubmit={submit}><p className="eyebrow">Account activation</p><h2>Create your password</h2><p>{email ? <>Invitation for <strong>{email}</strong></> : "Complete the invitation from your email."}</p>{state === "loading" && <p className="field-help">Checking your invitation...</p>}{state === "error" && error && <p className="form-error" role="alert">{error}</p>}{state !== "loading" && state !== "error" && <><div className="field"><label htmlFor="password">Password</label><input id="password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={6} required /></div><div className="field"><label htmlFor="confirmation">Confirm password</label><input id="confirmation" type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} minLength={6} required /></div>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button" type="submit" disabled={state === "submitting"}>{state === "submitting" ? "Activating account..." : "Set password"}</button></>}{state === "error" && <a className="secondary-button button-link activation-back" href="/login">Back to sign in</a>}</form></section></main>;
}
