import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Lazy Supabase client. The app is offline-first: everything works without
 * Supabase. When the env vars are missing (demo / local), getSupabase()
 * returns null and callers skip cloud sync/auth gracefully.
 */

let client: SupabaseClient | null | undefined;

export function getSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey || !url.startsWith("http")) {
    client = null;
    return client;
  }

  client = createClient(url, anonKey);
  return client;
}

export function isSupabaseConfigured(): boolean {
  return getSupabase() !== null;
}

// ─── TypeScript types for our Supabase schema ─────────────────────────────────
export type ConditionMultipliers = {
  MT: number;
  NM: number;
  EX: number;
  GD: number;
  LP: number;
  PL: number;
  PO: number;
};

export type VendorSettingsRow = {
  id: string;
  vendor_id: string;
  cash_percentage: number;
  trade_percentage: number;
  condition_multipliers: ConditionMultipliers;
  language: string;
  created_at: string;
  updated_at: string;
};
