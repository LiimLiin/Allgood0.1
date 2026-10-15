import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { asVolumes, type Volume } from "@/lib/notes";

let client: SupabaseClient | null = null;

export function isRemoteStore(): boolean {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
}

export function getSupabase(): SupabaseClient | null {
  if (!isRemoteStore()) return null;
  if (!client) {
    client = createClient(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SUPABASE_ANON_KEY,
      { auth: { persistSession: true, autoRefreshToken: true } },
    );
  }
  return client;
}

export async function fetchManuscript(): Promise<Volume[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb.from("manuscript").select("volumes").eq("id", 1).maybeSingle();
  if (error) throw error;
  return asVolumes(data?.volumes) ?? [];
}

export async function saveManuscript(volumes: Volume[]): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.from("manuscript").update({ volumes }).eq("id", 1);
  if (error) throw error;
}

export async function isEditor(email: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { data, error } = await sb.from("editors").select("email").ilike("email", email).maybeSingle();
  if (error) return false;
  return Boolean(data);
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("还没有接上稿库");
  const { error } = await sb.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  await getSupabase()?.auth.signOut();
}

export function explainAuthError(message: string): string {
  if (/invalid login/i.test(message)) return "邮箱或密码不对。";
  if (/not confirmed/i.test(message)) return "这个邮箱还没确认。";
  if (/row-level|permission|42501/i.test(message)) return "这个邮箱不在可修改名单里。";
  return "没有写上。请稍后再试。";
}
