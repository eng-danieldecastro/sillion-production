// Gestão de usuários do app (somente administradores).
// Chamado pelo painel web com o token de sessão do administrador.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.119.2";

const DOMINIO_LOGIN = "usuarios.central.local";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function resposta(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function normalizarUsuario(u: string) {
  return String(u || "").trim().toLowerCase();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return resposta({ erro: "Método não permitido" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const servico = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  // Quem está chamando?
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: quem, error: erroQuem } = await servico.auth.getUser(jwt);
  if (erroQuem || !quem?.user) return resposta({ erro: "Sessão inválida" }, 401);
  const { data: perfilChamador } = await servico
    .from("perfis").select("papel, ativo").eq("id", quem.user.id).maybeSingle();
  if (!perfilChamador || perfilChamador.papel !== "admin" || !perfilChamador.ativo) {
    return resposta({ erro: "Acesso restrito ao administrador" }, 403);
  }

  let corpo: Record<string, unknown>;
  try { corpo = await req.json(); } catch { return resposta({ erro: "JSON inválido" }, 400); }
  const acao = String(corpo.acao || "");

  if (acao === "listar") {
    const { data, error } = await servico
      .from("perfis")
      .select("id, nome, usuario, email_sillion, papel, ativo, trocar_senha, criado_em, atualizado_em")
      .order("nome");
    if (error) return resposta({ erro: error.message }, 500);
    // último acesso
    const { data: lista } = await servico.auth.admin.listUsers({ perPage: 1000 });
    const ultimo = new Map((lista?.users || []).map((u) => [u.id, u.last_sign_in_at]));
    return resposta({ usuarios: (data || []).map((p) => ({ ...p, ultimo_acesso: ultimo.get(p.id) || null })) });
  }

  if (acao === "criar") {
    const nome = String(corpo.nome || "").trim();
    const usuario = normalizarUsuario(String(corpo.usuario || ""));
    const senha = String(corpo.senha || "");
    const papel = corpo.papel === "admin" ? "admin" : "operador";
    const email = String(corpo.email_sillion || "").trim().toLowerCase() || null;
    if (!nome || !/^[a-z0-9._-]{3,40}$/.test(usuario)) {
      return resposta({ erro: "Informe nome e um usuário com 3 a 40 letras, números, ponto, hífen ou sublinhado." }, 400);
    }
    if (senha.length < 6) return resposta({ erro: "A senha precisa ter pelo menos 6 caracteres." }, 400);
    const { data: criado, error } = await servico.auth.admin.createUser({
      email: `${usuario}@${DOMINIO_LOGIN}`,
      password: senha,
      email_confirm: true,
      user_metadata: { nome },
    });
    if (error || !criado?.user) {
      const msg = /already/i.test(error?.message || "") ? "Esse usuário já existe." : (error?.message || "Erro ao criar");
      return resposta({ erro: msg }, 400);
    }
    const { error: erroPerfil } = await servico.from("perfis").insert({
      id: criado.user.id, nome, usuario, email_sillion: email, papel,
      trocar_senha: corpo.trocar_senha === false ? false : true,
    });
    if (erroPerfil) {
      await servico.auth.admin.deleteUser(criado.user.id);
      return resposta({ erro: erroPerfil.message }, 400);
    }
    return resposta({ ok: true, id: criado.user.id });
  }

  if (acao === "atualizar") {
    const id = String(corpo.id || "");
    if (!id) return resposta({ erro: "id obrigatório" }, 400);
    if (id === quem.user.id && (corpo.ativo === false || corpo.papel === "operador")) {
      return resposta({ erro: "Você não pode bloquear nem rebaixar a sua própria conta." }, 400);
    }
    const mudancas: Record<string, unknown> = { atualizado_em: new Date().toISOString() };
    if (typeof corpo.nome === "string") mudancas.nome = corpo.nome.trim();
    if (typeof corpo.email_sillion === "string") mudancas.email_sillion = corpo.email_sillion.trim().toLowerCase() || null;
    if (corpo.papel === "admin" || corpo.papel === "operador") mudancas.papel = corpo.papel;
    if (typeof corpo.ativo === "boolean") mudancas.ativo = corpo.ativo;

    let encerrar = false;
    if (typeof corpo.senha === "string" && corpo.senha) {
      if (corpo.senha.length < 6) return resposta({ erro: "A senha precisa ter pelo menos 6 caracteres." }, 400);
      const { error } = await servico.auth.admin.updateUserById(id, { password: corpo.senha });
      if (error) return resposta({ erro: error.message }, 400);
      mudancas.trocar_senha = corpo.trocar_senha === false ? false : true;
      encerrar = true;
    }
    if (typeof corpo.ativo === "boolean") {
      await servico.auth.admin.updateUserById(id, { ban_duration: corpo.ativo ? "none" : "876000h" });
      if (!corpo.ativo) encerrar = true;
    }
    const { error } = await servico.from("perfis").update(mudancas).eq("id", id);
    if (error) return resposta({ erro: error.message }, 400);
    // Troca de senha ou bloqueio: o app desse usuário pede login de novo.
    if (encerrar) await servico.rpc("encerrar_sessoes", { p_usuario: id });
    return resposta({ ok: true });
  }

  return resposta({ erro: "Ação desconhecida" }, 400);
});
