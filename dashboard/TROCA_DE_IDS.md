# Dashboard: passar a ler da planilha Central Geral (APP)

No projeto Apps Script do dashboard, arquivo `Code`, bloco `CONFIG`, troque só estes 3 IDs:

| Campo | Antes | Depois |
| --- | --- | --- |
| `ID_PLANILHA` | `1zqpc_Q2D1EybHLWzJvL83M_hJU9WmqZgkR_93v3gZN8` (Central Produção) | `10KYgfQSOTlVXRZ-SGagLe2SxEwQqJZAi8SsARPUvSOI` |
| `ID_PLANILHA_INSUMOS` | `1oBx7p9IitwkEHD6JFpnpsdDwgm2l4sNfqGY73XvMSWs` | `10KYgfQSOTlVXRZ-SGagLe2SxEwQqJZAi8SsARPUvSOI` |
| `ID_PLANILHA_RST_MINI` | `12mansudeO4kq-5Ua9h89U3yg47jelhWugMLFjvjaOG8` | `10KYgfQSOTlVXRZ-SGagLe2SxEwQqJZAi8SsARPUvSOI` |

Fornecedores e Câmeras continuam como estão (não vêm de formulários).

A planilha nova tem as abas com os mesmos nomes que o dashboard procura:
`Registro_Placas_Danificadas`, `Registro_Placas_Manutencao`, `Registro_Geral_Streamax`,
`Menutencoes_Streamax`, `Insumos` e `RST_Mini` (o nome `RST_Mini` já está na lista `ABAS_RST_MINI`).

Depois de salvar: **Implantar > Gerenciar implantações > editar > Nova versão > Implantar**.

Para voltar atrás, basta colocar os IDs antigos de novo e publicar outra versão.
