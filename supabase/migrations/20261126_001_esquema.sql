-- Registro do que foi aplicado no projeto Supabase central-producao-sillion (fnkoudqdkgwzaspfkeak).
-- Já aplicado. Mantido aqui para referência e para recriar o banco se preciso.

create table public.perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  usuario text not null unique,
  email_sillion text,
  papel text not null default 'operador' check (papel in ('admin','operador')),
  ativo boolean not null default true,
  trocar_senha boolean not null default false,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table public.formularios (
  slug text primary key,
  titulo text not null,
  descricao text,
  aba_planilha text not null,
  colunas_planilha jsonb not null,
  campos jsonb not null,
  ordem int not null default 0,
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now()
);

create table public.respostas (
  id uuid primary key default gen_random_uuid(),
  id_cliente uuid not null unique,
  formulario text not null references public.formularios(slug),
  usuario_id uuid not null references public.perfis(id),
  email_registrado text,
  preenchido_em timestamptz not null,
  recebido_em timestamptz not null default now(),
  dados jsonb not null,
  planilha_sincronizada_em timestamptz,
  planilha_erro text,
  planilha_tentativas int not null default 0
);
create index respostas_pendentes_idx on public.respostas (recebido_em) where planilha_sincronizada_em is null;
create index respostas_form_data_idx on public.respostas (formulario, preenchido_em desc);

-- Backup compacto: uma linha por conteúdo distinto (hash). Nunca duplica.
create table public.backup_linhas (
  id bigint generated always as identity primary key,
  aba text not null,
  hash text not null,
  linha jsonb not null,
  visto_primeiro_em timestamptz not null default now(),
  visto_ultimo_em timestamptz not null default now(),
  removida_em timestamptz,
  unique (aba, hash)
);
create table public.backup_cabecalhos (aba text primary key, colunas jsonb not null, atualizado_em timestamptz not null default now());
create table public.backup_execucoes (
  id bigint generated always as identity primary key,
  executado_em timestamptz not null default now(),
  aba text not null, linhas_planilha int not null, novas int not null, removidas int not null,
  status text not null, mensagem text
);
create table public.pulsos (id bigint generated always as identity primary key, origem text not null, em timestamptz not null default now());
create table public.integracoes (nome text primary key, token_hash text not null unique, criado_em timestamptz not null default now());

create or replace function public.eh_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis where id = auth.uid() and papel = 'admin' and ativo); $$;
create or replace function public.eh_ativo() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis where id = auth.uid() and ativo); $$;
create or replace function public.encerrar_sessoes(p_usuario uuid) returns void language sql security definer set search_path = public, auth as $$
  delete from auth.sessions where user_id = p_usuario; $$;
create or replace function public.marcar_senha_trocada() returns void language sql security definer set search_path = public as $$
  update public.perfis set trocar_senha = false, atualizado_em = now() where id = auth.uid(); $$;

revoke execute on function public.eh_admin() from public, anon;
revoke execute on function public.eh_ativo() from public, anon;
revoke execute on function public.marcar_senha_trocada() from public, anon;
revoke all on function public.encerrar_sessoes(uuid) from public, anon, authenticated;
grant execute on function public.eh_admin(), public.eh_ativo(), public.marcar_senha_trocada() to authenticated;
grant execute on function public.encerrar_sessoes(uuid) to service_role;

alter table public.perfis enable row level security;
alter table public.formularios enable row level security;
alter table public.respostas enable row level security;
alter table public.backup_linhas enable row level security;
alter table public.backup_cabecalhos enable row level security;
alter table public.backup_execucoes enable row level security;
alter table public.pulsos enable row level security;
alter table public.integracoes enable row level security;

create policy perfis_ler on public.perfis for select to authenticated using (id = auth.uid() or public.eh_admin());
create policy formularios_ler on public.formularios for select to authenticated using (public.eh_ativo());
create policy formularios_admin on public.formularios for all to authenticated using (public.eh_admin()) with check (public.eh_admin());
create policy respostas_inserir on public.respostas for insert to authenticated with check (usuario_id = auth.uid() and public.eh_ativo());
create policy respostas_ler on public.respostas for select to authenticated using (usuario_id = auth.uid() or public.eh_admin());
create policy backup_ler on public.backup_linhas for select to authenticated using (public.eh_admin());
create policy backup_cab_ler on public.backup_cabecalhos for select to authenticated using (public.eh_admin());
create policy backup_exec_ler on public.backup_execucoes for select to authenticated using (public.eh_admin());
-- pulsos e integracoes: sem políticas (só as funções do servidor acessam)
