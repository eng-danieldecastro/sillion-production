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
 *  3. Todo dia às 3h envia ao Supabase um backup das abas (só o que é novo ou mudou).
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
              "Registro_Geral_Streamax":     "Registro_Geral_Streamax" } },
    { id: "12mansudeO4kq-5Ua9h89U3yg47jelhWugMLFjvjaOG8",                   // Manutenção RST_Mini
      abas: { "Respostas ao formulário 1": "RST_Mini" } },
    { id: "1oBx7p9IitwkEHD6JFpnpsdDwgm2l4sNfqGY73XvMSWs",                   // Controle Streamax (Insumos)
      abas: { "Insumos": "Insumos" } },
  ],

  // Abas enviadas no backup diário
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
  ScriptApp.newTrigger("backupDiario").timeBased().atHour(3).everyDays(1).inTimezone(CFG.FUSO).create();
  CFG.ORIGENS_FORMS.forEach(function (o) {
    ScriptApp.newTrigger("copiarRespostaForms").forSpreadsheet(o.id).onFormSubmit().create();
  });

  sincronizarApp();
  backupDiario();
  Logger.log("Instalado: sincronização a cada 5 min, cópia dos Google Forms e backup diário às 3h.");
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
    while (linha.length < largura) linha.push("");
    destino.getRange(destino.getLastRow() + 1, 1, 1, largura).setValues([linha]);
  } catch (err) {
    console.error("copiarRespostaForms: " + err);
  }
}

/* ------------------------------------------------------------------ */
/* 3. Backup diário no Supabase (sem duplicar)                          */
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
