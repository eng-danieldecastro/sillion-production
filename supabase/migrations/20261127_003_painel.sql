-- Dashboard do aplicativo: resumo calculado no banco a partir do backup da planilha
-- (backup_linhas) e dos números externos (câmeras e fornecedores) enviados pelo script da planilha.

create table if not exists public.painel_externo (
  chave text primary key,             -- 'cameras' | 'fornecedores'
  dados jsonb not null,
  atualizado_em timestamptz not null default now()
);
alter table public.painel_externo enable row level security;
-- sem políticas: só a função do servidor e painel_resumo() acessam

-- Data (dia) do "Carimbo de data/hora" no formato da planilha: dd/MM/yyyy HH:mm:ss
create or replace function public.dia_carimbo(t text) returns date
language sql immutable set search_path = public as $$
  select case when t ~ '^\d{1,2}/\d{1,2}/\d{4}' then to_date(split_part(t, ' ', 1), 'DD/MM/YYYY') end $$;

-- Grupo (Hardware / Software / Outros) de cada opção, conforme formularios.campos[].grupos
create or replace function public.grupos_opcoes(p_form text, p_campo text)
returns table (opcao text, grupo text)
language sql stable security definer set search_path = public as $$
  select o, g->>'titulo'
  from formularios f
  cross join lateral jsonb_array_elements(f.campos) c
  cross join lateral jsonb_array_elements(coalesce(c->'grupos', '[]'::jsonb)) g
  cross join lateral jsonb_array_elements_text(g->'opcoes') o
  where f.slug = p_form and c->>'chave' = p_campo $$;

create or replace function public.painel_resumo(p_inicio date, p_fim date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_admin boolean := public.eh_admin();
  v_dias int := greatest(p_fim - p_inicio + 1, 1);
  v_ant_ini date := p_inicio - v_dias;
  v_ant_fim date := p_inicio - 1;
  v_serie_ini date := p_fim - 29;
  r jsonb;
begin
  if not public.eh_ativo() then raise exception 'acesso negado'; end if;

  with base as (
    select aba, linha, public.dia_carimbo(linha->>0) d
    from backup_linhas
    where removida_em is null
      and aba in ('Registro_Placas_Danificadas','Registro_Placas_Manutencao','Registro_Geral_Streamax','Menutencoes_Streamax','Insumos')
  ),
  -- uma linha por resposta, com as marcações já separadas
  std as (
    select d, array(select trim(x) from unnest(string_to_array(coalesce(linha->>5,''), ',')) x where trim(x) <> '') falhas
    from base where aba = 'Registro_Placas_Danificadas'
  ),
  stdm as (
    select d, array(select trim(x) from unnest(string_to_array(coalesce(linha->>3,''), ',')) x where trim(x) <> '') comps
    from base where aba = 'Registro_Placas_Manutencao'
  ),
  stx as (
    select d,
      array(select trim(x) from unnest(string_to_array(coalesce(linha->>4,''), ',')) x where trim(x) <> '') falhas,
      array(select trim(x) from unnest(string_to_array(coalesce(linha->>7,''), ',')) x where trim(x) <> '' and upper(trim(x)) <> 'NENHUM') comps
    from base where aba = 'Registro_Geral_Streamax'
  ),
  stxm as (select d from base where aba = 'Menutencoes_Streamax'),
  ins as (select d from base where aba = 'Insumos'),
  -- "com problema" = marcou alguma falha diferente de SEM FALHA
  std2 as (select d, falhas, exists (select 1 from unnest(falhas) f where upper(f) <> 'SEM FALHA') prob from std),
  stx2 as (select d, falhas, comps, exists (select 1 from unnest(falhas) f where upper(f) <> 'SEM FALHA') prob from stx),
  cards as (
    select
      jsonb_build_object(
        'triagens',     (select count(*) from std2 where d between p_inicio and p_fim),
        'com_problema', (select count(*) from std2 where prob and d between p_inicio and p_fim),
        'manutencoes',  (select count(*) from stdm where d between p_inicio and p_fim)
      ) std_atual,
      jsonb_build_object(
        'triagens',     (select count(*) from std2 where d between v_ant_ini and v_ant_fim),
        'com_problema', (select count(*) from std2 where prob and d between v_ant_ini and v_ant_fim),
        'manutencoes',  (select count(*) from stdm where d between v_ant_ini and v_ant_fim)
      ) std_ant,
      jsonb_build_object(
        'entradas',     (select count(*) from ins where d between p_inicio and p_fim),
        'triagens',     (select count(*) from stx2 where d between p_inicio and p_fim),
        'com_problema', (select count(*) from stx2 where prob and d between p_inicio and p_fim),
        'manutencoes',  (select count(*) from stx2 where cardinality(comps) > 0 and d between p_inicio and p_fim)
                      + (select count(*) from stxm where d between p_inicio and p_fim)
      ) stx_atual,
      jsonb_build_object(
        'entradas',     (select count(*) from ins where d between v_ant_ini and v_ant_fim),
        'triagens',     (select count(*) from stx2 where d between v_ant_ini and v_ant_fim),
        'com_problema', (select count(*) from stx2 where prob and d between v_ant_ini and v_ant_fim),
        'manutencoes',  (select count(*) from stx2 where cardinality(comps) > 0 and d between v_ant_ini and v_ant_fim)
                      + (select count(*) from stxm where d between v_ant_ini and v_ant_fim)
      ) stx_ant
  ),
  gstd as (select * from public.grupos_opcoes('placas_danificadas', 'falha')),
  gcomp as (select * from public.grupos_opcoes('manutencao_placas', 'componente')),
  fstd as (
    select f, coalesce(g.grupo, 'Outros') grupo
    from std2 cross join lateral unnest(falhas) f left join gstd g on g.opcao = f
    where d between p_inicio and p_fim and upper(f) <> 'SEM FALHA'
  ),
  fstx as (
    select f from stx2 cross join lateral unnest(falhas) f
    where d between p_inicio and p_fim and upper(f) <> 'SEM FALHA'
  ),
  cstd as (
    select c, coalesce(g.grupo, 'Outros') grupo
    from stdm cross join lateral unnest(comps) c left join gcomp g on g.opcao = c
    where d between p_inicio and p_fim
  ),
  dias as (select generate_series(v_serie_ini, p_fim, interval '1 day')::date dia),
  serie as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'dia', dia,
      'std', (select count(*) from std2 where d = dia),
      'stx', (select count(*) from ins where d = dia),
      'prob', (select count(*) from std2 where d = dia and prob) + (select count(*) from stx2 where d = dia and prob)
    ) order by dia), '[]'::jsonb) j from dias
  )
  select jsonb_build_object(
    'admin', v_admin,
    'periodo', jsonb_build_object('inicio', p_inicio, 'fim', p_fim, 'anterior_inicio', v_ant_ini, 'anterior_fim', v_ant_fim),
    'dados_ate', (select max(executado_em) from backup_execucoes),
    'std', c.std_atual,
    'streamax', c.stx_atual,
    'cameras', (select dados - 'reparos_por_dia' || jsonb_build_object(
                  'reparos_periodo', (select coalesce(sum(value::int), 0) from jsonb_each_text(dados->'reparos_por_dia') where key::date between p_inicio and p_fim),
                  'atualizado_em', atualizado_em)
                from painel_externo where chave = 'cameras'),
    'fornecedor', (select dados || jsonb_build_object('atualizado_em', atualizado_em) from painel_externo where chave = 'fornecedores')
  )
  || case when not v_admin then '{}'::jsonb else jsonb_build_object(
    'anterior', jsonb_build_object('std', c.std_ant, 'streamax', c.stx_ant),
    'serie', (select j from serie),
    'std_grupos', (select coalesce(jsonb_object_agg(grupo, n), '{}'::jsonb) from (select grupo, count(*) n from fstd group by grupo) x),
    'std_top', (select coalesce(jsonb_agg(jsonb_build_object('nome', f, 'grupo', grupo, 'n', n) order by n desc, f), '[]'::jsonb)
                from (select f, grupo, count(*) n from fstd group by f, grupo order by n desc, f limit 6) x),
    'stx_top', (select coalesce(jsonb_agg(jsonb_build_object('nome', f, 'n', n) order by n desc, f), '[]'::jsonb)
                from (select f, count(*) n from fstx group by f order by n desc, f limit 6) x),
    'comp_grupos', (select coalesce(jsonb_object_agg(grupo, n), '{}'::jsonb) from (select grupo, count(*) n from cstd group by grupo) x),
    'comp_top', (select coalesce(jsonb_agg(jsonb_build_object('nome', c, 'grupo', grupo, 'n', n) order by n desc, c), '[]'::jsonb)
                 from (select c, grupo, count(*) n from cstd group by c, grupo order by n desc, c limit 6) x)
  ) end
  into r
  from cards c;
  return r;
end $$;

revoke all on function public.painel_resumo(date, date) from public, anon;
grant execute on function public.painel_resumo(date, date) to authenticated;
revoke all on function public.grupos_opcoes(text, text) from public, anon, authenticated;
revoke all on function public.dia_carimbo(text) from public, anon;
grant execute on function public.dia_carimbo(text) to authenticated;
