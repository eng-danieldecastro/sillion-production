# Central de Produção - Sillion

Aplicativo Android para os operadores da produção responderem os formulários, um painel web
de gestão (Vercel) e a integração com a planilha **Central Geral (APP)**, que alimenta o dashboard.

```
celular (APK) ──► Supabase (banco, login, backup) ──► Apps Script ──► planilha Central Geral (APP) ──► dashboard
                         ▲                                  ▲
painel web (Vercel) ─────┘        Google Forms atuais ──────┘ (continuam ativos, copiados na hora)
```

| Pasta | O que é |
| --- | --- |
| `mobile/` | App Android (Vite + Capacitor). Login salvo no aparelho, fila sem internet, 5 formulários. |
| `web/` | Painel de gestão (Next.js na Vercel): usuários, respostas, opções dos formulários, sincronização, simulação. Cron diário. |
| `supabase/` | Esquema do banco e funções do servidor (`admin-usuarios`, `planilha`). |
| `apps-script/` | Script colado na planilha Central Geral (APP): grava as respostas do app, copia os Google Forms e faz o backup diário. |
| `dashboard/` | Como apontar o dashboard para a planilha nova. |

## Formulários

| Formulário | Aba na planilha |
| --- | --- |
| Registro de placas danificadas | `Registro_Placas_Danificadas` |
| Registro de manutenção de placas | `Registro_Placas_Manutencao` |
| Registro de equipamentos Streamax (Geral) | `Registro_Geral_Streamax` |
| Manutenção RST_Mini | `RST_Mini` |
| Entrada de equipamentos Produção (Streamax) | `Insumos` |

Cada resposta do app vira uma linha com as mesmas colunas e o mesmo formato do Google Forms
(data/hora real, e-mail do operador, opções múltiplas separadas por vírgula).

## Login

- Cada pessoa tem **usuário e senha** próprios, criados no painel web (aba Usuários).
- A senha inicial é provisória: no primeiro acesso o app pede para criar uma senha nova.
- O login fica salvo no celular até: sair pelo menu, desinstalar o app, ou o administrador
  gerar uma senha nova / bloquear a pessoa (o app volta para a tela de login).
- O e-mail Sillion de cada operador vai na coluna "Endereço de e-mail" (o dashboard usa para mostrar o nome).

## APK

Cada envio para `main` que mexe em `mobile/` gera um APK assinado pelo GitHub Actions
(aba **Actions** e **Releases** do repositório). Instalação: baixar o `.apk` no celular,
permitir "instalar apps desconhecidos" para o navegador/gerenciador de arquivos e abrir o arquivo.
Atualizações instalam por cima porque a assinatura é sempre a mesma. A chave de assinatura
**não fica no repositório**: o GitHub Actions lê dos segredos `ANDROID_KEYSTORE_BASE64` e
`ANDROID_KEYSTORE_SENHA` (Settings > Secrets and variables > Actions). Guarde uma cópia da chave:
sem ela, uma versão nova não instala por cima da antiga.

## Backup no Supabase (plano gratuito)

O backup guarda cada linha da planilha **uma única vez**, identificada por um hash (SHA-256).
Nas execuções seguintes só entram linhas novas ou editadas; o que some da planilha é só marcado
(`removida_em`). Com ~6 mil linhas hoje, o backup ocupa poucos MB dos 500 MB do plano gratuito.

## Manter o Supabase ativo

Projetos gratuitos do Supabase pausam após 7 dias sem uso. O script da planilha chama o Supabase
a cada 5 minutos e o cron da Vercel (`web/vercel.json`) chama 1 vez por dia, então ele não pausa.
A Vercel não "dorme": as funções rodam sob demanda.

## Variáveis de ambiente na Vercel (projeto `web/`)

| Nome | Para quê |
| --- | --- |
| `TOKEN_INTEGRACAO_CRON` | token do cron diário (entregue à parte) |
| `CRON_SECRET` | opcional: a Vercel envia no cabeçalho do cron |
