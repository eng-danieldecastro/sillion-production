import "./style.css";
import { createClient, type Session } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_CHAVE_PUBLICA, DOMINIO_LOGIN, VERSAO_APP } from "./config";
import type { Campo, Formulario, Perfil, RespostaPendente } from "./tipos";

/* ------------------------------------------------------------------ */
/* Estado                                                              */
/* ------------------------------------------------------------------ */
// A sessão fica salva no aparelho: o login vale até sair, desinstalar o app
// ou o administrador trocar a senha / bloquear o usuário.
const sb = createClient(SUPABASE_URL, SUPABASE_CHAVE_PUBLICA, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "cps-sessao" },
});

const CHAVE_FILA = "cps-fila";
const CHAVE_FORMS = "cps-formularios";
const CHAVE_PERFIL = "cps-perfil";

let perfil: Perfil | null = lerJSON<Perfil>(CHAVE_PERFIL);
let formularios: Formulario[] = lerJSON<Formulario[]>(CHAVE_FORMS) || [];
let enviando = false;

const app = document.getElementById("app")!;

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */
function lerJSON<T>(chave: string): T | null {
  try { const v = localStorage.getItem(chave); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
}
function gravarJSON(chave: string, valor: unknown) {
  try { localStorage.setItem(chave, JSON.stringify(valor)); } catch { /* armazenamento cheio */ }
}
function esc(t: unknown) {
  return String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
function fila(): RespostaPendente[] { return lerJSON<RespostaPendente[]>(CHAVE_FILA) || []; }
function salvarFila(f: RespostaPendente[]) { gravarJSON(CHAVE_FILA, f); }
function primeiroNome(n: string) { return (n || "").split(" ")[0]; }
function aviso(texto: string, tipo: "ok" | "erro" = "ok") {
  const el = document.createElement("div");
  el.className = `aviso aviso-${tipo}`;
  el.textContent = texto;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("visivel"));
  setTimeout(() => { el.classList.remove("visivel"); setTimeout(() => el.remove(), 300); }, 3200);
}

const LOGO = `<img class="logo" src="./logo.png" alt="Sillion" />`;

/* ------------------------------------------------------------------ */
/* Login                                                               */
/* ------------------------------------------------------------------ */
function telaLogin(mensagem = "") {
  app.innerHTML = `
    <main class="tela-login">
      <div class="login-topo">${LOGO}<p class="login-nome">Central de Produção</p></div>
      <form class="cartao login-cartao" id="f-login" autocomplete="on">
        <h1>Entrar</h1>
        <label class="campo"><span>Usuário</span>
          <input name="usuario" autocapitalize="none" autocorrect="off" spellcheck="false" autocomplete="username" required /></label>
        <label class="campo"><span>Senha</span>
          <div class="senha-linha">
            <input name="senha" type="password" autocomplete="current-password" required />
            <button type="button" class="btn-olho" aria-label="Mostrar senha">Mostrar</button>
          </div></label>
        <p class="erro" id="erro-login">${esc(mensagem)}</p>
        <button class="btn btn-primario" type="submit">Entrar</button>
      </form>
      <p class="rodape">Versão ${VERSAO_APP}</p>
    </main>`;
  const form = document.getElementById("f-login") as HTMLFormElement;
  const olho = form.querySelector(".btn-olho") as HTMLButtonElement;
  olho.onclick = () => {
    const i = form.senha as HTMLInputElement;
    i.type = i.type === "password" ? "text" : "password";
    olho.textContent = i.type === "password" ? "Mostrar" : "Ocultar";
  };
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const btn = form.querySelector("button[type=submit]") as HTMLButtonElement;
    const erro = document.getElementById("erro-login")!;
    const usuario = String(form.usuario.value).trim().toLowerCase();
    const senha = String(form.senha.value);
    if (!navigator.onLine) { erro.textContent = "Sem internet. O primeiro acesso precisa de conexão."; return; }
    btn.disabled = true; btn.textContent = "Entrando…"; erro.textContent = "";
    const { error } = await sb.auth.signInWithPassword({ email: `${usuario}@${DOMINIO_LOGIN}`, password: senha });
    if (error) {
      btn.disabled = false; btn.textContent = "Entrar";
      erro.textContent = /banned/i.test(error.message) ? "Acesso bloqueado. Fale com o administrador."
        : "Usuário ou senha incorretos.";
      return;
    }
    await iniciarSessao();
  };
}

async function carregarPerfil(sessao: Session): Promise<Perfil | null> {
  const { data, error } = await sb.from("perfis")
    .select("id, nome, usuario, email_sillion, papel, ativo, trocar_senha")
    .eq("id", sessao.user.id).maybeSingle();
  if (error) throw error;
  return data as Perfil | null;
}

async function carregarFormularios() {
  const { data, error } = await sb.from("formularios")
    .select("slug, titulo, descricao, campos, ordem").eq("ativo", true).order("ordem");
  if (error) throw error;
  formularios = (data || []) as Formulario[];
  gravarJSON(CHAVE_FORMS, formularios);
}

async function iniciarSessao() {
  const { data } = await sb.auth.getSession();
  const sessao = data.session;
  if (!sessao) { telaLogin(); return; }

  // Abre na hora com o que já está salvo no aparelho (funciona sem internet)
  // e atualiza perfil e formulários em segundo plano.
  const jaAbriu = !!perfil && perfil.id === sessao.user.id && formularios.length > 0;
  if (jaAbriu && !perfil!.trocar_senha) telaInicio();

  if (navigator.onLine) {
    try {
      const p = await carregarPerfil(sessao);
      if (!p || !p.ativo) { await sair(true, "Acesso bloqueado. Fale com o administrador."); return; }
      perfil = p; gravarJSON(CHAVE_PERFIL, p);
      await carregarFormularios();
    } catch {
      // sem conexão estável: segue com o que está salvo no aparelho
    }
  }
  if (!perfil) { telaLogin("Não foi possível carregar seu perfil. Verifique a internet."); return; }
  if (perfil.trocar_senha && navigator.onLine) { telaTrocarSenha(true); return; }
  // só redesenha se o operador ainda estiver na tela inicial
  if (!jaAbriu || document.querySelector(".lista-forms")) telaInicio();
  enviarFila();
}

async function sair(forcado = false, mensagem = "") {
  const pendentes = fila().length;
  if (!forcado && pendentes > 0) {
    if (!confirm(`Há ${pendentes} resposta(s) ainda não enviada(s). Se sair agora, elas serão perdidas. Sair mesmo assim?`)) return;
  }
  try { await sb.auth.signOut({ scope: "local" }); } catch { /* ignora */ }
  localStorage.removeItem(CHAVE_PERFIL);
  // Saída voluntária (já confirmada) limpa a fila. Saída forçada (sessão expirada)
  // mantém as respostas no aparelho para enviar quando o mesmo usuário entrar de novo.
  if (!forcado) salvarFila([]);
  perfil = null;
  telaLogin(mensagem);
}

/* ------------------------------------------------------------------ */
/* Troca de senha                                                      */
/* ------------------------------------------------------------------ */
function telaTrocarSenha(obrigatoria: boolean) {
  app.innerHTML = `
    ${cabecalho(obrigatoria ? "" : "voltar")}
    <main class="conteudo">
      <form class="cartao" id="f-senha">
        <h1>${obrigatoria ? "Crie a sua senha" : "Trocar senha"}</h1>
        <p class="sub">${obrigatoria ? "Antes de começar, troque a senha provisória por uma senha só sua." : "A nova senha vale a partir de agora."}</p>
        <label class="campo"><span>Nova senha</span><input name="s1" type="password" minlength="6" required autocomplete="new-password" /></label>
        <label class="campo"><span>Repita a nova senha</span><input name="s2" type="password" minlength="6" required autocomplete="new-password" /></label>
        <p class="erro" id="erro-senha"></p>
        <button class="btn btn-primario" type="submit">Salvar senha</button>
      </form>
    </main>`;
  ligarCabecalho();
  const f = document.getElementById("f-senha") as HTMLFormElement;
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const erro = document.getElementById("erro-senha")!;
    const s1 = String(f.s1.value), s2 = String(f.s2.value);
    if (s1.length < 6) { erro.textContent = "Use pelo menos 6 caracteres."; return; }
    if (s1 !== s2) { erro.textContent = "As senhas não são iguais."; return; }
    const btn = f.querySelector("button[type=submit]") as HTMLButtonElement;
    btn.disabled = true; btn.textContent = "Salvando…";
    const { error } = await sb.auth.updateUser({ password: s1 });
    if (error) {
      btn.disabled = false; btn.textContent = "Salvar senha";
      erro.textContent = /different/i.test(error.message) ? "A nova senha precisa ser diferente da atual." : "Não foi possível salvar. Tente de novo.";
      return;
    }
    await sb.rpc("marcar_senha_trocada");
    if (perfil) { perfil.trocar_senha = false; gravarJSON(CHAVE_PERFIL, perfil); }
    aviso("Senha alterada.");
    telaInicio();
  };
}

/* ------------------------------------------------------------------ */
/* Início                                                              */
/* ------------------------------------------------------------------ */
function cabecalho(acao: "" | "voltar" | "menu") {
  return `
    <header class="topo">
      ${acao === "voltar" ? `<button class="topo-btn" id="btn-voltar" aria-label="Voltar">‹</button>` : `<span class="topo-espaco"></span>`}
      ${LOGO}
      ${acao === "menu" ? `<button class="topo-btn" id="btn-menu" aria-label="Menu">⋯</button>` : `<span class="topo-espaco"></span>`}
    </header>`;
}
function ligarCabecalho() {
  const v = document.getElementById("btn-voltar"); if (v) v.onclick = () => telaInicio();
  const m = document.getElementById("btn-menu"); if (m) m.onclick = abrirMenu;
}

function abrirMenu() {
  const fundo = document.createElement("div");
  fundo.className = "menu-fundo";
  fundo.innerHTML = `
    <div class="menu">
      <p class="menu-quem"><strong>${esc(perfil?.nome)}</strong><br/><span>${esc(perfil?.usuario)}</span></p>
      <button data-a="senha">Trocar senha</button>
      <button data-a="sair" class="perigo">Sair</button>
      <button data-a="fechar">Fechar</button>
    </div>`;
  document.body.appendChild(fundo);
  fundo.onclick = (ev) => {
    const a = (ev.target as HTMLElement).dataset.a;
    if (ev.target === fundo || a === "fechar") fundo.remove();
    if (a === "senha") { fundo.remove(); if (!navigator.onLine) aviso("Precisa de internet para trocar a senha.", "erro"); else telaTrocarSenha(false); }
    if (a === "sair") { fundo.remove(); sair(); }
  };
}

function resumoFila() {
  const f = fila();
  if (!f.length) return "";
  return `<div class="faixa-fila" id="faixa-fila">
    <span><strong>${f.length}</strong> resposta(s) aguardando envio${navigator.onLine ? "" : " · sem internet"}</span>
    <button class="btn-link" id="btn-enviar">Enviar agora</button></div>`;
}

function telaInicio() {
  const lista = [...formularios].sort((a, b) => a.ordem - b.ordem);
  app.innerHTML = `
    ${cabecalho("menu")}
    <main class="conteudo">
      <section class="saudacao">
        <p class="sub">Olá, ${esc(primeiroNome(perfil?.nome || ""))}</p>
        <h1>Qual formulário você vai responder?</h1>
      </section>
      ${resumoFila()}
      <section class="lista-forms">
        ${lista.length ? lista.map((f) => `
          <button class="cartao cartao-form" data-slug="${esc(f.slug)}">
            <span class="cf-titulo">${esc(f.titulo)}</span>
            <span class="cf-seta">›</span>
          </button>`).join("") : `<p class="vazio">Nenhum formulário disponível. Conecte-se à internet e abra o app de novo.</p>`}
      </section>
    </main>`;
  ligarCabecalho();
  app.querySelectorAll<HTMLButtonElement>(".cartao-form").forEach((b) => {
    b.onclick = () => { const f = formularios.find((x) => x.slug === b.dataset.slug); if (f) telaFormulario(f); };
  });
  const be = document.getElementById("btn-enviar"); if (be) be.onclick = () => enviarFila(true);
}

/* ------------------------------------------------------------------ */
/* Formulário                                                          */
/* ------------------------------------------------------------------ */
function htmlCampo(c: Campo, i: number) {
  const id = `c${i}`;
  const obr = c.obrigatorio ? `<em class="obr" aria-label="obrigatório">*</em>` : "";
  const titulo = `<span class="campo-rotulo">${esc(c.rotulo)} ${obr}</span>`;
  const op = c.opcoes || [];
  switch (c.tipo) {
    case "texto":
      return `<label class="campo" data-chave="${esc(c.chave)}">${titulo}<input id="${id}" name="${esc(c.chave)}" autocomplete="off" /></label>`;
    case "paragrafo":
      return `<label class="campo" data-chave="${esc(c.chave)}">${titulo}<textarea id="${id}" name="${esc(c.chave)}" rows="3"></textarea></label>`;
    case "lista":
      return `<label class="campo" data-chave="${esc(c.chave)}">${titulo}<select id="${id}" name="${esc(c.chave)}">
        <option value="">Escolher</option>${op.map((o) => `<option>${esc(o)}</option>`).join("")}</select></label>`;
    case "radio":
      return `<fieldset class="campo" data-chave="${esc(c.chave)}"><legend>${titulo}</legend><div class="opcoes">
        ${op.map((o) => `<label class="opcao"><input type="radio" name="${esc(c.chave)}" value="${esc(o)}" /><span>${esc(o)}</span></label>`).join("")}
        </div></fieldset>`;
    case "caixas":
      return `<fieldset class="campo" data-chave="${esc(c.chave)}"><legend>${titulo}<small>Pode marcar mais de uma</small></legend>
        ${op.length > 8 ? `<input class="filtro" type="search" placeholder="Filtrar opções" data-filtro="${esc(c.chave)}" />` : ""}
        <div class="opcoes">
        ${op.map((o) => `<label class="opcao"><input type="checkbox" name="${esc(c.chave)}" value="${esc(o)}" /><span>${esc(o)}</span></label>`).join("")}
        </div></fieldset>`;
  }
}

function lerValor(form: HTMLFormElement, c: Campo): string | string[] {
  if (c.tipo === "caixas") {
    return Array.from(form.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name="${CSS.escape(c.chave)}"]:checked`)).map((i) => i.value);
  }
  if (c.tipo === "radio") {
    const m = form.querySelector<HTMLInputElement>(`input[type=radio][name="${CSS.escape(c.chave)}"]:checked`);
    return m ? m.value : "";
  }
  const el = form.querySelector<HTMLInputElement>(`[name="${CSS.escape(c.chave)}"]`);
  return el ? el.value.trim() : "";
}

function telaFormulario(f: Formulario) {
  app.innerHTML = `
    ${cabecalho("voltar")}
    <main class="conteudo">
      <form class="formulario" id="f-resp" novalidate>
        <header class="form-cab">
          <h1>${esc(f.titulo)}</h1>
          ${f.descricao ? `<p class="sub">${esc(f.descricao)}</p>` : ""}
          <p class="nota"><em class="obr">*</em> obrigatório</p>
        </header>
        ${f.campos.map(htmlCampo).join("")}
        <div class="acoes"><button class="btn btn-primario" type="submit">Enviar resposta</button></div>
      </form>
    </main>`;
  ligarCabecalho();
  window.scrollTo(0, 0);
  const form = document.getElementById("f-resp") as HTMLFormElement;

  form.querySelectorAll<HTMLInputElement>("input[data-filtro]").forEach((inp) => {
    inp.oninput = () => {
      const t = inp.value.trim().toLowerCase();
      inp.parentElement!.querySelectorAll<HTMLLabelElement>(".opcao").forEach((l) => {
        l.style.display = !t || l.textContent!.toLowerCase().includes(t) || (l.querySelector("input") as HTMLInputElement).checked ? "" : "none";
      });
    };
  });
  form.addEventListener("change", (ev) => {
    const bloco = (ev.target as HTMLElement).closest(".campo"); if (bloco) bloco.classList.remove("invalido");
  });

  form.onsubmit = (ev) => {
    ev.preventDefault();
    const dados: Record<string, string | string[]> = {};
    let primeiroErro: HTMLElement | null = null;
    for (const c of f.campos) {
      const v = lerValor(form, c);
      const vazio = Array.isArray(v) ? v.length === 0 : v === "";
      const bloco = form.querySelector<HTMLElement>(`.campo[data-chave="${CSS.escape(c.chave)}"]`)!;
      bloco.classList.toggle("invalido", c.obrigatorio && vazio);
      if (c.obrigatorio && vazio && !primeiroErro) primeiroErro = bloco;
      if (!vazio) dados[c.chave] = v;
    }
    if (primeiroErro) {
      primeiroErro.scrollIntoView({ behavior: "smooth", block: "center" });
      aviso("Preencha os campos obrigatórios.", "erro");
      return;
    }
    const item: RespostaPendente = {
      id_cliente: uuid(), formulario: f.slug, titulo: f.titulo,
      usuario_id: perfil!.id, email_registrado: perfil!.email_sillion,
      preenchido_em: new Date().toISOString(), dados, tentativas: 0,
    };
    salvarFila([...fila(), item]);
    telaEnviado(f);
    enviarFila();
  };
}

function telaEnviado(f: Formulario) {
  app.innerHTML = `
    ${cabecalho("voltar")}
    <main class="conteudo centro">
      <div class="cartao enviado">
        <div class="check">✓</div>
        <h1>Resposta registrada</h1>
        <p class="sub" id="estado-envio">${navigator.onLine ? "Enviando…" : "Sem internet. Será enviada assim que a conexão voltar."}</p>
        <button class="btn btn-primario" id="btn-de-novo">Responder de novo</button>
        <button class="btn btn-secundario" id="btn-inicio">Voltar ao início</button>
      </div>
    </main>`;
  ligarCabecalho();
  document.getElementById("btn-de-novo")!.onclick = () => telaFormulario(f);
  document.getElementById("btn-inicio")!.onclick = () => telaInicio();
}

/* ------------------------------------------------------------------ */
/* Envio (com fila offline)                                            */
/* ------------------------------------------------------------------ */
async function enviarFila(manual = false) {
  if (enviando) return;
  const pendentes = fila();
  if (!pendentes.length) return;
  if (!navigator.onLine) { if (manual) aviso("Sem internet no momento.", "erro"); return; }
  enviando = true;
  let enviados = 0;
  try {
    const { data } = await sb.auth.getSession();
    if (!data.session) { await sair(true, "Sua sessão terminou. Entre de novo."); return; }
    for (const item of pendentes) {
      const { error } = await sb.from("respostas").insert({
        id_cliente: item.id_cliente, formulario: item.formulario, usuario_id: item.usuario_id,
        email_registrado: item.email_registrado, preenchido_em: item.preenchido_em, dados: item.dados,
      });
      if (!error || error.code === "23505") { // 23505 = já enviada antes
        salvarFila(fila().filter((x) => x.id_cliente !== item.id_cliente));
        enviados++;
      } else {
        const f = fila().map((x) => x.id_cliente === item.id_cliente ? { ...x, tentativas: x.tentativas + 1, ultimo_erro: error.message } : x);
        salvarFila(f);
        if (/JWT|token|permission|row-level/i.test(error.message)) {
          await sair(true, "Sua sessão terminou ou o acesso foi bloqueado. Entre de novo.");
          return;
        }
        break; // erro de rede: tenta depois
      }
    }
  } finally {
    enviando = false;
  }
  const estado = document.getElementById("estado-envio");
  if (estado && enviados) estado.textContent = fila().length ? "Enviada. Ainda há respostas na fila." : "Enviada com sucesso.";
  if (manual && enviados) aviso(`${enviados} resposta(s) enviada(s).`);
  const faixa = document.getElementById("faixa-fila");
  if (faixa) faixa.outerHTML = resumoFila() || "";
  const be = document.getElementById("btn-enviar"); if (be) be.onclick = () => enviarFila(true);
}

window.addEventListener("online", () => enviarFila());
setInterval(() => enviarFila(), 30000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) enviarFila(); });

sb.auth.onAuthStateChange((evento) => {
  // refresh negado (senha trocada / usuário bloqueado): volta ao login
  if (evento === "SIGNED_OUT" && perfil) { perfil = null; localStorage.removeItem(CHAVE_PERFIL); telaLogin("Sua sessão terminou. Entre de novo."); }
});

iniciarSessao();
