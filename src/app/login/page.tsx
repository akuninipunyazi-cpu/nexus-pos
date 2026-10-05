"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    if (query.get("type") === "invite" || query.has("token_hash") || hash.get("type") === "invite") {
      const destination = `${window.location.search}${window.location.hash}`;
      router.replace(`/accept-invite${destination}`);
    }
  }, [router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setError("Email or password could not be verified.");
      setLoading(false);
      return;
    }
    router.push("/portal");
    router.refresh();
  }

  return <main className="login-wrap"><aside className="login-aside"><div className="brand"><span className="brand-mark">K</span><span>Kopi Kasir</span></div><div><h1>The shift starts here.</h1><p>A calm workspace for the people who keep every cup moving.</p></div><small>Store operations foundation</small></aside><section className="login-main"><form className="login-card" onSubmit={submit}><p className="eyebrow">Staff access</p><h2>Sign in</h2><p>Use the invitation credentials for your assigned workspace.</p><div className="field"><label htmlFor="email">Email</label><input id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></div><div className="field"><label htmlFor="password">Password</label><input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></div>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button" type="submit" disabled={loading}>{loading ? "Checking access..." : "Sign in"}</button></form></section></main>;
}
