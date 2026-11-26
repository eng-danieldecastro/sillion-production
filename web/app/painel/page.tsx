"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { sb, adminUsuarios } from "@/lib/supabase";

/* ------------------------------------------------------------------ */
/* Tipos                                                               */
/* ------------------------------------------------------------------ */
type Campo = { chave: string; rotulo: string; tipo: string; obrigatorio: boolean; opcoes?: string[] };
type Formulario = { slug: string; titulo: string; aba_planilha: string; campos: Campo[]; ordem: number; ativo: boolean };
type Usuario = {
  id: string; nome: string; usuario: string; email_sillion: string | null; papel: "admin" | "operador";
  ativo: boolean; trocar_senha: boolean; criado_em: string; ultimo_acesso: string | null;
};
type Resposta = {
  id: string; formulario: string; preenchido_em: string; recebido_em: string; dados: Record<string, string | string[]>;
  planilha_sincronizada_em: string | null; planilha_erro: string | null; usuario_id: string;
  perfis?: { nome: string } | null;
};
type Aba = "usuarios" | "respostas" | "formularios" | "sincronizacao" | "simulacao";

const fmt = (iso?: string | null) => iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";
const valorTexto = (v: unknown) => Array.isArray(v) ? v.join(", ") : String(v ?? "");

/* ------------------------------------------------------------------ */
export default function Painel() {
  const router = useRouter();
  const [pronto, setPronto] = useState(false);
  const [eu, setEu] = useState<{ id: string; nome: string } | null>(null);
  const [aba, setAba] = useState<Aba>("usuarios");
  const [formularios, setFormularios] = useState<Formulario[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await sb.auth.getSession();
      if (!data.session) { router.replace("/"); return; }
      const { data: p } = await sb.from("perfis").select("id, nome, papel, ativo").eq("id", data.session.user.id).maybeSingle();
      if (!p || p.papel !== "admin" || !p.ativo) { await sb.auth.signOut({ scope: "local" }); router.replace("/"); return; }
      setEu({ id: p.id, nome: p.nome });
      const { data: f } = await sb.from("formularios").select("slug, titulo, aba_planilha, campos, ordem, ativo").order("ordem");
      setFormularios((f || []) as Formulario[]);
      setPronto(true);
    })();
    const { data: sub } = sb.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT") router.replace("/"); });
    return () => sub.subscription.unsubscribe();
  }, [router]);

  if (!pronto) return <div className="carregando">Carregando…</div>;

  const abas: [Aba, string][] = [
    ["usuarios", "Usuários"], ["respostas", "Respostas"], ["formularios", "Formulários"],
    ["sincronizacao", "Planilha e backup"], ["simulacao", "Simulação"],
  ];

  return (
    <div className="painel">
      <header className="topo">
        <div className="topo-marca"><img src="/logo.png" alt="Sillion" /><span>Central de Produção</span></div>
        <div className="topo-quem">
          <span>{eu?.nome}</span>
          <button className="btn-link claro" onClick={async () => { await sb.auth.signOut({ scope: "local" }); router.replace("/"); }}>Sair</button>
        </div>
      </header>
      <nav className="abas">
        {abas.map(([id, rot]) => (
          <button key={id} className={aba === id ? "ativa" : ""} onClick={() => setAba(id)}>{rot}</button>
        ))}
      </nav>
      <main className="conteudo">
        {aba === "usuarios" && <Usuarios euId={eu!.id} />}
        {aba === "respostas" && <Respostas formularios={formularios} />}
        {aba === "formularios" && <Formularios formularios={formularios} onSalvo={setFormularios} />}
        {aba === "sincronizacao" && <Sincronizacao />}
        {aba === "simulacao" && <Simulacao formularios={formularios} />}
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Usuários                                                            */
/* ------------------------------------------------------------------ */
function gerarSenha() {
  const c = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from(crypto.getRandomValues(new Uint32Array(8))).map((n) => c[n % c.length]).join("");
}

function Usuarios({ euId }: { euId: string }) {
  const [lista, setLista] = useState<Usuario[]>([]);
  const [erro, setErro] = useState("");
  const [editando, setEditando] = useState<Usuario | "novo" | null>(null);
  const [senhaGerada, setSenhaGerada] = useState<{ usuario: string; senha: string } | null>(null);
  const [busca, setBusca] = useState("");

  const carregar = useCallback(async () => {
    try { setErro(""); const r = await adminUsuarios({ acao: "listar" }); setLista(r.usuarios); }
    catch (e: any) { setErro(e.message); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const filtrada = lista.filter((u) => !busca || `${u.nome} ${u.usuario} ${u.email_sillion || ""}`.toLowerCase().includes(busca.toLowerCase()));
  const ativos = lista.filter((u) => u.ativo).length;

  async function alternarAtivo(u: Usuario) {
    if (!confirm(u.ativo ? `Bloquear ${u.nome}? O app dele pede login de novo e não aceita mais a senha.` : `Desbloquear ${u.nome}?`)) return;
    try { await adminUsuarios({ acao: "atualizar", id: u.id, ativo: !u.ativo }); carregar(); } catch (e: any) { alert(e.message); }
  }
  async function redefinirSenha(u: Usuario) {
    if (!confirm(`Gerar uma senha provisória para ${u.nome}? O app dele sai da conta e ele precisa entrar com a senha nova.`)) return;
    const senha = gerarSenha();
    try { await adminUsuarios({ acao: "atualizar", id: u.id, senha }); setSenhaGerada({ usuario: u.usuario, senha }); carregar(); }
    catch (e: any) { alert(e.message); }
  }

  return (
    <section>
      <div className="secao-cab">
        <div><h1>Usuários</h1><p className="sub">{ativos} ativo(s) de {lista.length}. Cada pessoa tem um usuário e senha próprios para o app.</p></div>
        <button className="btn btn-primario curto" onClick={() => setEditando("novo")}>Novo usuário</button>
      </div>
      {senhaGerada && (
        <div className="alerta ok">
          Senha provisória de <strong>{senhaGerada.usuario}</strong>: <code>{senhaGerada.senha}</code>. Entregue para a pessoa; no primeiro acesso o app pede para trocar.
          <button className="btn-link" onClick={() => setSenhaGerada(null)}>Fechar</button>
        </div>
      )}
      {erro && <div className="alerta erro">{erro}</div>}
      <input className="busca" placeholder="Buscar por nome, usuário ou e-mail" value={busca} onChange={(e) => setBusca(e.target.value)} />
      <div className="tabela-caixa">
        <table className="tabela">
          <thead><tr><th>Nome</th><th>Usuário</th><th>E-mail Sillion</th><th>Perfil</th><th>Situação</th><th>Último acesso</th><th></th></tr></thead>
          <tbody>
            {filtrada.map((u) => (
              <tr key={u.id} className={u.ativo ? "" : "inativo"}>
                <td>{u.nome}</td><td><code>{u.usuario}</code></td><td>{u.email_sillion || <span className="fraco">não informado</span>}</td>
                <td><span className={`selo ${u.papel}`}>{u.papel === "admin" ? "Administrador" : "Operador"}</span></td>
                <td>{u.ativo ? (u.trocar_senha ? <span className="selo aviso">Senha provisória</span> : <span className="selo ok">Ativo</span>) : <span className="selo erro">Bloqueado</span>}</td>
                <td>{fmt(u.ultimo_acesso)}</td>
                <td className="acoes-linha">
                  <button className="btn-link" onClick={() => setEditando(u)}>Editar</button>
                  <button className="btn-link" onClick={() => redefinirSenha(u)}>Nova senha</button>
                  {u.id !== euId && <button className="btn-link perigo" onClick={() => alternarAtivo(u)}>{u.ativo ? "Bloquear" : "Desbloquear"}</button>}
                </td>
              </tr>
            ))}
            {!filtrada.length && <tr><td colSpan={7} className="vazio">Nenhum usuário encontrado.</td></tr>}
          </tbody>
        </table>
      </div>
      {editando && (
        <FormUsuario
          usuario={editando === "novo" ? null : editando} euId={euId}
          onFechar={() => setEditando(null)}
          onSalvo={(s) => { setEditando(null); if (s) setSenhaGerada(s); carregar(); }}
        />
      )}
    </section>
  );
}

function FormUsuario({ usuario, euId, onFechar, onSalvo }: {
  usuario: Usuario | null; euId: string; onFechar: () => void; onSalvo: (s?: { usuario: string; senha: string }) => void;
}) {
  const novo = !usuario;
  const [nome, setNome] = useState(usuario?.nome || "");
  const [login, setLogin] = useState(usuario?.usuario || "");
  const [email, setEmail] = useState(usuario?.email_sillion || "");
  const [papel, setPapel] = useState<"admin" | "operador">(usuario?.papel || "operador");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function salvar(e: React.FormEvent) {
    e.preventDefault(); setErro(""); setSalvando(true);
    try {
      if (novo) {
        const senha = gerarSenha();
        await adminUsuarios({ acao: "criar", nome, usuario: login, email_sillion: email, papel, senha });
        onSalvo({ usuario: login.trim().toLowerCase(), senha });
      } else {
        await adminUsuarios({ acao: "atualizar", id: usuario!.id, nome, email_sillion: email, papel });
        onSalvo();
      }
    } catch (e: any) { setErro(e.message); setSalvando(false); }
  }

  return (
    <div className="modal-fundo" onClick={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <form className="modal cartao" onSubmit={salvar}>
        <h2>{novo ? "Novo usuário" : `Editar ${usuario!.nome}`}</h2>
        <label className="campo"><span>Nome completo</span><input value={nome} onChange={(e) => setNome(e.target.value)} required /></label>
        <label className="campo"><span>Usuário (login no app)</span>
          <input value={login} onChange={(e) => setLogin(e.target.value)} disabled={!novo} required placeholder="ex.: joao.carvalho" autoCapitalize="none" />
          {novo && <small>Letras minúsculas, números, ponto, hífen ou sublinhado. Não pode ser alterado depois.</small>}</label>
        <label className="campo"><span>E-mail Sillion</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@sillion.com.br" />
          <small>Vai na coluna "Endereço de e-mail" da planilha. O dashboard usa esse e-mail para mostrar o nome do técnico.</small></label>
        <label className="campo"><span>Perfil</span>
          <select value={papel} onChange={(e) => setPapel(e.target.value as any)} disabled={usuario?.id === euId}>
            <option value="operador">Operador (só responde formulários no app)</option>
            <option value="admin">Administrador (acessa este painel)</option>
          </select></label>
        {novo && <p className="sub">Uma senha provisória será gerada. No primeiro acesso, o app pede para a pessoa criar a própria senha.</p>}
        <p className="erro">{erro}</p>
        <div className="modal-acoes">
          <button type="button" className="btn btn-secundario curto" onClick={onFechar}>Cancelar</button>
          <button className="btn btn-primario curto" disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</button>
        </div>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Respostas                                                           */
/* ------------------------------------------------------------------ */
function Respostas({ formularios }: { formularios: Formulario[] }) {
  const [form, setForm] = useState(formularios[0]?.slug || "");
  const [de, setDe] = useState(() => new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10));
  const [ate, setAte] = useState(() => new Date().toISOString().slice(0, 10));
  const [lista, setLista] = useState<Resposta[]>([]);
  const [carregando, setCarregando] = useState(false);
  const def = formularios.find((f) => f.slug === form);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data } = await sb.from("respostas")
      .select("id, formulario, preenchido_em, recebido_em, dados, planilha_sincronizada_em, planilha_erro, usuario_id, perfis(nome)")
      .eq("formulario", form)
      .gte("preenchido_em", `${de}T00:00:00-03:00`).lte("preenchido_em", `${ate}T23:59:59-03:00`)
      .order("preenchido_em", { ascending: false }).limit(2000);
    setLista((data || []) as any);
    setCarregando(false);
  }, [form, de, ate]);
  useEffect(() => { if (form) carregar(); }, [carregar, form]);

  function exportar() {
    if (!def) return;
    const cab = ["Data/hora", "Operador", ...def.campos.map((c) => c.rotulo), "Gravada na planilha"];
    const linhas = lista.map((r) => [fmt(r.preenchido_em), r.perfis?.nome || "", ...def.campos.map((c) => valorTexto(r.dados[c.chave])), r.planilha_sincronizada_em ? "Sim" : "Não"]);
    const csv = [cab, ...linhas].map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = `${def.slug}_${de}_a_${ate}.csv`; a.click();
  }

  return (
    <section>
      <div className="secao-cab">
        <div><h1>Respostas do aplicativo</h1><p className="sub">O que os operadores enviaram pelo app. As respostas dos Google Forms ficam só na planilha.</p></div>
        <button className="btn btn-secundario curto" onClick={exportar} disabled={!lista.length}>Exportar CSV</button>
      </div>
      <div className="filtros">
        <label>Formulário<select value={form} onChange={(e) => setForm(e.target.value)}>{formularios.map((f) => <option key={f.slug} value={f.slug}>{f.titulo}</option>)}</select></label>
        <label>De<input type="date" value={de} onChange={(e) => setDe(e.target.value)} /></label>
        <label>Até<input type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></label>
      </div>
      <p className="sub">{carregando ? "Carregando…" : `${lista.length} resposta(s)`}</p>
      <div className="tabela-caixa">
        <table className="tabela">
          <thead><tr><th>Data/hora</th><th>Operador</th>{def?.campos.map((c) => <th key={c.chave}>{c.rotulo}</th>)}<th>Planilha</th></tr></thead>
          <tbody>
            {lista.map((r) => (
              <tr key={r.id}>
                <td className="nowrap">{fmt(r.preenchido_em)}</td><td>{r.perfis?.nome}</td>
                {def?.campos.map((c) => <td key={c.chave}>{valorTexto(r.dados[c.chave])}</td>)}
                <td>{r.planilha_sincronizada_em ? <span className="selo ok">Gravada</span> : r.planilha_erro ? <span className="selo erro" title={r.planilha_erro}>Erro</span> : <span className="selo aviso">Na fila</span>}</td>
              </tr>
            ))}
            {!lista.length && !carregando && <tr><td colSpan={(def?.campos.length || 0) + 3} className="vazio">Nenhuma resposta no período.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Formulários (opções editáveis)                                      */
/* ------------------------------------------------------------------ */
function Formularios({ formularios, onSalvo }: { formularios: Formulario[]; onSalvo: (f: Formulario[]) => void }) {
  const [sel, setSel] = useState(formularios[0]?.slug || "");
  const atual = formularios.find((f) => f.slug === sel);
  const [campos, setCampos] = useState<Campo[]>(atual?.campos || []);
  const [msg, setMsg] = useState("");
  useEffect(() => { setCampos(formularios.find((f) => f.slug === sel)?.campos || []); setMsg(""); }, [sel, formularios]);

  async function salvar() {
    const limpos = campos.map((c) => c.opcoes ? { ...c, opcoes: c.opcoes.map((o) => o.trim()).filter(Boolean) } : c);
    setCampos(limpos);
    const { error } = await sb.from("formularios").update({ campos: limpos, atualizado_em: new Date().toISOString() }).eq("slug", sel);
    if (error) { setMsg("Erro: " + error.message); return; }
    onSalvo(formularios.map((f) => f.slug === sel ? { ...f, campos: limpos } : f));
    setMsg("Salvo. Os celulares recebem a mudança na próxima vez que o app abrir com internet.");
  }

  return (
    <section>
      <div className="secao-cab">
        <div><h1>Formulários</h1><p className="sub">Edite as opções das listas. Os campos e a ordem das colunas da planilha não mudam aqui, para não quebrar o dashboard.</p></div>
      </div>
      <div className="filtros"><label>Formulário<select value={sel} onChange={(e) => setSel(e.target.value)}>{formularios.map((f) => <option key={f.slug} value={f.slug}>{f.titulo}</option>)}</select></label>
        <span className="fraco">Aba na planilha: <code>{atual?.aba_planilha}</code></span></div>
      <div className="grade-campos">
        {campos.map((c, i) => (
          <div key={c.chave} className="cartao campo-def">
            <div className="campo-def-cab"><strong>{c.rotulo}</strong>{c.obrigatorio && <span className="selo aviso">Obrigatório</span>}<span className="fraco">{({ texto: "Texto curto", paragrafo: "Texto longo", radio: "Escolha única", lista: "Lista", caixas: "Várias opções" } as any)[c.tipo]}</span></div>
            {c.opcoes && (
              <>
                <textarea rows={Math.min(10, c.opcoes.length + 1)} value={c.opcoes.join("\n")}
                  onChange={(e) => setCampos(campos.map((x, j) => j === i ? { ...x, opcoes: e.target.value.split("\n") } : x))} />
                <small>Uma opção por linha.</small>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="rodape-acoes">
        <span className="sub">{msg}</span>
        <button className="btn btn-primario curto" onClick={salvar}>Salvar opções</button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Sincronização com a planilha e backup                               */
/* ------------------------------------------------------------------ */
function Sincronizacao() {
  const [d, setD] = useState<any>(null);
  useEffect(() => {
    (async () => {
      const [pend, erros, total, execs, linhas, ult] = await Promise.all([
        sb.from("respostas").select("id", { count: "exact", head: true }).is("planilha_sincronizada_em", null),
        sb.from("respostas").select("id, formulario, preenchido_em, planilha_erro, planilha_tentativas").not("planilha_erro", "is", null).is("planilha_sincronizada_em", null).limit(20),
        sb.from("respostas").select("id", { count: "exact", head: true }),
        sb.from("backup_execucoes").select("*").order("executado_em", { ascending: false }).limit(18),
        sb.from("backup_linhas").select("id", { count: "exact", head: true }),
        sb.from("respostas").select("planilha_sincronizada_em").not("planilha_sincronizada_em", "is", null).order("planilha_sincronizada_em", { ascending: false }).limit(1),
      ]);
      setD({ pend: pend.count || 0, erros: erros.data || [], total: total.count || 0, execs: execs.data || [], linhas: linhas.count || 0, ult: ult.data?.[0]?.planilha_sincronizada_em });
    })();
  }, []);
  if (!d) return <p className="sub">Carregando…</p>;
  return (
    <section>
      <h1>Planilha e backup</h1>
      <p className="sub">As respostas do app vão para a planilha Central Geral (APP) a cada 5 minutos. O backup das abas roda todo dia às 3h e guarda cada linha uma única vez.</p>
      <div className="indicadores">
        <div className="cartao ind"><span>Respostas pelo app</span><strong>{d.total}</strong></div>
        <div className="cartao ind"><span>Aguardando a planilha</span><strong className={d.pend ? "txt-aviso" : ""}>{d.pend}</strong></div>
        <div className="cartao ind"><span>Última gravação na planilha</span><strong className="menor">{fmt(d.ult)}</strong></div>
        <div className="cartao ind"><span>Linhas guardadas no backup</span><strong>{d.linhas.toLocaleString("pt-BR")}</strong></div>
      </div>
      {!!d.erros.length && (<><h2>Com erro ao gravar</h2>
        <div className="tabela-caixa"><table className="tabela"><thead><tr><th>Formulário</th><th>Data</th><th>Tentativas</th><th>Erro</th></tr></thead>
          <tbody>{d.erros.map((e: any) => <tr key={e.id}><td>{e.formulario}</td><td>{fmt(e.preenchido_em)}</td><td>{e.planilha_tentativas}</td><td>{e.planilha_erro}</td></tr>)}</tbody></table></div></>)}
      <h2>Últimos backups</h2>
      <div className="tabela-caixa"><table className="tabela"><thead><tr><th>Quando</th><th>Aba</th><th>Linhas na planilha</th><th>Novas</th><th>Removidas ou editadas</th></tr></thead>
        <tbody>{d.execs.map((e: any) => <tr key={e.id}><td>{fmt(e.executado_em)}</td><td>{e.aba}</td><td>{e.linhas_planilha}</td><td>{e.novas}</td><td>{e.removidas}</td></tr>)}
          {!d.execs.length && <tr><td colSpan={5} className="vazio">Nenhum backup ainda. Ele começa depois que o script da planilha for instalado.</td></tr>}</tbody></table></div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Simulação da gestão dos dados (dados fictícios)                     */
/* ------------------------------------------------------------------ */
const NOMES = ["Ana Souza", "Bruno Lima", "Carla Dias", "Diego Rocha", "Elisa Martins", "Felipe Alves", "Gabriela Nunes", "Henrique Costa"];

function Simulacao({ formularios }: { formularios: Formulario[] }) {
  const [semente, setSemente] = useState(1);
  const [dias, setDias] = useState(30);

  const dados = useMemo(() => {
    let s = semente * 9301 + 49297;
    const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const lista: { form: string; dia: string; op: string; principal: string }[] = [];
    for (let d = dias - 1; d >= 0; d--) {
      const data = new Date(hoje.getTime() - d * 864e5);
      if (data.getDay() === 0 || data.getDay() === 6) continue; // sem produção no fim de semana
      const dia = data.toISOString().slice(0, 10);
      for (const f of formularios) {
        const n = Math.floor(rnd() * 14) + 2;
        const campoChave = f.campos.find((c) => c.tipo === "caixas" && c.obrigatorio) || f.campos.find((c) => c.opcoes);
        for (let i = 0; i < n; i++) lista.push({ form: f.slug, dia, op: pick(NOMES), principal: campoChave?.opcoes ? pick(campoChave.opcoes) : "" });
      }
    }
    return lista;
  }, [semente, dias, formularios]);

  const porForm = formularios.map((f) => ({ f, n: dados.filter((d) => d.form === f.slug).length }));
  const porDia = Object.entries(dados.reduce((a: Record<string, number>, d) => { a[d.dia] = (a[d.dia] || 0) + 1; return a; }, {})).sort();
  const maxDia = Math.max(1, ...porDia.map(([, n]) => n));
  const porOp = Object.entries(dados.reduce((a: Record<string, number>, d) => { a[d.op] = (a[d.op] || 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1]);
  const maxOp = Math.max(1, ...porOp.map(([, n]) => n));
  const [formTop, setFormTop] = useState(formularios[0]?.slug || "");
  const top = Object.entries(dados.filter((d) => d.form === formTop).reduce((a: Record<string, number>, d) => { if (d.principal) a[d.principal] = (a[d.principal] || 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const maxTop = Math.max(1, ...top.map(([, n]) => n));

  return (
    <section>
      <div className="secao-cab">
        <div><h1>Simulação da gestão dos dados</h1><p className="sub">Prévia com dados <strong>fictícios</strong>, gerados a partir dos formulários reais, para ver como a gestão vai ficar quando o app estiver em uso. Nada aqui é gravado.</p></div>
        <div className="filtros"><label>Período<select value={dias} onChange={(e) => setDias(Number(e.target.value))}><option value={7}>7 dias</option><option value={30}>30 dias</option><option value={90}>90 dias</option></select></label>
          <button className="btn btn-secundario curto" onClick={() => setSemente(semente + 1)}>Gerar outros dados</button></div>
      </div>
      <div className="selo-sim">Dados fictícios</div>
      <div className="indicadores">
        <div className="cartao ind"><span>Respostas no período</span><strong>{dados.length}</strong></div>
        <div className="cartao ind"><span>Operadores ativos</span><strong>{porOp.length}</strong></div>
        <div className="cartao ind"><span>Média por dia útil</span><strong>{Math.round(dados.length / Math.max(1, porDia.length))}</strong></div>
        <div className="cartao ind"><span>Formulário mais usado</span><strong className="menor">{[...porForm].sort((a, b) => b.n - a.n)[0]?.f.titulo}</strong></div>
      </div>
      <div className="grade-2">
        <div className="cartao">
          <h2>Respostas por dia</h2>
          <div className="colunas">{porDia.map(([dia, n]) => (
            <div key={dia} className="col" title={`${dia.split("-").reverse().join("/")}: ${n}`}><div style={{ height: `${(n / maxDia) * 100}%` }} /></div>
          ))}</div>
          <p className="fraco">{porDia[0]?.[0].split("-").reverse().join("/")} a {porDia.at(-1)?.[0].split("-").reverse().join("/")} · dias úteis</p>
        </div>
        <div className="cartao">
          <h2>Por formulário</h2>
          {porForm.map(({ f, n }) => <Barra key={f.slug} rotulo={f.titulo} valor={n} max={Math.max(...porForm.map((x) => x.n), 1)} />)}
        </div>
        <div className="cartao">
          <h2>Por operador</h2>
          {porOp.map(([nome, n]) => <Barra key={nome} rotulo={nome} valor={n} max={maxOp} />)}
        </div>
        <div className="cartao">
          <div className="cab-linha"><h2>Mais registrados</h2>
            <select value={formTop} onChange={(e) => setFormTop(e.target.value)}>{formularios.map((f) => <option key={f.slug} value={f.slug}>{f.titulo}</option>)}</select></div>
          {top.map(([o, n]) => <Barra key={o} rotulo={o} valor={n} max={maxTop} />)}
        </div>
      </div>
    </section>
  );
}

function Barra({ rotulo, valor, max }: { rotulo: string; valor: number; max: number }) {
  return (
    <div className="barra">
      <span className="barra-rot" title={rotulo}>{rotulo}</span>
      <span className="barra-trilho"><span style={{ width: `${(valor / max) * 100}%` }} /></span>
      <span className="barra-val">{valor}</span>
    </div>
  );
}
