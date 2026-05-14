# Devocional e IA — Guia atual (sem N8N)

Este documento descreve o fluxo **oficial** de devocionais no sistema: geração interna com **Google Gemini**, **jornadas** no banco e disparo pelo **cron** do backend. O fluxo legado em N8N foi descontinuado no repositório; não há dependência de workflow externo para o texto do dia.

## Visão geral

| Etapa | Onde | O quê |
|--------|------|--------|
| Conteúdo | Tabela `devocionais` | Texto, título, data, versículos (JSON), metadata |
| Geração principal | UI **Jornada Bíblica** (`/devocional/criativo`) | `POST /api/devocional/generate` → `DevocionalGenerator` (Gemini) |
| Jornadas | Tabela `devocional_journeys` | Tema, descrição, tom, período, `is_active`; uma jornada ativa por vez |
| Motor global | Tabela `devocional_ai_config` | API Key (ou `GEMINI_API_KEY` no servidor), modelo, `character_limit` |
| Ingestão opcional | `POST /api/devocional/webhook` | Grava/atualiza devocional por data (ver segurança abaixo) |
| Disparo WhatsApp | Cron + `devocional_config` | Horário e lista em **Config. Devocional** |

## Variáveis de ambiente (backend)

| Variável | Uso |
|----------|-----|
| `GEMINI_API_KEY` | Chave Gemini se não houver chave salva no banco |
| `DEVOCIONAL_WEBHOOK_SECRET` | Valor esperado no header `x-webhook-secret` na rota de ingestão HTTP (**obrigatório alterar em produção**; o repositório contém default apenas para desenvolvimento legado) |
| `ADMIN_NOME` ou `ADMIN_NAME` | Nome exibido no rodapé do painel (`GET /api/auth/branding`) |
| `EXTERNAL_WEBHOOK_PROFILE_PICTURE_URL` | Webhook opcional após atualizar foto de perfil da instância (prioridade sobre o nome legado abaixo) |
| `N8N_WEBHOOK_PROFILE_PICTURE_URL` | Mesmo propósito, nome legado mantido por compatibilidade |

## API — rotas relevantes

- `GET /api/devocional/journeys` — listar jornadas (autenticado)
- `POST /api/devocional/journeys` — criar
- `PUT /api/devocional/journeys/:id` — atualizar
- `POST /api/devocional/journeys/:id/activate` — definir jornada ativa
- `DELETE /api/devocional/journeys/:id` — remover
- `GET/PUT /api/devocional/ai-config` — motor global (credencial mascarada no GET)
- `POST /api/devocional/generate` — corpo `{ "date": "YYYY-MM-DD" }`
- `POST /api/devocional/webhook` — ingestão externa (opcional)

## Ingestão HTTP (`POST /api/devocional/webhook`)

- Header **`x-webhook-secret`**: deve ser igual a `DEVOCIONAL_WEBHOOK_SECRET`.
- Corpo JSON: `text`, `title`, `date` (AAAA-MM-DD), opcionalmente `versiculo_principal`, `versiculo_apoio`, `metadata`.
- O backend **sanitiza** `text` e `title` (normalização WhatsApp, limites de tamanho, validação de data) antes de gravar — ver `devocionalWhatsAppText.ts`.

## Primeiro devocional de uma jornada

Quando não existe registro anterior na mesma jornada (intervalo de datas) antes da data gerada, o gerador injeta instruções de **abertura de nova fase** nos prompts.

## Contexto para IA legado

`GET /api/devocional/context/para-ia?days=30` continua disponível para consultas históricas (útil para ferramentas externas); o fluxo principal de criação usa o histórico filtrado pela jornada ativa dentro do `DevocionalGenerator`.

## Documentação relacionada

- `ARQUITETURA_DISPAROS.md` — modelo de dados e tipos de disparo
- `ESPECIFICACAO_DISPAROS.md` — comportamento do disparo devocional
- `DEPLOY.md` — deploy e variáveis no painel
