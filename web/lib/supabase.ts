"use client";
import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = "https://fnkoudqdkgwzaspfkeak.supabase.co";
export const SUPABASE_CHAVE_PUBLICA = "sb_publishable_N3Zle2yq6pkIa8K372FV-w_JkcGc3LL";
export const DOMINIO_LOGIN = "usuarios.central.local";

export const sb = createClient(SUPABASE_URL, SUPABASE_CHAVE_PUBLICA, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "cps-painel" },
});

export async function adminUsuarios(corpo: Record<string, unknown>) {
  const { data, error } = await sb.functions.invoke("admin-usuarios", { body: corpo });
  if (error) {
    let msg = error.message;
    try { const j = await (error as any).context?.json?.(); if (j?.erro) msg = j.erro; } catch { /* ignora */ }
    throw new Error(msg);
  }
  if (data?.erro) throw new Error(data.erro);
  return data;
}
