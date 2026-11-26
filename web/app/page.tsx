"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { sb, DOMINIO_LOGIN } from "@/lib/supabase";

export default function Login() {
  const router = useRouter();
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => { if (data.session) router.replace("/painel"); });
  }, [router]);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErro(""); setCarregando(true);
    const { data, error } = await sb.auth.signInWithPassword({
      email: `${usuario.trim().toLowerCase()}@${DOMINIO_LOGIN}`, password: senha,
    });
    if (error || !data.session) {
      setCarregando(false);
      setErro(/banned/i.test(error?.message || "") ? "Acesso bloqueado." : "Usuário ou senha incorretos.");
      return;
    }
    const { data: p } = await sb.from("perfis").select("papel, ativo").eq("id", data.session.user.id).maybeSingle();
    if (!p || p.papel !== "admin" || !p.ativo) {
      await sb.auth.signOut({ scope: "local" });
      setCarregando(false);
      setErro("Este painel é só para administradores. Operadores usam o aplicativo no celular.");
      return;
    }
    router.replace("/painel");
  }

  return (
    <main className="login">
      <div className="login-marca">
        <img src="/logo.png" alt="Sillion" />
        <p>Central de Produção</p>
      </div>
      <form className="cartao login-cartao" onSubmit={entrar}>
        <h1>Painel de gestão</h1>
        <p className="sub">Acessos, respostas e sincronização do aplicativo.</p>
        <label className="campo"><span>Usuário</span>
          <input value={usuario} onChange={(e) => setUsuario(e.target.value)} autoCapitalize="none" autoComplete="username" required /></label>
        <label className="campo"><span>Senha</span>
          <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" required /></label>
        <p className="erro">{erro}</p>
        <button className="btn btn-primario" disabled={carregando}>{carregando ? "Entrando…" : "Entrar"}</button>
      </form>
    </main>
  );
}
