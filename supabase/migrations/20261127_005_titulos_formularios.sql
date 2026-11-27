-- Nomes dos formulários no app (pedido de Dan, 2026-11-27). Só o app muda; Google Forms seguem iguais.
update formularios f set titulo = v.t from (values
 ('placas_danificadas','Triagem de STD'),
 ('manutencao_placas','Manutenção de STD'),
 ('rst_mini','Manutenção de RST_MINI'),
 ('streamax_geral','Triagem e Manutenção de Streamax'),
 ('insumos','Movimentação de Equipamento para Produção (Streamax)')) as v(s,t)
where f.slug = v.s;
