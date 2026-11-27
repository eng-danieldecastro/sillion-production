-- Coluna nova "CAUSA IDENTIFICADA" (J) na aba Registro_Placas_Danificadas (pedido de Dan, 2026-11-27).
-- OBSERVAÇÃO DO TÉCNICO é a observação do técnico externo e não muda.
update formularios set colunas_planilha = colunas_planilha || '[{"origem":"causa","titulo":"CAUSA IDENTIFICADA"}]'::jsonb
where slug='placas_danificadas' and not colunas_planilha @> '[{"origem":"causa"}]'::jsonb;
