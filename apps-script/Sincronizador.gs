/**
 * Central de Produção - Sillion · Sincronizador da planilha "Central Geral (APP)"
 *
 * Cole este arquivo num projeto Apps Script ligado à planilha Central Geral (APP)
 * (Extensões > Apps Script). Depois rode UMA vez a função `instalar`.
 *
 * O que ele faz:
 *  1. A cada 5 minutos busca no Supabase as respostas enviadas pelo aplicativo e grava
 *     cada uma na aba do formulário, no mesmo formato do Google Forms.
 *  2. Copia para esta planilha, na hora, cada resposta enviada pelos Google Forms atuais
 *     (os formulários continuam ativos em paralelo, gravando também nas planilhas antigas).
 *  3. A cada 30 minutos envia ao Supabase um backup das abas (só o que é novo ou mudou).
 *     É dele que sai o dashboard do aplicativo.
 *  4. A cada hora lê a planilha de fornecedores e a planilha de câmeras (RMA Streamax) e
 *     envia ao Supabase só o resumo usado no dashboard (nada é gravado nelas).
 *  5. Troca nomes antigos de opções (ex.: "Transitor" -> "Transistor") nas respostas que
 *     chegam dos Google Forms, para ficarem iguais às do aplicativo.
 *
 * As planilhas antigas e os formulários NÃO são alterados.
 */

const CFG = {
  URL_FUNCAO: "https://fnkoudqdkgwzaspfkeak.supabase.co/functions/v1/planilha",
  TOKEN: "COLE_AQUI_O_TOKEN",          // token entregue junto com o passo a passo
  FUSO: "America/Sao_Paulo",

  // Origem dos Google Forms atuais -> aba desta planilha
  ORIGENS_FORMS: [
    { id: "1zqpc_Q2D1EybHLWzJvL83M_hJU9WmqZgkR_93v3gZN8",                   // Central Produção
      abas: { "Registro_Placas_Danificadas": "Registro_Placas_Danificadas",
              "Registro_Placas_Manutencao":  "Registro_Placas_Manutencao",
              "Registro_Geral_Streamax":     "Registro_Geral_Streamax",
              "Menutencoes_Streamax":        "Menutencoes_Streamax" } },
    { id: "12mansudeO4kq-5Ua9h89U3yg47jelhWugMLFjvjaOG8",                   // Manutenção RST_Mini
      abas: { "Respostas ao formulário 1": "RST_Mini" } },
    { id: "1oBx7p9IitwkEHD6JFpnpsdDwgm2l4sNfqGY73XvMSWs",                   // Controle Streamax (Insumos)
      abas: { "Insumos": "Insumos" } },
  ],

  // Opções renomeadas (pedido de Dan, 27/11/2026). Coluna = número da coluna na aba (A = 1).
  RENOMEAR: {
    "Registro_Placas_Danificadas": { colunas: [6, 7], trocas: { "RASTREADOR COM DEFEITO": "RST-Mini Com Defeito" } },
    "Registro_Placas_Manutencao":  { colunas: [4],    trocas: { "Transitor": "Transistor", "Max": "MAX" } },
  },

  // Fontes do resumo de câmeras e fornecedores (as mesmas do dashboard; só leitura)
  ID_PLANILHA_FORNECEDORES: "1ceuWFM7SjsdrRvhaJB_prk5rsMFMoj89FcFfB7OGvgs",
  ABAS_ENVIADOS_FORNECEDOR: ["Base_Envios", "Enviados", "Enviado", "Enviados_Fornecedor", "Envios", "Enviados ao Fornecedor"],
  ABAS_RECEBIDOS_FORNECEDOR: ["Base_Recebimentos", "Recebidos", "Recebido", "Recebidos_Fornecedor", "Retornos", "Retornados"],
  PRAZO_DIAS_FORNECEDOR: 15,
  ID_ARQUIVO_CAMERAS: "1IJVUvqjeE1DeMXJ75ud7b_l8BBMgTn0Q",   // .xlsx no Drive: só leitura
  ABAS_CAMERAS_A_REPARAR: ["A reparar", "A Reparar"],
  ABAS_CAMERAS_REPARADAS: ["Reparados", "Reparadas", "Reparado"],
  ABAS_CAMERAS_AGUARDANDO: ["Aguardando peças", "Aguardando pecas", "Aguardando peça"],

  // Abas enviadas no backup
  ABAS_BACKUP: ["Registro_Placas_Danificadas", "Registro_Placas_Manutencao", "Registro_Geral_Streamax",
                "Menutencoes_Streamax", "RST_Mini", "Insumos"],
};

/* ------------------------------------------------------------------ */
/* Instalação                                                          */
/* ------------------------------------------------------------------ */
function instalar() {
  if (!CFG.TOKEN || CFG.TOKEN.indexOf("COLE_AQUI") === 0) throw new Error("Preencha CFG.TOKEN antes de instalar.");
  // remove gatilhos antigos deste projeto
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });

  ScriptApp.newTrigger("sincronizarApp").timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger("backupDiario").timeBased().everyMinutes(30).create();
  ScriptApp.newTrigger("resumoExterno").timeBased().everyHours(1).create();
  CFG.ORIGENS_FORMS.forEach(function (o) {
    ScriptApp.newTrigger("copiarRespostaForms").forSpreadsheet(o.id).onFormSubmit().create();
  });

  corrigirNomesHistorico();
  sincronizarApp();
  backupDiario();
  resumoExterno(true);
  Logger.log("Instalado: sincronização a cada 5 min, cópia dos Google Forms, backup a cada 30 min e resumo de câmeras/fornecedores a cada hora.");
}

/* ------------------------------------------------------------------ */
/* 1. Respostas do aplicativo -> planilha                              */
/* ------------------------------------------------------------------ */
function sincronizarApp() {
  const trava = LockService.getScriptLock();
  if (!trava.tryLock(20000)) return;
  try {
    const r = chamar_({ acao: "pendentes", limite: 300 });
    const respostas = r.respostas || [];
    if (!respostas.length) { chamar_({ acao: "pulso", origem: "apps_script" }); return; }

    const forms = {};
    (r.formularios || []).forEach(function (f) { forms[f.slug] = f; });
    const ss = SpreadsheetApp.getActive();
    const ok = [], falhas = [];

    // agrupa por aba para gravar em bloco
    const porAba = {};
    respostas.forEach(function (resp) {
      const f = forms[resp.formulario];
      if (!f) { falhas.push({ id: resp.id, erro: "Formulário desconhecido" }); return; }
      (porAba[f.aba_planilha] = porAba[f.aba_planilha] || { f: f, itens: [] }).itens.push(resp);
    });

    Object.keys(porAba).forEach(function (nomeAba) {
      const grupo = porAba[nomeAba];
      const aba = ss.getSheetByName(nomeAba);
      if (!aba) { grupo.itens.forEach(function (x) { falhas.push({ id: x.id, erro: "Aba não encontrada: " + nomeAba }); }); return; }
      const largura = Math.max(aba.getLastColumn(), grupo.f.colunas_planilha.length);
      const linhas = grupo.itens.map(function (resp) {
        const linha = grupo.f.colunas_planilha.map(function (col) { return valorColuna_(col.origem, resp); });
        while (linha.length < largura) linha.push("");
        return linha;
      });
      try {
        const inicio = aba.getLastRow() + 1;
        aba.getRange(inicio, 1, linhas.length, largura).setValues(linhas);
        grupo.itens.forEach(function (x) { ok.push(x.id); });
      } catch (e) {
        grupo.itens.forEach(function (x) { falhas.push({ id: x.id, erro: String(e) }); });
      }
    });
    SpreadsheetApp.flush();
    chamar_({ acao: "confirmar", ok: ok, falhas: falhas });
  } finally {
    trava.releaseLock();
  }
}

function valorColuna_(origem, resp) {
  if (origem === "@carimbo") return new Date(resp.preenchido_em);   // data real: o Sheets formata como o Forms
  if (origem === "@email") return resp.email_registrado || "";
  const v = resp.dados ? resp.dados[origem] : "";
  if (Array.isArray(v)) return v.join(", ");                         // caixas de seleção: igual ao Google Forms
  return v === null || v === undefined ? "" : String(v);
}

/* ------------------------------------------------------------------ */
/* 2. Google Forms atuais -> planilha (em paralelo)                    */
/* ------------------------------------------------------------------ */
function copiarRespostaForms(e) {
  try {
    const origemId = e.source.getId();
    const nomeOrigem = e.range.getSheet().getName();
    const origem = CFG.ORIGENS_FORMS.filter(function (o) { return o.id === origemId; })[0];
    if (!origem || !origem.abas[nomeOrigem]) return;              // aba que não é de formulário
    const destino = SpreadsheetApp.getActive().getSheetByName(origem.abas[nomeOrigem]);
    if (!destino) throw new Error("Aba de destino não encontrada: " + origem.abas[nomeOrigem]);

    const valores = e.range.getValues()[0];
    const largura = Math.max(destino.getLastColumn(), 1);
    const linha = valores.slice(0, largura);
    const ren = CFG.RENOMEAR[destino.getName()];
    if (ren) ren.colunas.forEach(function (c) { if (typeof linha[c - 1] === "string") linha[c - 1] = renomear_(linha[c - 1], ren.trocas); });
    while (linha.length < largura) linha.push("");
    destino.getRange(destino.getLastRow() + 1, 1, 1, largura).setValues([linha]);
  } catch (err) {
    console.error("copiarRespostaForms: " + err);
  }
}

/* Troca uma opção pelo nome novo só quando ela aparece inteira na lista ("A, B, C").
 * Texto livre que apenas contém a palavra não é alterado. */
function renomear_(valor, trocas) {
  let t = String(valor);
  Object.keys(trocas).forEach(function (antigo) {
    const esc = antigo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    t = t.replace(new RegExp("(^|,\\s*)" + esc + "(?=\\s*,|\\s*$)", "g"), "$1" + trocas[antigo]);
  });
  return t;
}

/* Corrige os nomes antigos nas respostas que já estão na planilha. Pode rodar mais de uma vez. */
function corrigirNomesHistorico() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(CFG.RENOMEAR).forEach(function (nomeAba) {
    const aba = ss.getSheetByName(nomeAba);
    if (!aba || aba.getLastRow() < 2) return;
    const ren = CFG.RENOMEAR[nomeAba];
    ren.colunas.forEach(function (c) {
      const rng = aba.getRange(2, c, aba.getLastRow() - 1, 1);
      const vals = rng.getValues();
      let n = 0;
      const novos = vals.map(function (l) {
        if (typeof l[0] !== "string" || !l[0]) return l;
        const v = renomear_(l[0], ren.trocas);
        if (v !== l[0]) n++;
        return [v];
      });
      if (n) rng.setValues(novos);
      Logger.log(nomeAba + " coluna " + c + ": " + n + " célula(s) corrigida(s)");
    });
  });
}

/* ------------------------------------------------------------------ */
/* 3. Backup no Supabase a cada 30 min (sem duplicar)                   */
/* ------------------------------------------------------------------ */
function backupDiario() {
  const ss = SpreadsheetApp.getActive();
  CFG.ABAS_BACKUP.forEach(function (nome) {
    const aba = ss.getSheetByName(nome);
    if (!aba || aba.getLastRow() < 1) return;
    const dados = aba.getRange(1, 1, aba.getLastRow(), aba.getLastColumn()).getDisplayValues();
    const colunas = dados.shift();
    const linhas = dados
      .filter(function (l) { return l.some(function (c) { return String(c).trim() !== ""; }); })
      .map(function (l) { // corta colunas vazias do fim
        let n = l.length; while (n > 0 && String(l[n - 1]).trim() === "") n--; return l.slice(0, n);
      });
    const r = chamar_({ acao: "backup", aba: nome, colunas: colunas, linhas: linhas, completo: true });
    Logger.log(nome + ": " + r.linhas + " linhas, " + r.novas + " novas, " + r.removidas + " removidas/alteradas");
  });
}

/* ------------------------------------------------------------------ */
function chamar_(corpo) {
  const resp = UrlFetchApp.fetch(CFG.URL_FUNCAO, {
    method: "post",
    contentType: "application/json",
    headers: { "x-token-integracao": CFG.TOKEN },
    payload: JSON.stringify(corpo),
    muteHttpExceptions: true,
  });
  const codigo = resp.getResponseCode();
  const texto = resp.getContentText();
  if (codigo >= 300) throw new Error("Supabase respondeu " + codigo + ": " + texto);
  return JSON.parse(texto);
}

/* ------------------------------------------------------------------ */
/* 4. Resumo de fornecedores e câmeras para o dashboard do aplicativo  */
/* ------------------------------------------------------------------ */
// Mesmas regras do dashboard "Dashboard by Database" (funções copiadas de lá, só leitura).
function resumoExterno(forcarCameras) {
  try {
    chamar_({ acao: "externo", chave: "fornecedores", dados: resumoFornecedores_() });
  } catch (e) { console.error("resumo fornecedores: " + e); }
  try { resumoCameras_(forcarCameras === true); } catch (e) { console.error("resumo câmeras: " + e); }
}

function resumoFornecedores_() {
  const r = itensFornecedores_();
  const agora = Date.now(), prazo = CFG.PRAZO_DIAS_FORNECEDOR * 86400000;
  const pendentes = r.itens.filter(function (i) { return !i.retornou; });
  const porForn = {};
  pendentes.forEach(function (i) { porForn[i.fornecedor] = (porForn[i.fornecedor] || 0) + 1; });
  const lista = Object.keys(porForn).map(function (k) { return { nome: k, n: porForn[k] }; })
    .sort(function (a, b) { return b.n - a.n; }).slice(0, 8);
  return {
    no_fornecedor: pendentes.length,
    atrasados: pendentes.filter(function (i) { return i.time && agora - i.time > prazo; }).length,
    prazo_dias: CFG.PRAZO_DIAS_FORNECEDOR,
    enviados_total: r.itens.length,
    por_fornecedor: lista
  };
}

// O arquivo de câmeras é um .xlsx: o script só LÊ o arquivo (permissão de leitura do Drive)
// e envia o conteúdo ao Supabase, que calcula o resumo com as mesmas regras do dashboard.
function resumoCameras_(forcar) {
  const props = PropertiesService.getScriptProperties();
  const arq = DriveApp.getFileById(CFG.ID_ARQUIVO_CAMERAS);
  const marca = String(arq.getLastUpdated().getTime());
  if (!forcar && props.getProperty("CAMERAS_VERSAO") === marca) return;   // arquivo não mudou desde a última leitura
  const r = chamar_({ acao: "cameras_xlsx", arquivo_b64: Utilities.base64Encode(arq.getBlob().getBytes()) });
  props.setProperty("CAMERAS_VERSAO", marca);
  Logger.log("Câmeras: " + r.solucionadas + " solucionadas, " + r.a_reparar + " a reparar, " + r.reparos_total + " reparos");
}

/* ---- Funções copiadas do dashboard (mesmas regras) ---- */
function buscarAbaFlexivel_(ss, nomeProcurado) {
  if (!ss) return null;
  let aba = ss.getSheetByName(nomeProcurado);
  if (aba) return aba;

  const limpaStr = (str) => String(str || "")
    .replace(/_/g, "")
    .replace(/\s+/g, "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();

  const alvo = limpaStr(nomeProcurado);
  const abas = ss.getSheets();

  for (let i = 0; i < abas.length; i++) {
    if (limpaStr(abas[i].getName()) === alvo) return abas[i];
  }
  return null;
}

function norm_(s) {
  return String(s === null || s === undefined ? "" : s)
    .replace(/\u00A0/g, " ")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .trim().toUpperCase();
}

function chave_(s) {
  return String(s === null || s === undefined ? "" : s).replace(/\u00A0/g, " ").trim().toUpperCase();
}

function texto_(s) {
  return String(s === null || s === undefined ? "" : s).replace(/\u00A0/g, " ").trim();
}

function tecnicoPorEmail_(valor) {
  const s = texto_(valor);
  if (!s) return "";
  const temArroba = s.indexOf("@") >= 0;
  if (!temArroba && !/^[A-Za-z0-9]+([._-][A-Za-z0-9]+)+$/.test(s)) return s;
  const usuario = (temArroba ? s.split("@")[0] : s).split("+")[0];
  const partes = usuario.split(/[._-]+/).filter(function (p) { return p !== ""; });
  if (partes.length === 0) return temArroba ? "" : s;
  const cap = function (p) { return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase(); };
  if (partes.length === 1) return cap(partes[0]);
  return cap(partes[0]) + " " + cap(partes[partes.length - 1]);
}

function paraData_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function chaveEquip_(s) {
  let t = String(s === null || s === undefined ? "" : s);
  try { t = t.normalize("NFKC"); } catch (e) {}
  // remove caracteres invisíveis (espaço de largura zero, BOM, NBSP...) e tudo que não for letra/número
  return t.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Todas as chaves (MAC/ID) que aparecem em QUALQUER célula da linha, não só na coluna de ID.
function chavesDaLinha_(celulas) {
  const mapa = {};
  const celNorm = [];
  const reMac = /(?:[0-9A-Fa-f]{2}[:\-.\s]?){5}[0-9A-Fa-f]{2}/g;
  celulas.forEach(function (c) {
    const txt = texto_(c);
    if (!txt) return;
    const k = chaveEquip_(txt);
    if (!k) return;
    celNorm.push(k);
    if (k.length >= 3) mapa[k] = true;
    txt.split(/[,;\n\r\t|\/]+/).forEach(function (p) {
      const kp = chaveEquip_(p);
      if (kp.length >= 3) mapa[kp] = true;
    });
    const macs = txt.match(reMac);
    if (macs) macs.forEach(function (m) { const km = chaveEquip_(m); if (km.length === 12) mapa[km] = true; });
  });
  return { mapa: mapa, texto: celNorm.join("|") };
}

function acharCol_(headers, termos, evitar) {
  for (let t = 0; t < termos.length; t++) {
    const re = new RegExp("(^|[^A-Z0-9])" + termos[t] + "([^A-Z0-9]|$)");
    const idx = headers.findIndex(function (h) {
      return re.test(h) && !(evitar || []).some(function (e) { return h.indexOf(e) >= 0; });
    });
    if (idx >= 0) return idx;
  }
  return -1;
}

function acharAbaPorNomes_(ss, nomes, fragmentos) {
  fragmentos = [].concat(fragmentos);
  for (let i = 0; i < nomes.length; i++) {
    const a = buscarAbaFlexivel_(ss, nomes[i]);
    if (a) return a;
  }
  const todas = ss.getSheets();
  for (let i = 0; i < todas.length; i++) {
    const n = norm_(todas[i].getName());
    if (n.indexOf("DASH") >= 0) continue;
    if (fragmentos.some(function (f) { return n.indexOf(f) >= 0; })) return todas[i];
  }
  return null;
}

// ID do rastreador -> número de série. Os dois formatos da planilha viram a mesma chave:
//   "1/STD/360290/9616794"  ->  "360290"   |   "360290"  ->  "360290"
function chaveSerie_(s) {
  let t = String(s === null || s === undefined ? "" : s);
  try { t = t.normalize("NFKC"); } catch (e) {}
  t = t.replace(/[\s​-‍﻿]+/g, "").toUpperCase();
  if (!/[0-9A-Z]/.test(t)) return "";            // "-", "/", vazio etc.
  const p = t.split("/");
  if (p.length >= 3 && p[1] === "STD") return p[2];
  return t;
}

// Data de uma linha: se a célula é data de verdade, vale o fuso da planilha; se foi escrita como texto (dd/mm/aaaa), vale o que está escrito,
// sem depender de fuso (senão o dia poderia andar um para trás entre o fuso do script e o da planilha).
function dataDaLinha_(valor, tz) {
  const dt = paraData_(valor);
  if (!dt) return { dt: null, d: "", h: "" };
  const m = (typeof valor === "string") ? valor.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/) : null;
  if (m) {
    const p2 = function (n) { return (n < 10 ? "0" : "") + n; };
    return { dt: dt, d: m[3] + "-" + p2(+m[2]) + "-" + p2(+m[1]), h: p2(+m[1]) + "/" + p2(+m[2]) + "/" + m[3] + " " + p2(+(m[4] || 0)) + ":" + (m[5] || "00") };
  }
  return { dt: dt, d: Utilities.formatDate(dt, tz, "yyyy-MM-dd"), h: Utilities.formatDate(dt, tz, "dd/MM/yyyy HH:mm") };
}

// Números de série citados numa linha de recebimento: a coluna do ID do rastreador e qualquer célula no formato 1/STD/serie/numero
function seriesDaLinha_(celulas, colSerie) {
  const mapa = {};
  const add = function (t) { const k = chaveSerie_(t); if (k) mapa[k] = true; };
  if (colSerie >= 0 && celulas[colSerie]) String(celulas[colSerie]).split(/[,;\n\r]+/).forEach(add);
  const re = /\d+\s*\/\s*STD\s*\/\s*([0-9A-Za-z]+)\s*\/\s*\d+/gi;
  celulas.forEach(function (c) { let m; re.lastIndex = 0; while ((m = re.exec(String(c || ""))) !== null) { const k = chaveSerie_(m[1]); if (k) mapa[k] = true; } });
  return mapa;
}

function lerListaEquip_(sheet, tz, tipo) {
  const ultLinha = sheet.getLastRow(), ultCol = sheet.getLastColumn();
  const vazio = { linhas: [], colunas: {}, cabecalhos: [] };
  if (ultLinha < 2 || ultCol < 1) return vazio;

  const cabOriginal = sheet.getRange(1, 1, 1, ultCol).getDisplayValues()[0];
  const headers = cabOriginal.map(norm_);
  const rangeDados = sheet.getRange(2, 1, ultLinha - 1, ultCol);
  const dados = rangeDados.getValues();
  // Texto exatamente como aparece na célula: evita que um MAC digitado com ":" vire hora/número no getValues
  const dadosTxt = rangeDados.getDisplayValues();

  const termosData = tipo === "envio"
    ? ["DATA DE ENVIO", "DATA ENVIO", "DATA DA REMESSA", "DATA DO ENVIO", "ENVIO", "CARIMBO", "DATA"]
    : ["DATA DE RECEBIMENTO", "DATA RECEBIMENTO", "DATA DO RECEBIMENTO", "RECEBIMENTO", "DATA DE RETORNO", "RETORNO", "CARIMBO", "DATA"];

  const col = {
    data: acharCol_(headers, termosData),
    mac: acharCol_(headers, ["ID/MAC", "MAC ADDRESS", "MAC"]),
    serie: acharCol_(headers, ["ID RASTREADOR", "ID DO RASTREADOR", "RASTREADOR", "SERIAL", "SERIE", "NUMERO DE SERIE", "N/S"]),
    fornecedor: acharCol_(headers, ["FORNECEDOR", "EMPRESA", "DESTINO", "ASSISTENCIA", "PARCEIRO"]),
    operadora: acharCol_(headers, ["OPERADORA", "CLIENTE"]),
    modelo: acharCol_(headers, ["MODELO"])
  };
  if (col.serie < 0) col.serie = acharCol_(headers, ["ID"], ["REGISTRO", "MAC"]);   // "ID" sozinho, sem pegar "ID Registros"
  if (col.mac < 0) col.mac = 3;                                                     // fallback: coluna D (MAC)
  if (col.serie < 0 || col.serie === col.mac) col.serie = col.mac === 4 ? -1 : 4;   // fallback: coluna E (ID do rastreador)
  if (col.data < 0) col.data = 0;                                                   // fallback: primeira coluna
  col.id = col.mac;

  const nome = function (i) { return i >= 0 ? cabOriginal[i] : "(não encontrada)"; };
  const celulaTxt = function (rIdx, c) { return c >= 0 ? (texto_(dadosTxt[rIdx][c]) || texto_(dados[rIdx][c])) : ""; };
  const separar = function (t) { return String(t || "").split(/[,;\n\r]+/).map(function (x) { return x.trim(); }).filter(Boolean); };
  const linhas = [];
  dados.forEach(function (row, rIdx) {
    if (row.every(function (x) { return x === "" || x === null; })) return;
    const dl = dataDaLinha_(row[col.data], tz), dt = dl.dt;
    // uma célula pode trazer vários MAC/IDs separados por vírgula, ponto e vírgula ou quebra de linha
    const macs = separar(celulaTxt(rIdx, col.mac)), series = separar(celulaTxt(rIdx, col.serie));
    const n = Math.max(macs.length, series.length);
    for (let k = 0; k < n; k++) {
      // MAC e ID emparelhados pela posição; MAC único com vários IDs: o MAC vale só para o primeiro item
      const mac = macs.length === 1 ? (k === 0 ? macs[0] : "") : (macs[k] || "");
      const idr = series[k] || "";
      const macKey = chaveEquip_(mac);
      const serie = chaveSerie_(idr);
      if (!macKey && !serie) continue;
      linhas.push({
        key: macKey || serie,       // chave de busca: o MAC; sem MAC, o número de série
        macKey: macKey,
        serie: serie,
        id: mac || idr,             // o que aparece na tela: o MAC; sem MAC, o ID do rastreador
        idRastreador: idr,
        ordem: rIdx + 2,
        time: dt ? dt.getTime() : 0,
        d: dl.d,
        h: dl.h,
        fornecedor: col.fornecedor >= 0 ? (texto_(row[col.fornecedor]) || "Não informado") : "Não informado",
        operadora: col.operadora >= 0 ? (texto_(row[col.operadora]) || "Não informada") : "Não informada",
        modelo: col.modelo >= 0 ? texto_(row[col.modelo]) : ""
      });
    }
  });

  // Recebidos: guarda TODAS as linhas da aba, com todas as chaves de todas as células (varredura completa) e os números de série
  const rows = [];
  if (tipo !== "envio") {
    dados.forEach(function (row, rIdx) {
      const cel = [];
      for (let c = 0; c < ultCol; c++) {
        const t = texto_(dadosTxt[rIdx][c]);
        cel.push(t || texto_(row[c]));
      }
      if (cel.every(function (x) { return x === ""; })) return;
      let dl = dataDaLinha_(row[col.data], tz);
      if (!dl.dt) { for (let c = 0; c < row.length; c++) { if (row[c] instanceof Date && !isNaN(row[c].getTime())) { dl = dataDaLinha_(row[c], tz); break; } } }
      const dt = dl.dt;
      const ch = chavesDaLinha_(cel);
      const idTxt = texto_(dadosTxt[rIdx][col.mac]) || texto_(row[col.mac]) || cel.filter(Boolean)[0] || "";
      rows.push({
        id: idTxt,
        time: dt ? dt.getTime() : 0,
        d: dl.d,
        h: dl.h,
        mapa: ch.mapa, texto: ch.texto, series: seriesDaLinha_(cel, col.serie), usado: false, linhaPlanilha: rIdx + 2
      });
    });
  }

  return {
    linhas: linhas,
    rows: rows,
    cabecalhos: cabOriginal,
    colunas: {
      "Data": nome(col.data), "MAC": nome(col.mac), "ID do rastreador": nome(col.serie), "Fornecedor": nome(col.fornecedor),
      "Operadora": nome(col.operadora), "Modelo": nome(col.modelo)
    }
  };
}

/* REGRA DE RETORNO (a mesma do código da planilha de envios e recebimentos):
 *  - Aba de enviados = o que foi para o fornecedor. Aba de recebidos = o que está com a casa (qualquer linha, com qualquer status).
 *  - Um envio RETORNOU quando o MAC dele (sem ":" "-" "." e espaços) OU o ID do rastreador (número de série) aparece nos recebidos.
 *    Não achou nem MAC nem ID = continua NO FORNECEDOR.
 *  - Um recebimento pode dar baixa em mais de um envio (não é "gasto" por um envio só). O envio sem MAC (só ID) também é lido.
 *  - Baixa = primeiro recebimento com data igual ou posterior ao envio. Se todos os recebimentos são anteriores ao envio, só há uma exceção:
 *    se o envio é o MAIS RECENTE daquele MAC/ID e tem data, o equipamento foi reenviado depois de voltar e está NO FORNECEDOR de novo.
 *    Nos demais casos usa o recebimento mais recente. */

// Envios x recebimentos (mesma regra do dashboard). Devolve os itens enviados com retornou = true/false.
function itensFornecedores_() {
  const ss = SpreadsheetApp.openById(CFG.ID_PLANILHA_FORNECEDORES);
  const tz = ss.getSpreadsheetTimeZone();
  const nomesAbas = ss.getSheets().map(function (s) { return s.getName(); });

  const abaEnv = acharAbaPorNomes_(ss, CFG.ABAS_ENVIADOS_FORNECEDOR, ["ENVIO", "ENVIAD"]);
  const abaRec = acharAbaPorNomes_(ss, CFG.ABAS_RECEBIDOS_FORNECEDOR, ["RECEBIMENT", "RECEBID", "RETORNO"]);
  if (!abaEnv || !abaRec) {
    throw new Error("Não encontrei a aba de " + (!abaEnv ? "ENVIADOS" : "RECEBIDOS") +        ". Abas existentes: " + nomesAbas.join(", ") +        ". Ajuste CFG.ABAS_ENVIADOS_FORNECEDOR / CFG.ABAS_RECEBIDOS_FORNECEDOR.");
  }

  SpreadsheetApp.flush();
  const env = lerListaEquip_(abaEnv, tz, "envio");
  const rec = lerListaEquip_(abaRec, tz, "retorno");

  // Recebimentos: TODAS as linhas da aba, ordenadas por data; indexadas pelo MAC (qualquer célula da linha) e pelo número de série
  const recRows = rec.rows.slice().sort(function (a, b) { return a.time - b.time; });
  const recPorChave = {}, recPorSerie = {};
  recRows.forEach(function (r) {
    Object.keys(r.mapa).forEach(function (k) { (recPorChave[k] = recPorChave[k] || []).push(r); });
    Object.keys(r.series).forEach(function (k) { (recPorSerie[k] = recPorSerie[k] || []).push(r); });
  });

  // Envio mais recente de cada MAC e de cada número de série (data; empate = linha mais abaixo na planilha)
  const maisRecente = function (a, b) {
    if (!b) return true;
    const da = a.d || "", db = b.d || "";
    return da !== db ? da > db : a.ordem > b.ordem;
  };
  const ultimoPorMac = {}, ultimoPorSerie = {};
  env.linhas.forEach(function (e) {
    if (e.macKey && maisRecente(e, ultimoPorMac[e.macKey])) ultimoPorMac[e.macKey] = e;
    if (e.serie && maisRecente(e, ultimoPorSerie[e.serie])) ultimoPorSerie[e.serie] = e;
  });

  let baixaDataAnterior = 0, baixaBuscaAmpla = 0, reenviados = 0;
  env.linhas.sort(function (a, b) { return a.time - b.time || a.ordem - b.ordem; });
  const itens = env.linhas.map(function (e) {
    const cand = [], vistos = {};
    const juntar = function (r) { if (!vistos[r.linhaPlanilha]) { vistos[r.linhaPlanilha] = true; cand.push(r); } };
    // 1) pelo MAC (qualquer célula da linha de recebimento)
    if (e.macKey && e.macKey.length >= 3) (recPorChave[e.macKey] || []).forEach(juntar);
    let porMac = cand.length > 0, ampla = false;
    // não achou pela chave exata: procura o MAC dentro do texto de qualquer célula da linha
    if (!porMac && e.macKey.length >= 10) {
      recRows.filter(function (r) { return r.texto.indexOf(e.macKey) >= 0; }).forEach(juntar);
      ampla = cand.length > 0; porMac = ampla;
    }
    // 2) pelo ID do rastreador (número de série)
    const listaId = e.serie ? (recPorSerie[e.serie] || []) : [];
    const porId = listaId.length > 0;
    listaId.forEach(juntar);
    cand.forEach(function (r) { r.usado = true; });   // linha de recebimento que corresponde a algum envio (o resto vira "recebido sem envio")

    let achado = null, dataAnterior = false, reenviado = false;
    if (cand.length) {
      let recDepois = null, recMaisRecente = null, todosComData = true;
      cand.forEach(function (c) {
        if (!c.d) { todosComData = false; return; }
        if (e.d && c.d >= e.d && (!recDepois || c.d < recDepois.d)) recDepois = c;
        if (!recMaisRecente || c.d > recMaisRecente.d) recMaisRecente = c;
      });
      achado = recDepois;
      if (!achado) {
        const ehUltimo = (e.macKey && ultimoPorMac[e.macKey] === e) || (e.serie && ultimoPorSerie[e.serie] === e);
        if (ehUltimo && e.d && todosComData && recMaisRecente) { reenviado = true; }   // reenviado depois do último recebimento: está no fornecedor
        else { achado = recMaisRecente || cand[cand.length - 1]; dataAnterior = !!(e.d && achado.d && achado.d < e.d); }
      }
    }
    if (achado) { if (dataAnterior) baixaDataAnterior++; if (ampla && !porId) baixaBuscaAmpla++; }
    if (reenviado) reenviados++;
    return {
      id: e.id, key: e.key, serie: e.serie, idRastreador: e.idRastreador, semMac: !e.macKey, fornecedor: e.fornecedor, operadora: e.operadora, modelo: e.modelo,
      time: e.time, d: e.d, h: e.h,
      retornou: !!achado,
      retornoTime: achado ? achado.time : 0,
      retornoH: achado ? achado.h : "",
      retornoId: achado ? achado.id : "",
      retornoLinha: achado ? achado.linhaPlanilha : 0,
      porMac: !!achado && porMac, porId: !!achado && porId,   // como o retorno foi reconhecido (MAC, ID ou os dois)
      reenviado: reenviado,
      baixaAmpla: !!achado && ampla && !porId,
      dataRecebimentoAnterior: dataAnterior,
      // true quando o MAC foi escrito de forma diferente no envio e no recebimento (ex.: com e sem ":")
      formatoDiferente: !!achado && porMac && !!e.macKey && String(achado.id).trim().toUpperCase() !== String(e.id).trim().toUpperCase()
    };
  });

  // Recebidos que não têm envio correspondente (linhas da aba que não correspondem, por MAC nem por ID, a nenhum envio)
  const orfaos = recRows.filter(function (r) { return !r.usado && r.id; })
    .map(function (r) { return { id: r.id, h: r.h, time: r.time, linha: r.linhaPlanilha }; });

  const ret = itens.filter(function (i) { return i.retornou; });
  return {
    atualizadoEm: Utilities.formatDate(new Date(), tz, "dd/MM/yyyy HH:mm:ss"),
    agora: new Date().getTime(),
    prazoDias: CFG.PRAZO_DIAS_FORNECEDOR,
    itens: itens,
    orfaos: orfaos.sort(function (a, b) { return b.time - a.time; }),
    diagnostico: {
      abaEnviados: abaEnv.getName(), abaRecebidos: abaRec.getName(),
      colunasEnviados: env.colunas, colunasRecebidos: rec.colunas,
      totalEnviados: env.linhas.length, totalRecebidos: recRows.length,
      enviadosSemMac: itens.filter(function (i) { return i.semMac; }).length,
      retornadosPorMac: ret.filter(function (i) { return i.porMac; }).length,
      retornadosPorId: ret.filter(function (i) { return i.porId; }).length,
      retornadosSoPorId: ret.filter(function (i) { return i.porId && !i.porMac; }).length,
      reenviadosNoFornecedor: reenviados,
      baixasComDataAnterior: baixaDataAnterior, baixasPorBuscaAmpla: baixaBuscaAmpla,
      conferidosPorFormatoDiferente: itens.filter(function (i) { return i.formatoDiferente; }).length
    }
  };
}
