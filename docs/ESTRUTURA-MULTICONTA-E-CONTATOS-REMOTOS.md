# Estruturação: Multi-conta + Contatos remotos

Documento para alinhar a arquitetura antes de implementar. Objetivo: permitir **contas** (ex.: escritório de advocacia) que usam o mesmo sistema e as mesmas instâncias WhatsApp, mas com **contatos, tags, listas e disparos isolados**, sem ver o fluxo de devocional. Você (admin) continua vendo tudo.

---

## 0. Visão de ecossistema e MassFlow como SaaS (estratégia)

Você vem criando várias soluções: **MassFlow** (este projeto), **CRM Jurídico**, **CRM Imobiliário**, entre outros. A ideia é que essas ferramentas **conversem entre si** e que o **MassFlow** vire um **SaaS de disparo em massa comercial**, poderoso, construído em cima do que já existe.

### Papel de cada produto

| Produto | Papel no ecossistema |
|---------|----------------------|
| **CRM (Jurídico, Imobiliário, etc.)** | Fonte de contatos. Expõe um **endpoint na API** para **fornecer contatos** (ex.: GET /api/contacts ou /api/lead/export). O cliente usa o CRM no dia a dia; o MassFlow (ou outro consumidor) **consome** esses contatos para campanhas. |
| **MassFlow** | Ferramenta **SaaS de disparo**: o cliente paga pelo uso, traz seus contatos (via **conexão com o CRM** ou **import CSV**), cria suas **tags**, usa **números cedidos por você** e/ou **conecta os próprios números**, configura **webhook** para seu agente, e faz disparos de marketing. **Sem nenhum acesso ao devocional.** |

Assim: no CRM você cria o endpoint para **consumir/exportar contatos**; no MassFlow o cliente **conecta** essa API como “fonte de contatos” da conta dele. As ferramentas conversam via API.

### MassFlow como SaaS – o que o cliente (conta) tem

- **Contatos**
  - **Conectar o CRM**: configurar URL + auth do endpoint de contatos do CRM; sync periódico ou sob demanda → contatos da conta no MassFlow.
  - **Importar CSV**: como hoje; contatos ficam no escopo da conta.
- **Tags e listas**
  - Próprias da conta; criação e uso apenas nos disparos dela.
- **Números (instâncias WhatsApp)**
  - **Opção 1 – Números cedidos por você:** você (admin) define **quais** das suas instâncias ficam **visíveis/disponíveis** para aquela conta. O cliente só **vê e usa** esses números nos disparos; não gerencia conexão/QR, só escolhe na hora do disparo.
  - **Opção 2 – Cliente conecta as próprias instâncias:** a conta pode **adicionar e conectar** instâncias próprias (ex.: Evolution API do escritório). Essas instâncias são **exclusivas da conta** (só ela vê e usa).
  - **Opção 3 – As duas coisas:** parte dos números cedidos por você + parte próprios.
- **Webhook**
  - Permanece como hoje: a conta pode configurar **webhook próprio** (ex.: para agente de IA ou automação). Sem mudança de conceito; apenas escopo por conta se fizer sentido.
- **Devocional**
  - **Totalmente fora** do escopo do cliente: sem menu, sem telas, sem dados. Só você (admin) vê e opera o devocional.
- **Melhorias desejadas**
  - **Logs e relatórios** de disparo de marketing mais claros e úteis.
  - **Configurações e opções de mídia** dos disparos (imagem, áudio, documento, etc.) mais completas.
  - Objetivo: uma ferramenta **poderosa de disparo em massa comercial** a partir do que já existe.

### Resumo da estratégia

1. **CRMs** ganham endpoint de API para **fornecer contatos** (consumo pelo MassFlow ou outros).
2. **MassFlow** vira **SaaS**: multi-conta, contatos por CRM ou CSV, tags/listas/disparos por conta, números cedidos **e/ou** próprios, webhook por conta, **zero** devocional para o cliente.
3. **Você** mantém o devocional no MassFlow, controla quais números ceder a cada conta, e pode cobrar pelo uso (métrica futura: disparos, contatos, etc.).

---

## 1. O que você descreveu (resumo)

| O que | Detalhe |
|-------|--------|
| **Contas** | Ex.: uma conta para um escritório de advocacia. Após login, esse usuário vê só o que é dele. |
| **Isolamento** | Contatos, tags, listas e disparos **por conta**. Não vê contatos/disparos de outras contas nem do devocional. |
| **Admin** | Você continua vendo tudo: devocional + todas as contas e seus dados. |
| **Compartilhado** | Instâncias WhatsApp e blindagem são **compartilhadas**: todas as contas usam os mesmos números para enviar. |
| **Origem dos contatos** | Por conta: import CSV **ou** conexão com lista “remota” (banco ou API externa). |
| **Evolução** | Follow-up e tags conforme os disparos forem se desenvolvendo (tags e histórico por contato, no escopo da conta). |

Pergunta central: **é possível?** Sim. Abaixo é uma proposta de estrutura para discutir.

---

## 2. Conceito: “Conta” (tenant / workspace)

- Uma **conta** = um “tenant” ou workspace: conjunto isolado de contatos, tags, listas e disparos.
- Cada **usuário** pertence a uma conta (ou é admin global).
- **Admin global**: uma conta “especial” (ou `account_id = null`) que enxerga devocional + todas as contas.
- **Usuário de conta**: vê apenas a própria conta; não acessa devocional (nem menu nem dados).

Assim você mantém instâncias e blindagem únicas, mas os dados de marketing/disparos ficam separados por conta.

---

## 3. Onde separar: mesma tabela vs tabela aparte

Duas opções clássicas:

### Opção A – Mesma tabela com `account_id` (recomendada)

- **contacts**, **contact_lists**, **contact_tags**, **dispatches** (e o que mais for “por conta”) ganham coluna **`account_id`** (FK para nova tabela `accounts`).
- Contatos “seus” (devocional / admin): `account_id = null` ou conta padrão “Fabria/Devocional”.
- Contatos do escritório: `account_id = 2`, por exemplo.
- **Vantagens:** um só modelo, um só código de disparo/blindagem; filtro `WHERE account_id = ?` (ou `IS NULL` para admin). Relatórios e follow-up mais simples.
- **Desvantagem:** tabela `contacts` cresce com todos; precisa índice em `account_id` e sempre filtrar por conta.

### Opção B – Tabela separada por conta

- Ex.: `account_contacts`, `account_lists`, etc., ou schema por conta (`account_2.contacts`).
- **Vantagens:** isolamento físico.
- **Desvantagens:** mais tabelas ou schemas, lógica duplicada, disparo/blindagem/mensagens têm que saber de qual tabela ler.

**Recomendação:** **Opção A** (mesma tabela + `account_id`) para contatos, listas, tags e disparos. Instâncias e blindagem continuam globais (sem `account_id`).

---

## 4. Proposta de modelo de dados (resumido)

- **accounts**  
  - `id`, `name`, `slug`, `created_at`, etc.  
  - Ex.: id 1 = “Fabria / Devocional”, id 2 = “Escritório XYZ”.

- **users**  
  - Manter `role`: `admin` | `tenant_user` (ou `account_user`).  
  - Adicionar **`account_id`** (FK para `accounts`).  
  - Admin: `role = 'admin'` e `account_id` null (ou conta “global”).  
  - Usuário da conta: `role = 'tenant_user'` e `account_id = 2`.

- **contacts**  
  - Adicionar **`account_id`** (nullable para compatibilidade com contatos atuais).  
  - Contatos do devocional: `account_id` null ou da conta “Fabria”.  
  - Contatos do escritório: `account_id = 2`.  
  - Índice em `(account_id, phone_number)` para evitar duplicata por conta.

- **contact_tags**  
  - Adicionar **`account_id`**.  
  - Tags globais (ex. “bloqueado”) podem ser `account_id` null e usadas por todas as contas nas regras de blindagem.

- **contact_lists**  
  - Já existe **`created_by`**; passar a considerar **`account_id`** (ou derivar de `created_by`).  
  - Listas sempre vinculadas a uma conta.

- **dispatches**  
  - Adicionar **`account_id`** (ou derivar da lista).  
  - Disparos de devocional: `account_id` null (ou conta devocional).  
  - Disparos do escritório: `account_id = 2`.

- **Instâncias (números WhatsApp)**  
  - **Números “seus” (devocional/admin):** instâncias sem `account_id` (ou `owner_type = 'platform'`). Só admin vê e usa; devocional usa essas.  
  - **Números cedidos à conta:** tabela de permissão, ex. **`account_instances`** (`account_id`, `instance_id`, `granted_by`, `created_at`). Você associa quais instâncias cada conta pode **ver e usar** nos disparos. A conta não gerencia conexão/QR, só escolhe o número no disparo.  
  - **Números próprios da conta:** instâncias com **`account_id`** preenchido = pertencem àquela conta. A conta conecta (Evolution API), vê QR, gerencia; só ela vê e usa.  
  - Assim: uma conta pode ter só cedidos, só próprios, ou os dois. Você define quais cedidos liberar por conta.

- **Blindagem**  
  - Pode ficar **global** (uma configuração que vale para todos os disparos que usam suas instâncias) ou **por instância** (como hoje). Contas que usam números próprios podem ter regras de blindagem próprias (fase posterior se quiser).

Assim: contatos fixos “nossos” e contatos de cada conta ficam na mesma tabela, separados por `account_id`. Instâncias passam a ter “dono”: platform (suas) ou conta (próprias), e cedidas via tabela de permissão.

---

## 5. Lista de contatos “remota” (API ou banco)

Objetivo: uma conta poder usar contatos que vêm de um sistema externo (API ou banco), além de CSV.

- **external_contact_sources** (nova tabela)  
  - `id`, `account_id`, `name`, `type` (`api` | `database`), `config` (JSON: URL, headers, query para API; ou connection string + query para DB), `sync_interval_minutes`, `last_sync_at`, `enabled`.

- **Sincronização**  
  - Job (cron) que, por fonte ativa, chama API ou consulta o banco e **insere/atualiza** em **contacts** com o mesmo `account_id` da fonte.  
  - Opção: coluna **`source`** em `contacts` (ex. `import`, `api`, `database`) e **`external_id`** para mapear com o id no sistema remoto.  
  - Assim você mantém follow-up e tags na sua base: os contatos “remotos” viram linhas em `contacts` com `account_id` e `source` preenchidos.

- **Uso em disparos**  
  - Listas dinâmicas/estáticas usam os mesmos `contacts` filtrados por `account_id`; tanto contatos importados por CSV quanto sincronizados da API/DB entram nos disparos de marketing dessa conta.

**Contrato da API (CRM → MassFlow)**  
- No **CRM** (Jurídico, Imobiliário, etc.): criar um endpoint, ex. `GET /api/integrations/contacts` (ou `/api/export/contacts`), que retorne uma lista de contatos em formato combinado (ex.: `{ "contacts": [ { "phone", "name", "email?", "custom_fields?" } ] }`). Autenticação: API key ou OAuth por “conta/integração” que o cliente configura no MassFlow.  
- No **MassFlow**: a “fonte de contatos” do tipo “API” guarda URL base + headers (API key, etc.). O job de sync chama esse endpoint, normaliza para o formato interno (phone obrigatório, name, etc.) e insere/atualiza em `contacts` com `account_id` e `source = 'api'`. Assim as ferramentas conversam: CRM é a fonte da verdade; MassFlow consome para disparo.

---

## 6. Permissões e o que cada um vê

- **Admin (você)**  
  - Vê todas as contas, todos os contatos, todas as listas, todos os disparos.  
  - Acessa Config. Devocional, disparos de devocional, instâncias, blindagem, logs.  
  - Pode criar/editar contas e usuários de conta.

- **Usuário de conta (ex. escritório)**  
  - Após login: só a **própria conta** (`account_id` do usuário).  
  - Contatos: só `WHERE account_id = ?`. Tags/listas/disparos: só os da conta.  
  - **Não** vê: devocional (nem menu), contatos/listas/disparos de outras contas.  
  - **Instâncias:** vê apenas (1) as que você **cedeu** à conta (via `account_instances`) e (2) as **próprias** da conta (`instance.account_id = conta`). Pode **usar** todas essas nos disparos; nas cedidas não edita conexão/QR, nas próprias pode conectar e gerenciar.  
  - Pode: importar CSV, configurar fonte de contatos (API do CRM ou outro), criar tags/listas, disparos de marketing, webhook da conta.

Assim o gestor/usuário do sistema é “parcial”: só o que é dele, sem devocional.

---

## 7. Fluxo resumido

1. Você cria uma **conta** (ex. “Escritório Advocacia”) e um **usuário** vinculado a essa conta (`role = tenant_user`, `account_id = id da conta`).
2. Esse usuário faz login e vê apenas: Contatos, Tags, Listas, Disparos (e talvez “Fonte de contatos” para configurar API/DB).
3. Contatos: importação CSV (gravados em `contacts` com `account_id` da conta) e/ou sincronização a partir de uma fonte remota (API ou banco), também com `account_id`.
4. Tags e listas são criadas no escopo da conta; disparos de marketing usam essas listas e as **instâncias compartilhadas** (e blindagem).
5. Follow-up e tags conforme os disparos se desenvolvem: continuam em `contacts` + `contact_tag_relations` + `messages`/`dispatch_contacts`, sempre filtrados por `account_id` na API.

---

## 8. O que precisa ser feito (checklist de alto nível)

**Multi-conta e isolamento**
- [ ] Criar tabela **accounts** e migrar/definir conta padrão (devocional).
- [ ] Adicionar **account_id** em **users**, **contacts**, **contact_tags**, **contact_lists**, **dispatches** (e onde fizer sentido).
- [ ] Ajustar **todas as APIs** que leem/escrevem esses recursos para filtrar (ou preencher) por `account_id` conforme o usuário logado (admin vs tenant_user).
- [ ] Frontend: menu e rotas condicionais por role (esconder **totalmente** Devocional para `tenant_user`; instâncias: só as cedidas + próprias da conta).

**Instâncias: cedidas vs próprias**
- [ ] Adicionar **account_id** em **instances** (nullable = suas/plataforma; preenchido = instância própria da conta).
- [ ] Criar tabela **account_instances** (account_id, instance_id) para “números cedidos” por você a cada conta.
- [ ] API de listagem de instâncias: para tenant_user retornar apenas cedidas + próprias; para admin retornar todas. Na criação de instância por conta, preencher `account_id`.

**Contatos remotos (CRM como fonte)**
- [ ] Nos CRMs: criar endpoint de API para **consumir/exportar contatos** (formato combinado entre MassFlow e CRM).
- [ ] Tabela **external_contact_sources** + job de sync para popular **contacts** com `account_id` e `source` (api/database).
- [ ] Tela na conta para configurar “fonte de contatos” (URL + auth da API do CRM, ou DB) e disparar/agendar sync.

**Gestão e experiência**
- [ ] Tela de gestão de contas e usuários por conta (admin); tela para admin “ceder” instâncias a uma conta.
- [ ] Webhook: manter como hoje; se necessário, escopo por conta (cada conta com seu webhook).

**Melhorias de produto (disparo comercial)**
- [ ] Melhorar **logs e relatórios** de disparo de marketing (clareza, filtros, export).
- [ ] Melhorar **configurações e opções de mídia** dos disparos (imagens, áudio, documentos, etc.).
- [ ] (Futuro) Métricas de uso para cobrança (disparos enviados, contatos ativos, etc.).

---

## 9. Conclusão

- **Ecossistema:** CRMs expõem API de contatos; MassFlow consome como fonte e vira SaaS de disparo em massa comercial.
- **É possível** ter contas isoladas (contatos, tags, listas, disparos), com números **cedidos por você** e/ou **próprios da conta**, webhook por conta, e **zero** acesso ao devocional para o cliente.
- **Recomendação:** mesma tabela de contatos (e listas, tags, disparos) com **`account_id`**; instâncias com **account_id** (próprias) + tabela **account_instances** (cedidas); lista remota via **fonte externa (API do CRM ou DB)** que sincroniza para `contacts`.
- **Próximos passos:** (1) fechar desenho (nomes, regras de negócio); (2) quebrar em etapas (accounts + account_id → filtros APIs → frontend por role → instâncias cedidas/próprias → fonte CRM + sync); (3) depois melhorar logs, relatórios e mídia dos disparos.

Se quiser, podemos: (a) ajustar algo nesta estratégia, (b) definir o contrato da API de contatos entre CRM e MassFlow, ou (c) detalhar a primeira etapa de implementação (accounts + account_id + filtros).

---

## 10. Estratégia de repositório e deploy: separar Devocionais do MassFlow

Você perguntou: **abrir um novo projeto no EasyPanel, um novo repositório no GitHub, subir a estrutura nele e separar o atual do novo (MassFlow sem devocional, reestruturado)**. Faz sentido e é uma boa forma de desenhar o refinamento.

### Duas abordagens em resumo

| Abordagem | Descrição | Prós | Contras |
|-----------|-----------|------|---------|
| **A – Um só repo (evoluir o atual)** | MassFlow SaaS + devocional no mesmo código; separação por role e `account_id`. | Um deploy, uma base de código, lógica compartilhada. | Devocional e SaaS misturados para sempre; código carrega “peso” do devocional; risco de vazar referências ao devocional no produto comercial. |
| **B – Dois repos (separar)** | **Repo 1:** Devocionais (atual) – focado no seu uso. **Repo 2:** MassFlow – novo, limpo, só disparo comercial, reestruturado. Novo projeto EasyPanel + novo deploy (e opcionalmente novo DB). | Separação clara de produtos; MassFlow nasce já com `accounts`, instâncias cedidas/próprias, sem nenhum vestígio de devocional; branding e evolução independentes. | Duplicação de código (disparo, Evolution API, blindagem) no início; dois deploys para manter. |

### Recomendação: novo repo + novo EasyPanel (abordagem B)

- **Repositório atual (Devocionais)**  
  - Continua como está: focado em devocional + seu uso interno.  
  - Pode evoluir à parte (novas features do devocional, etc.) sem impactar o produto comercial.

- **Novo repositório (MassFlow)**  
  - Criar no GitHub (ex.: `MassFlow`, `massflow-saas`, ou nome que preferir).  
  - **Origem do código:** copiar/fork do projeto atual e então **remover tudo que é devocional** (rotas, telas, cron de devocional, tabelas/colunas específicas de devocional).  
  - **Reestruturar desde o início:**  
    - Backend: `accounts` e `account_id` em users, contacts, tags, listas, dispatches, instances; tabela `account_instances` para números cedidos.  
    - Frontend: sem nenhuma rota/menu de devocional; login e menu já pensados para “conta” (admin vs tenant).  
  - Assim o MassFlow já nasce “da maneira correta”, sem migração de devocional no mesmo código.

- **Novo projeto no EasyPanel**  
  - Novo app (backend + frontend) apontando para o novo repo.  
  - Banco de dados: **novo** (recomendado) para o MassFlow, para não misturar dados do devocional com dados das contas SaaS. Se um dia quiser compartilhar instâncias entre Devocionais e MassFlow, pode ser via API ou mesmo um DB compartilhado com schemas separados (mais complexo); para começar, DB separado é mais simples.

### Passos práticos sugeridos

1. **GitHub**  
   - Criar novo repositório (ex.: `MassFlow`).  
   - Opção A: clone do repo atual → remover devocional + aplicar reestruturação (accounts, account_id, account_instances) → primeiro commit já “MassFlow limpo”.  
   - Opção B: clone e ir commitando em etapas (primeiro só remoção do devocional, depois accounts, etc.).  

2. **Estrutura do novo repo (sugestão)**  
   - Manter algo como: `backend/` (Node/Express), `frontend/` (React/Vite).  
   - Backend: organizar por domínio (ex.: `routes/accounts`, `routes/contacts`, `routes/instances`, `routes/dispatches`, `services/syncContacts`, etc.); middleware de “conta” (extrair `account_id` do usuário e injetar nas queries).  
   - Frontend: rotas/menus só para Contatos, Tags, Listas, Disparos, Instâncias (cedidas + próprias), Fontes de contatos (CRM/API), Config/Webhook; **nada** de Devocional.  
   - README do novo repo descrevendo “MassFlow – SaaS de disparo em massa”, requisitos, variáveis de ambiente, deploy.

3. **EasyPanel**  
   - Novo projeto (ex.: “MassFlow”).  
   - Serviços: backend (build a partir do novo repo), frontend (idem), PostgreSQL novo (ou uso de DB já existente em outro projeto, se quiser centralizar depois).  
   - Variáveis de ambiente e domínio próprios para o MassFlow.

4. **Duplicação de código**  
   - No início é aceitável: lógica de disparo, Evolution API, blindagem ficam no MassFlow (e continuam no Devocionais).  
   - Se no futuro a duplicação atrapalhar, dá para extrair um **pacote compartilhado** (ex.: `@fabria/dispatch-core` em repo privado ou monorepo) e os dois projetos consumirem; isso pode ser uma fase 2.

### Resumo

- **Sim,** faz sentido abrir **novo projeto no EasyPanel** e **novo repositório no GitHub**, subir a estrutura do MassFlow nele e **separar o atual (Devocionais) do novo (MassFlow sem devocional, reestruturado)**.  
- **Atual:** fica como Devocionais (seu uso). **Novo:** MassFlow limpo, multi-conta, números cedidos/próprios, contatos por CRM ou CSV, sem devocional.  
- Ordem sugerida: criar repo → copiar código atual → remover devocional e aplicar reestruturação (accounts + account_id + account_instances) → configurar EasyPanel com novo projeto e novo DB.
