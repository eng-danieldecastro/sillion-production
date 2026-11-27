// Chaves públicas do Supabase (podem ficar no app: o acesso é controlado pelas regras do banco).
export const SUPABASE_URL = "https://fnkoudqdkgwzaspfkeak.supabase.co";
export const SUPABASE_CHAVE_PUBLICA = "sb_publishable_N3Zle2yq6pkIa8K372FV-w_JkcGc3LL";
// O login é por nome de usuário; internamente vira um e-mail técnico neste domínio.
export const DOMINIO_LOGIN = "usuarios.central.local";
// Número da versão: vem do GitHub Actions na hora de gerar o APK.
export const VERSAO_APP: string = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_VERSAO || "dev";
