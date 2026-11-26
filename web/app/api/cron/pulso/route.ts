// Chamado pelo cron da Vercel 1x por dia: mantém o Supabase gratuito ativo
// (projetos gratuitos pausam depois de 7 dias sem uso).
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const segredo = process.env.CRON_SECRET;
  if (segredo && req.headers.get("authorization") !== `Bearer ${segredo}`) {
    return Response.json({ erro: "não autorizado" }, { status: 401 });
  }
  const token = process.env.TOKEN_INTEGRACAO_CRON;
  if (!token) return Response.json({ erro: "TOKEN_INTEGRACAO_CRON não configurado" }, { status: 500 });
  const r = await fetch("https://fnkoudqdkgwzaspfkeak.supabase.co/functions/v1/planilha", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-token-integracao": token },
    body: JSON.stringify({ acao: "pulso", origem: "vercel_cron" }),
    cache: "no-store",
  });
  return Response.json({ ok: r.ok, status: r.status, em: new Date().toISOString() }, { status: r.ok ? 200 : 502 });
}
