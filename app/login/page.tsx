"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { useT } from "@/context/SettingsContext";

export default function LoginPage() {
  const router = useRouter();
  const { tr } = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const supabase = getSupabase();
      if (!supabase) {
        // Demo mode — no Supabase configured, the app works fully offline
        router.push("/zoeken");
        return;
      }
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        router.push("/zoeken");
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        // First time: go to instellingen
        router.push("/instellingen");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("something_wrong"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-dvh bg-base flex flex-col justify-between w-full max-w-[480px] mx-auto">
      {/* Status bar spacer */}
      <div className="h-10" />

      <div className="flex-1 flex flex-col justify-center px-7 stagger">
        {/* Logo */}
        <div className="flex flex-col items-center mb-10">
          <div className="w-[72px] h-[72px] rounded-[20px] bg-gradient-to-b from-gold to-gold-deep flex items-center justify-center mb-5 shadow-[0_0_50px_rgba(240,180,64,0.3)] animate-glowpulse">
            <div className="w-7 h-7 bg-base rounded-[6px] rotate-45" />
          </div>
          <h1 className="text-[38px] font-black tracking-[-0.03em] text-content">
            Card<span className="text-gold">Pit</span>
          </h1>
          <p className="text-[15px] text-content-dim italic mt-1">
            &ldquo;Built for the table.&rdquo;
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {/* Email */}
          <div className="flex items-center gap-3 ticket border border-edge rounded-2xl h-14 px-4 focus-within:border-gold/50 transition-colors">
            <span className="ms text-[20px] text-content-dim flex-none">mail</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={tr("email")}
              required
              className="flex-1 bg-transparent border-none outline-none text-content text-[15px] font-medium placeholder:text-content-faint min-w-0"
            />
          </div>

          {/* Password */}
          <div className="flex items-center gap-3 ticket border border-edge rounded-2xl h-14 px-4 focus-within:border-gold/50 transition-colors">
            <span className="ms text-[20px] text-content-dim flex-none">lock</span>
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={tr("password")}
              required
              className="flex-1 bg-transparent border-none outline-none text-content text-[15px] font-medium placeholder:text-content-faint min-w-0"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="flex-none text-content-dim"
            >
              <span className="ms text-[20px]">
                {showPassword ? "visibility" : "visibility_off"}
              </span>
            </button>
          </div>

          {/* Error */}
          {error && (
            <p className="text-danger text-[13px] font-medium px-1 animate-rise">{error}</p>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="press mt-2 h-14 rounded-2xl bg-gradient-to-b from-gold to-gold-deep text-base font-extrabold text-[16px] shadow-[0_0_24px_rgba(240,180,64,0.3)] disabled:opacity-60"
          >
            {loading
              ? tr("patience")
              : mode === "login"
              ? tr("login")
              : tr("create_account")}
          </button>

          {/* Mode toggle */}
          <p className="text-center text-[14px] text-content-dim mt-2">
            {mode === "login" ? (
              <>
                {tr("no_account")}{" "}
                <button
                  type="button"
                  onClick={() => setMode("register")}
                  className="text-gold font-bold"
                >
                  {tr("register")}
                </button>
              </>
            ) : (
              <>
                {tr("have_account")}{" "}
                <button
                  type="button"
                  onClick={() => setMode("login")}
                  className="text-gold font-bold"
                >
                  {tr("login")}
                </button>
              </>
            )}
          </p>
        </form>
      </div>

      <p className="text-center text-[12px] text-content-ghost pb-8">
        {tr("footer")}
      </p>
    </div>
  );
}
