// Integração com a planilha "Central Geral (APP)".
// Chamado só pelo script do Google (Apps Script), autenticado por um token próprio.
//  - pendentes: respostas do app que ainda não foram gravadas na planilha
//  - confirmar: marca respostas como gravadas (ou registra o erro)
//  - backup:    guarda as linhas da planilha sem duplicar (uma linha por hash)
//  - pulso:     mantém o projeto ativo
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.119.2";

function resposta(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function sha256(texto: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return resposta({ erro: "Método não permitido" }, 405);
  const servico = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  // Autenticação por token (guardado só como hash no banco)
  const token = req.headers.get("x-token-integracao") || "";
  if (!token) return resposta({ erro: "Token ausente" }, 401);
  const hash = await sha256(token);
  const { data: integ } = await servico.from("integracoes").select("nome").eq("token_hash", hash).maybeSingle();
  if (!integ) return resposta({ erro: "Token inválido" }, 401);

  let corpo: Record<string, any>;
  try { corpo = await req.json(); } catch { return resposta({ erro: "JSON inválido" }, 400); }
  const acao = String(corpo.acao || "");

  if (acao === "pulso") {
    await servico.from("pulsos").insert({ origem: String(corpo.origem || integ.nome) });
    await servico.from("pulsos").delete().lt("em", new Date(Date.now() - 30 * 864e5).toISOString());
    return resposta({ ok: true });
  }

  if (acao === "pendentes") {
    const limite = Math.min(Number(corpo.limite) || 200, 500);
    const { data: formularios } = await servico.from("formularios").select("slug, aba_planilha, colunas_planilha, campos");
    const { data, error } = await servico
      .from("respostas")
      .select("id, formulario, email_registrado, preenchido_em, dados, planilha_tentativas")
      .is("planilha_sincronizada_em", null)
      .lt("planilha_tentativas", 20)
      .order("preenchido_em", { ascending: true })
      .limit(limite);
    if (error) return resposta({ erro: error.message }, 500);
    return resposta({ formularios, respostas: data });
  }

  if (acao === "confirmar") {
    const ok: string[] = corpo.ok || [];
    const falhas: { id: string; erro: string }[] = corpo.falhas || [];
    if (ok.length) {
      await servico.from("respostas")
        .update({ planilha_sincronizada_em: new Date().toISOString(), planilha_erro: null })
        .in("id", ok);
    }
    for (const f of falhas) {
      const { data: atual } = await servico.from("respostas").select("planilha_tentativas").eq("id", f.id).maybeSingle();
      await servico.from("respostas")
        .update({ planilha_erro: String(f.erro).slice(0, 500), planilha_tentativas: (atual?.planilha_tentativas || 0) + 1 })
        .eq("id", f.id);
    }
    return resposta({ ok: true });
  }

  if (acao === "backup") {
    // corpo: { aba, colunas: [...], linhas: [[...], ...], completo: true }
    const aba = String(corpo.aba || "");
    const linhas: unknown[][] = Array.isArray(corpo.linhas) ? corpo.linhas : [];
    if (!aba) return resposta({ erro: "aba obrigatória" }, 400);
    const agora = new Date().toISOString();

    if (Array.isArray(corpo.colunas)) {
      await servico.from("backup_cabecalhos").upsert({ aba, colunas: corpo.colunas, atualizado_em: agora });
    }

    // hash de cada linha (o mesmo conteúdo nunca é gravado duas vezes)
    const porHash = new Map<string, unknown[]>();
    for (const l of linhas) porHash.set(await sha256(JSON.stringify(l)), l);

    // o que já existe para a aba
    const existentes = new Map<string, { id: number; removida_em: string | null }>();
    let de = 0;
    for (;;) {
      const { data, error } = await servico.from("backup_linhas")
        .select("id, hash, removida_em").eq("aba", aba).range(de, de + 999);
      if (error) return resposta({ erro: error.message }, 500);
      for (const r of data || []) existentes.set(r.hash, { id: r.id, removida_em: r.removida_em });
      if (!data || data.length < 1000) break;
      de += 1000;
    }

    const novas = [...porHash.entries()].filter(([h]) => !existentes.has(h))
      .map(([h, linha]) => ({ aba, hash: h, linha }));
    for (let i = 0; i < novas.length; i += 500) {
      const { error } = await servico.from("backup_linhas").insert(novas.slice(i, i + 500));
      if (error) return resposta({ erro: error.message }, 500);
    }

    // linhas que voltaram a existir
    const voltaram = [...existentes.entries()].filter(([h, r]) => r.removida_em && porHash.has(h)).map(([, r]) => r.id);
    for (let i = 0; i < voltaram.length; i += 500) {
      await servico.from("backup_linhas").update({ removida_em: null, visto_ultimo_em: agora }).in("id", voltaram.slice(i, i + 500));
    }

    // linhas que sumiram ou foram editadas (só quando a aba foi enviada inteira)
    let removidas = 0;
    if (corpo.completo) {
      const ids = [...existentes.entries()].filter(([h, r]) => !r.removida_em && !porHash.has(h)).map(([, r]) => r.id);
      removidas = ids.length;
      for (let i = 0; i < ids.length; i += 500) {
        await servico.from("backup_linhas").update({ removida_em: agora }).in("id", ids.slice(i, i + 500));
      }
    }

    await servico.from("backup_execucoes").insert({
      aba, linhas_planilha: linhas.length, novas: novas.length, removidas, status: "OK",
    });
    return resposta({ ok: true, aba, linhas: linhas.length, novas: novas.length, removidas });
  }

  return resposta({ erro: "Ação desconhecida" }, 400);
});
