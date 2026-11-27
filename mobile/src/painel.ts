// Dashboard do aplicativo. Os números vêm prontos do banco (função painel_resumo),
// calculados a partir do backup da planilha "Central Geral (APP)".
// Operador vê só os cartões; administrador vê também variação, tendência e detalhes.
import type { SupabaseClient } from "@supabase/supabase-js";

type Periodo = "hoje" | "7d" | "30d" | "mes";
interface Contagem { [k: string]: number }
interface Item { nome: string; n: number; grupo?: string }
interface Resumo {
  admin: boolean;
  periodo: { inicio: string; fim: string };
  dados_ate: string | null;
  std: Contagem;
  streamax: Contagem;
  cameras: null | { solucionadas: number; a_reparar: number; aguardando_pecas: number; reparos_periodo: number; atualizado_em: string };
  fornecedor: null | { no_fornecedor: number; atrasados: number; prazo_dias: number; por_fornecedor: Item[]; atualizado_em: string };
  anterior?: { std: Contagem; streamax: Contagem };
  serie?: { dia: string; std: number; stx: number; prob: number }[];
  std_grupos?: Contagem;
  std_top?: Item[];
  stx_top?: Item[];
  comp_grupos?: Contagem;
  comp_top?: Item[];
}

const CHAVE_CACHE = "cps-painel";
const ROTULO_PERIODO: Record<Periodo, string> = { hoje: "Hoje", "7d": "7 dias", "30d": "30 dias", mes: "Mês" };
// Cores validadas para daltonismo (ver skill de visualização). Texto nunca usa a cor da série.
const COR = { std: "#257de0", stx: "#f47230", Hardware: "#6a4ce2", Software: "#00b894", Outros: "#f2a600" } as Record<string, string>;
const GRUPOS = ["Hardware", "Software", "Outros"];

let periodo: Periodo = "7d";

function esc(t: unknown) {
  return String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
const fmt = (n: number) => (n || 0).toLocaleString("pt-BR");
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

function iso(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function intervalo(p: Periodo): [string, string] {
  const hoje = new Date();
  const ini = new Date(hoje);
  if (p === "7d") ini.setDate(hoje.getDate() - 6);
  if (p === "30d") ini.setDate(hoje.getDate() - 29);
  if (p === "mes") ini.setDate(1);
  return [iso(ini), iso(hoje)];
}
function dataCurta(s: string) { const [, m, d] = s.split("-"); return `${d}/${m}`; }
function horaDe(s: string | null | undefined) {
  if (!s) return "";
  const d = new Date(s);
  const hoje = iso(new Date()) === iso(d);
  return (hoje ? "hoje às " : `${d.toLocaleDateString("pt-BR")} às `) + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function lerCache(): Record<string, Resumo> {
  try { return JSON.parse(localStorage.getItem(CHAVE_CACHE) || "{}"); } catch { return {}; }
}
function gravarCache(p: Periodo, r: Resumo) {
  try { const c = lerCache(); c[p] = r; localStorage.setItem(CHAVE_CACHE, JSON.stringify(c)); } catch { /* sem espaço */ }
}
export function limparCachePainel() { try { localStorage.removeItem(CHAVE_CACHE); } catch { /* ignora */ } }

/* ------------------------------------------------------------------ */
/* Peças                                                               */
/* ------------------------------------------------------------------ */
// Só "com problema" ganha cor (subir = vermelho, cair = verde); os outros números mostram a variação em cinza.
function variacao(atual: number, antes: number | undefined, menorEhMelhor = false) {
  if (antes === undefined) return "";
  if (!antes && !atual) return `<span class="var neutra">sem movimento</span>`;
  if (!antes) return `<span class="var neutra">novo no período</span>`;
  const d = Math.round(((atual - antes) / antes) * 100);
  if (d === 0) return `<span class="var neutra">igual ao período anterior</span>`;
  const tom = !menorEhMelhor ? "neutra" : d < 0 ? "boa" : "ruim";
  return `<span class="var ${tom}">${d > 0 ? "▲" : "▼"} ${Math.abs(d)}% <em>vs. anterior</em></span>`;
}

function cartao(rotulo: string, valor: string, detalhe = "", destaque = false) {
  return `<div class="kpi${destaque ? " kpi-destaque" : ""}"><span class="kpi-rotulo">${esc(rotulo)}</span>
    <span class="kpi-valor">${valor}</span>${detalhe ? `<span class="kpi-det">${detalhe}</span>` : ""}</div>`;
}

function barras(itens: Item[] | undefined, cor: (i: Item) => string, vazio: string) {
  if (!itens || !itens.length) return `<p class="pn-vazio">${esc(vazio)}</p>`;
  const max = Math.max(...itens.map((i) => i.n));
  return `<ul class="barras">${itens.map((i) => `
    <li title="${esc(i.nome)}: ${fmt(i.n)}">
      <span class="b-nome">${esc(i.nome)}${i.grupo ? ` <em>${esc(i.grupo)}</em>` : ""}</span>
      <span class="b-trilho"><span class="b-barra" style="width:${Math.max(4, (i.n / max) * 100)}%;background:${cor(i)}"></span></span>
      <span class="b-n">${fmt(i.n)}</span>
    </li>`).join("")}</ul>`;
}

// Uma barra única dividida em Hardware / Software / Outros, com legenda e números visíveis
function divisao(g: Contagem | undefined, titulo: string) {
  const total = GRUPOS.reduce((s, k) => s + (g?.[k] || 0), 0);
  if (!total) return `<p class="pn-vazio">Nenhum registro de ${esc(titulo)} no período.</p>`;
  const partes = GRUPOS.filter((k) => g?.[k]);
  return `
    <div class="divisao" role="img" aria-label="${esc(partes.map((k) => `${k} ${g![k]}`).join(", "))}">
      ${partes.map((k) => `<span style="flex:${g![k]};background:${COR[k]}" title="${k}: ${fmt(g![k])} (${pct(g![k], total)}%)"></span>`).join("")}
    </div>
    <ul class="legenda">
      ${GRUPOS.map((k) => `<li><i style="background:${COR[k]}"></i>${k}<strong>${fmt(g?.[k] || 0)}</strong><small>${pct(g?.[k] || 0, total)}%</small></li>`).join("")}
    </ul>`;
}

// Linha fina dos últimos 30 dias (STD x Streamax), com toque para ver o dia
function tendencia(serie: Resumo["serie"]) {
  if (!serie || !serie.length) return "";
  const L = 320, A = 120, mE = 4, mD = 4, mT = 10, mB = 18;
  const max = Math.max(4, ...serie.map((s) => Math.max(s.std, s.stx)));
  const x = (i: number) => mE + (i * (L - mE - mD)) / Math.max(1, serie.length - 1);
  const y = (v: number) => mT + (A - mT - mB) * (1 - v / max);
  const caminho = (k: "std" | "stx") => serie.map((s, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(s[k]).toFixed(1)}`).join("");
  const grade = [0, 0.5, 1].map((f) => `<line x1="${mE}" x2="${L - mD}" y1="${y(max * f)}" y2="${y(max * f)}" class="t-grade"/>`).join("");
  const ultimo = serie[serie.length - 1];
  const soma = (k: "std" | "stx") => serie.reduce((t, s) => t + s[k], 0);
  return `
    <div class="tend" data-serie='${esc(JSON.stringify(serie))}'>
      <ul class="legenda legenda-linha">
        <li><i style="background:${COR.std}"></i>STD (triagens)<strong>${fmt(soma("std"))}</strong><small>em 30 dias</small></li>
        <li><i style="background:${COR.stx}"></i>Streamax (entradas)<strong>${fmt(soma("stx"))}</strong><small>em 30 dias</small></li>
      </ul>
      <svg viewBox="0 0 ${L} ${A}" class="t-svg" preserveAspectRatio="none" aria-label="Movimento por dia nos últimos 30 dias">
        ${grade}
        <path d="${caminho("std")}" stroke="${COR.std}" class="t-linha"/>
        <path d="${caminho("stx")}" stroke="${COR.stx}" class="t-linha"/>
        <line class="t-cursor" x1="0" x2="0" y1="${mT}" y2="${A - mB}" style="display:none"/>
        <text x="${mE}" y="${A - 4}" class="t-eixo">${dataCurta(serie[0].dia)}</text>
        <text x="${L - mD}" y="${A - 4}" class="t-eixo" text-anchor="end">${dataCurta(ultimo.dia)}</text>
        <text x="${L - mD}" y="${y(max) - 2}" class="t-eixo" text-anchor="end">${fmt(max)}</text>
        <rect x="0" y="0" width="${L}" height="${A}" fill="transparent" class="t-alvo"/>
      </svg>
      <div class="t-dica" hidden></div>
    </div>`;
}

function ligarTendencia(raiz: HTMLElement) {
  const box = raiz.querySelector<HTMLElement>(".tend");
  if (!box) return;
  const serie = JSON.parse(box.dataset.serie || "[]") as NonNullable<Resumo["serie"]>;
  const svg = box.querySelector("svg")!;
  const cursor = box.querySelector<SVGLineElement>(".t-cursor")!;
  const dica = box.querySelector<HTMLElement>(".t-dica")!;
  const mover = (ev: PointerEvent) => {
    const r = svg.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
    const i = Math.round(f * (serie.length - 1));
    const s = serie[i];
    const xv = 4 + (i * (320 - 8)) / Math.max(1, serie.length - 1);
    cursor.setAttribute("x1", String(xv)); cursor.setAttribute("x2", String(xv)); cursor.style.display = "";
    dica.hidden = false;
    dica.innerHTML = `<strong>${dataCurta(s.dia)}</strong>
      <span><i style="background:${COR.std}"></i>STD ${fmt(s.std)}</span>
      <span><i style="background:${COR.stx}"></i>Streamax ${fmt(s.stx)}</span>
      <span class="t-prob">Com problema ${fmt(s.prob)}</span>`;
    const px = (xv / 320) * r.width;
    dica.style.left = `${Math.min(Math.max(px, 70), r.width - 70)}px`;
  };
  const sair = () => { cursor.style.display = "none"; dica.hidden = true; };
  svg.addEventListener("pointerdown", mover);
  svg.addEventListener("pointermove", mover);
  svg.addEventListener("pointerleave", sair);
  svg.addEventListener("pointerup", (ev) => { if (ev.pointerType !== "mouse") setTimeout(sair, 2200); });
}

/* ------------------------------------------------------------------ */
/* Tela                                                                */
/* ------------------------------------------------------------------ */
function htmlResumo(r: Resumo) {
  const a = r.anterior;
  const s = r.std, x = r.streamax;
  const cam = r.cameras, forn = r.fornecedor;
  const det = (txt: string) => `<span class="var neutra">${txt}</span>`;

  let html = `
    <section class="pn-bloco">
      <h2><i style="background:${COR.std}"></i>STD</h2>
      <div class="kpis kpis-3">
        ${cartao("Triagens", fmt(s.triagens), variacao(s.triagens, a?.std.triagens))}
        ${cartao("Com problema", `${fmt(s.com_problema)}<small>${pct(s.com_problema, s.triagens)}%</small>`, variacao(s.com_problema, a?.std.com_problema, true), true)}
        ${cartao("Manutenções", fmt(s.manutencoes), variacao(s.manutencoes, a?.std.manutencoes))}
      </div>
    </section>
    <section class="pn-bloco">
      <h2><i style="background:${COR.stx}"></i>Streamax</h2>
      <div class="kpis kpis-4">
        ${cartao("Entradas", fmt(x.entradas), variacao(x.entradas, a?.streamax.entradas))}
        ${cartao("Triagens", fmt(x.triagens), variacao(x.triagens, a?.streamax.triagens))}
        ${cartao("Com problema", `${fmt(x.com_problema)}<small>${pct(x.com_problema, x.triagens)}%</small>`, variacao(x.com_problema, a?.streamax.com_problema, true), true)}
        ${cartao("Manutenções", fmt(x.manutencoes), variacao(x.manutencoes, a?.streamax.manutencoes))}
      </div>
    </section>
    <section class="pn-bloco">
      <h2>Fora da bancada</h2>
      <div class="kpis kpis-2">
        ${cartao("Câmeras solucionadas", cam ? fmt(cam.solucionadas) : "–",
          cam ? det(`${fmt(cam.reparos_periodo)} reparo(s) no período`) : det("aguardando a primeira leitura"))}
        ${cartao("No fornecedor", forn ? fmt(forn.no_fornecedor) : "–",
          forn ? (forn.atrasados ? `<span class="var ruim">${fmt(forn.atrasados)} há mais de ${forn.prazo_dias} dias</span>` : det("nenhum em atraso"))
            : det("aguardando a primeira leitura"))}
      </div>
    </section>`;

  if (r.admin) {
    html += `
    <section class="pn-bloco pn-cartao">
      <h3>Movimento por dia <small>últimos 30 dias</small></h3>
      ${tendencia(r.serie)}
    </section>
    <section class="pn-bloco pn-cartao">
      <h3>Falhas STD por tipo <small>${ROTULO_PERIODO[periodo].toLowerCase()}</small></h3>
      ${divisao(r.std_grupos, "falha")}
      <h4>Mais comuns</h4>
      ${barras(r.std_top, () => COR.std, "Nenhuma falha registrada no período.")}
    </section>
    <section class="pn-bloco pn-cartao">
      <h3>Falhas Streamax <small>${ROTULO_PERIODO[periodo].toLowerCase()}</small></h3>
      ${barras(r.stx_top, () => COR.stx, "Nenhuma falha registrada no período.")}
    </section>
    <section class="pn-bloco pn-cartao">
      <h3>Componentes trocados (STD) <small>${ROTULO_PERIODO[periodo].toLowerCase()}</small></h3>
      ${divisao(r.comp_grupos, "manutenção")}
      <h4>Mais trocados</h4>
      ${barras(r.comp_top, () => COR.std, "Nenhuma manutenção registrada no período.")}
    </section>`;
    if (cam || forn) {
      html += `
    <section class="pn-bloco pn-cartao">
      <h3>Câmeras e fornecedores</h3>
      ${cam ? `<p class="pn-linha"><span>Câmeras a reparar</span><strong>${fmt(cam.a_reparar)}</strong></p>
               <p class="pn-linha"><span>Aguardando peças</span><strong>${fmt(cam.aguardando_pecas)}</strong></p>` : ""}
      ${forn && forn.por_fornecedor?.length ? `<h4>No fornecedor, por empresa</h4>${barras(forn.por_fornecedor, () => "#8a8a86", "")}` : ""}
      <p class="pn-nota">${cam ? `Câmeras lidas ${horaDe(cam.atualizado_em)}. ` : ""}${forn ? `Fornecedores lidos ${horaDe(forn.atualizado_em)}.` : ""}</p>
    </section>`;
    }
  }
  return html;
}

export function telaPainel(raiz: HTMLElement, sb: SupabaseClient) {
  raiz.innerHTML = `
    <div class="pn-periodos" role="tablist">
      ${(Object.keys(ROTULO_PERIODO) as Periodo[]).map((p) =>
        `<button role="tab" data-p="${p}" class="${p === periodo ? "ativo" : ""}">${ROTULO_PERIODO[p]}</button>`).join("")}
    </div>
    <p class="pn-atualizado" id="pn-atualizado"></p>
    <div id="pn-corpo" class="pn-corpo"></div>`;
  raiz.querySelectorAll<HTMLButtonElement>(".pn-periodos button").forEach((b) => {
    b.onclick = () => {
      periodo = b.dataset.p as Periodo;
      raiz.querySelectorAll(".pn-periodos button").forEach((x) => x.classList.toggle("ativo", x === b));
      carregar(raiz, sb);
    };
  });
  carregar(raiz, sb);
}

async function carregar(raiz: HTMLElement, sb: SupabaseClient) {
  const corpo = raiz.querySelector<HTMLElement>("#pn-corpo")!;
  const nota = raiz.querySelector<HTMLElement>("#pn-atualizado")!;
  const pedido = periodo;
  const guardado = lerCache()[pedido];
  const mostrar = (r: Resumo, offline = false) => {
    if (pedido !== periodo) return;
    corpo.innerHTML = htmlResumo(r);
    ligarTendencia(corpo);
    nota.textContent = (offline ? "Sem internet: mostrando a última leitura. " : "") +
      (r.dados_ate ? `Dados da planilha até ${horaDe(r.dados_ate)}.` : "");
  };
  if (guardado) mostrar(guardado, !navigator.onLine);
  else corpo.innerHTML = `<div class="pn-carregando"><span></span><span></span><span></span></div>`;
  if (!navigator.onLine) {
    if (!guardado) corpo.innerHTML = `<p class="pn-vazio">Sem internet. Conecte-se para ver o painel.</p>`;
    return;
  }
  const [ini, fim] = intervalo(pedido);
  const { data, error } = await sb.rpc("painel_resumo", { p_inicio: ini, p_fim: fim });
  if (error || !data) {
    if (!guardado && pedido === periodo) corpo.innerHTML = `<p class="pn-vazio">Não foi possível carregar o painel agora. Tente de novo em instantes.</p>`;
    return;
  }
  gravarCache(pedido, data as Resumo);
  mostrar(data as Resumo);
}
