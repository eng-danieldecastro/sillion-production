// Resumo das câmeras enviadas à Streamax (planilha RMA, arquivo .xlsx no Drive).
// Mesmas regras do dashboard "Dashboard by Database" (obterCameras): abas "A reparar", "Reparados"
// e "Aguardando peças"; cada câmera conta uma vez, na situação mais avançada; cada linha de
// "Reparados" é um reparo, contado no dia do reparo.
// deno-lint-ignore-file no-explicit-any
import * as XLSX from "npm:xlsx@0.18.5";

const norm = (s: unknown) => String(s ?? "").replace(/\u00a0/g, " ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();
const texto = (s: unknown) => String(s ?? "").replace(/\u00a0/g, " ").trim();
const chaveEquip = (s: unknown) => String(s ?? "").normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");

function acharCol(headers: string[], termos: string[]) {
  for (const t of termos) {
    const re = new RegExp("(^|[^A-Z0-9])" + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([^A-Z0-9]|$)");
    const i = headers.findIndex((h) => re.test(h));
    if (i >= 0) return i;
  }
  return -1;
}
function acharAba(wb: XLSX.WorkBook, nomes: string[], fragmentos: string[]) {
  const limpa = (s: string) => norm(s).replace(/[_\s]/g, "");
  for (const n of nomes) { const a = wb.SheetNames.find((s) => limpa(s) === limpa(n)); if (a) return a; }
  return wb.SheetNames.find((s) => { const n = norm(s); return !n.includes("DASH") && fragmentos.some((f) => n.includes(f)); }) || null;
}
function familia(modelo: string) {
  const n = norm(modelo);
  if (!n) return "(sem modelo)";
  if (n.includes("KIT")) return "ADKit";
  if (n.includes("AD+") || /AD\s*PLUS/.test(n) || /^AD\b/.test(n)) return "AD+";
  return texto(modelo);
}
function prioridadeColData(h: string) {
  if (!/(^|[^A-Z0-9])(DATE|DATA)([^A-Z0-9]|$)/.test(h)) return -1;
  if (/REPAIR|REPAR/.test(h)) return 0;
  if (/RETURN|RETORN|DELIVER|ENTREGA/.test(h)) return 1;
  if (/RECEIVED|RECEB|RECEIPT|ARRIV/.test(h)) return 2;
  if (/SENT|SEND|ENVI|SHIP/.test(h)) return 4;
  return 3;
}
function acharColDataReparo(cab: string[], linhas: any[][], hIdx: number) {
  let melhor = -1, melhorPrio = 99, semDados = -1, semDadosPrio = 99;
  cab.forEach((h, i) => {
    const pr = prioridadeColData(h);
    if (pr < 0) return;
    const temDado = linhas.slice(hIdx + 1).some((r) => r[i] instanceof Date || texto(r[i]) !== "");
    if (temDado) { if (pr < melhorPrio) { melhor = i; melhorPrio = pr; } }
    else if (pr < semDadosPrio) { semDados = i; semDadosPrio = pr; }
  });
  return melhor >= 0 ? melhor : semDados;
}
const p2 = (n: number) => String(n).padStart(2, "0");
function dataEstrita(v: unknown): string {
  if (v instanceof Date) return isNaN(v.getTime()) ? "" : `${v.getFullYear()}-${p2(v.getMonth() + 1)}-${p2(v.getDate())}`;
  const t = texto(v);
  if (!t) return "";
  let d: number, m: number, a: number;
  let x = t.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4}|\d{2})(?:[ T,]+\d{1,2}:\d{2}(?::\d{2})?)?$/);
  if (x) { d = +x[1]; m = +x[2]; a = +x[3]; if (x[3].length === 2) a += 2000; }
  else {
    x = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]+\d{1,2}:\d{2}(?::\d{2})?)?$/);
    if (!x) return "";
    a = +x[1]; m = +x[2]; d = +x[3];
  }
  if (m < 1 || m > 12 || d < 1 || d > new Date(a, m, 0).getDate()) return "";
  return `${a}-${p2(m)}-${p2(d)}`;
}

interface Linha { situacao: string; modelo: string; familia: string; sn: string; mac: string; macValido: boolean; dia: string }

function lerAba(wb: XLSX.WorkBook, nome: string | null, situacao: string, minIso: string, maxIso: string): Linha[] {
  if (!nome) return [];
  const linhas = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[nome], { header: 1, raw: true, defval: "" });
  let hIdx = -1;
  for (let r = 0; r < Math.min(8, linhas.length); r++) {
    const hs = (linhas[r] || []).map(norm);
    if (acharCol(hs, ["MODEL", "MODELO"]) >= 0 && acharCol(hs, ["MAC", "MAC ADDRESS"]) >= 0) { hIdx = r; break; }
  }
  if (hIdx < 0) return [];
  const cab = linhas[hIdx].map(norm);
  const col = {
    modelo: acharCol(cab, ["MODEL", "MODELO"]),
    sn: acharCol(cab, ["SN", "S N", "SERIAL", "SERIAL NUMBER"]),
    mac: acharCol(cab, ["MAC ADDRESS", "MAC"]),
    data: acharColDataReparo(cab, linhas, hIdx),
  };
  const cel = (r: any[], i: number) => (i < 0 ? "" : r[i] instanceof Date ? dataEstrita(r[i]) : texto(r[i]));
  const out: Linha[] = [];
  for (const r of linhas.slice(hIdx + 1)) {
    const modelo = cel(r, col.modelo), sn = cel(r, col.sn), mac = cel(r, col.mac);
    if (!modelo && !sn && !mac) continue;
    const macLimpo = mac.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
    const macValido = /^[0-9A-F]{12}$/.test(macLimpo);
    const iso = col.data >= 0 ? dataEstrita(r[col.data]) : "";
    out.push({ situacao, modelo, familia: familia(modelo), sn, mac: macValido ? macLimpo : "", macValido,
      dia: iso && iso >= minIso && iso <= maxIso ? iso : "" });
  }
  return out;
}

function chaveCamera(l: Linha) {
  const snk = chaveEquip(l.sn);
  const snOk = snk && snk !== chaveEquip(l.modelo) && snk !== chaveEquip(l.familia);
  return (snOk ? snk : "") || (l.macValido ? chaveEquip(l.mac) : "");
}

export function resumoCameras(bytes: Uint8Array) {
  const wb = XLSX.read(bytes, { type: "array", cellDates: true });
  const agora = Date.now();
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  const minIso = iso(agora - 400 * 864e5), maxIso = iso(agora + 2 * 864e5);
  const la = lerAba(wb, acharAba(wb, ["A reparar"], ["REPARAR"]), "A REPARAR", minIso, maxIso);
  const lg = lerAba(wb, acharAba(wb, ["Aguardando peças", "Aguardando pecas"], ["AGUARD"]), "AGUARDANDO PEÇAS", minIso, maxIso);
  const lr = lerAba(wb, acharAba(wb, ["Reparados", "Reparadas"], ["REPARAD"]), "REPARADA", minIso, maxIso);
  const peso: Record<string, number> = { "A REPARAR": 1, "AGUARDANDO PEÇAS": 2, "REPARADA": 3 };
  const porChave = new Map<string, Linha>(), semChave: Linha[] = [];
  for (const l of [...la, ...lg, ...lr]) {
    const k = chaveCamera(l);
    if (!k) { semChave.push(l); continue; }
    const atual = porChave.get(k);
    if (!atual || peso[l.situacao] >= peso[atual.situacao]) porChave.set(k, l);
  }
  // Regra de Dan (2026-11-27): toda câmera AD+ (ADPLUS) que ainda não foi reparada está
  // aguardando peça, mesmo que esteja na aba "A reparar".
  const itens = [...porChave.values(), ...semChave].map((l) =>
    l.situacao === "A REPARAR" && l.familia === "AD+" ? { ...l, situacao: "AGUARDANDO PEÇAS" } : l);
  const conta = (s: string) => itens.filter((i) => i.situacao === s).length;
  const porDia: Record<string, number> = {};
  for (const l of lr) if (l.dia) porDia[l.dia] = (porDia[l.dia] || 0) + 1;
  return {
    solucionadas: conta("REPARADA"),
    a_reparar: conta("A REPARAR"),
    aguardando_pecas: conta("AGUARDANDO PEÇAS"),
    total: itens.length,
    reparos_total: lr.length,
    reparos_por_dia: porDia,
    abas: wb.SheetNames,
  };
}
