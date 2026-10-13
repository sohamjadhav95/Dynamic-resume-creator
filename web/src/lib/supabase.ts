// Supabase client (accounts + cloud storage). Optional: without config the app runs in guest mode.

import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { getConfig } from "./api";

let clientPromise: Promise<SupabaseClient | null> | null = null;

export function getSupabase(): Promise<SupabaseClient | null> {
  if (!clientPromise) {
    clientPromise = getConfig().then(async (cfg) => {
      if (!cfg.supabase) return null;
      const { createClient } = await import("@supabase/supabase-js");
      return createClient(cfg.supabase.url, cfg.supabase.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
      });
    });
  }
  return clientPromise;
}

let currentSession: Session | null = null;

export async function getAccessToken(): Promise<string | null> {
  if (currentSession?.access_token) return currentSession.access_token;
  const sb = await getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  currentSession = data.session;
  return data.session?.access_token ?? null;
}

export async function watchSession(cb: (s: Session | null) => void): Promise<() => void> {
  const sb = await getSupabase();
  if (!sb) {
    cb(null);
    return () => {};
  }
  const { data } = await sb.auth.getSession();
  currentSession = data.session;
  cb(data.session);
  const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
    currentSession = session;
    cb(session);
  });
  return () => sub.subscription.unsubscribe();
}

export async function signInWithGoogle(): Promise<void> {
  const sb = await getSupabase();
  if (!sb) throw new Error("Accounts are not available right now.");
  const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
  if (error) throw error;
}

export async function signInWithEmail(email: string): Promise<void> {
  const sb = await getSupabase();
  if (!sb) throw new Error("Accounts are not available right now.");
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const sb = await getSupabase();
  await sb?.auth.signOut();
  currentSession = null;
}
