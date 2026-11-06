# Agenda Barbearia / Consultório — contexto do projeto

Sistema de agendamento (site público + painel admin + API REST, PWA). Idioma da interface e das mensagens: **português (pt-BR)**. O usuário fala português.

## Stack
Node 22 + Express 5 + TypeScript (executado com `tsx`), PostgreSQL 16 (`pg`), Luxon (fuso), Zod (validação), JWT + bcryptjs. Front-end sem framework: HTML + JS ES modules em `web/` (DOM seguro via `h()` em `web/shared/dom.js`, nunca `innerHTML`). Testes: Vitest + Supertest.

## Comandos
- `docker compose up -d` (Postgres) · `cp .env.example .env`
- `npm run migrate && npm run seed` · `npm start` (porta 3000, admin em `/admin`)
- `npm test` (usa o banco `agenda_test`, recria o schema; `TEST_DATABASE_URL` opcional) · `npm run typecheck`
- Login seed: `admin@barbearia.local` / `admin123`

## Regras de negócio (NÃO quebrar; todas têm teste)
1. **Sem horários duplicados**: constraint `EXCLUDE USING gist` em `appointments` (só `status='booked'`) + transação em `src/domain/booking.ts`. Conflito => HTTP 409 `SLOT_TAKEN` com sugestões. `Idempotency-Key` evita duplo clique.
2. **Domingo fechado** (`business.closed_weekdays`, ISO 7) e **almoço 11:00–13:00 bloqueado** (`business.lunch_start/end`). Vale em 4 camadas: geração de slots (`availability.ts`), validação da API (422), trigger `appointments_guard` no banco, e UI. Serviço que *invade* o almoço também é recusado. **Admin também não pode burlar** (só a antecedência mínima é ignorada para admin).
3. **Fuso horário**: tudo `timestamptz` em UTC; regras calculadas no fuso IANA do estabelecimento (`business.timezone`, padrão America/Sao_Paulo) com Luxon (trata horário de verão); cliente vê no fuso dele (`tz` na query).
4. Lógica pura e testável em `src/domain/availability.ts`; mantenha `generateSlots` e `checkSlotRules` consistentes entre si.

## Estrutura
- `db/migrations/*.sql` (aplicadas por `src/scripts/migrate.ts`), `src/scripts/seed.ts`
- `src/domain/` (timezone, availability, booking, errors), `src/routes/` (public, auth, admin — API em `/api/v1`), `src/middleware/`
- `web/public/` site do cliente · `web/admin/` painel · `web/shared/` utilitários, CSS base, ícone
- `tests/` (availability unitário; booking integração incl. 20 requisições simultâneas; media/upload)
- `src/routes/media.ts`: upload de imagem (admin, `POST /api/v1/admin/media`, JPG/PNG/WebP até 5 MB, guardado no banco, migration 002) e leitura pública `GET /media/:id`. Ainda sem botão no painel (decisão do usuário).

## Estado atual (v1 concluída)
Pronto (26 testes de regra + 5 de upload = 31): agendamento público, painel (dashboard, agenda por profissional, clientes, serviços, profissionais, feriados/folgas, configurações e tema), PWA, 
Pendências conhecidas:
- Hero usa `web/public/img/cabelo.jpg` (`theme.heroImage = /img/cabelo.jpg`), foto vertical exibida num painel à direita (CSS em `site.css`, `.hero::before`). Foto horizontal ≥1600px ficaria melhor. Campo de URL em Configurações continua sendo a forma de trocar.
- Fora do escopo v1: financeiro, estoque, comissões, relatórios, lembretes por WhatsApp/e-mail.
- Almoço é global do estabelecimento, não por profissional.

## Roadmap acordado
- **App de celular** (admin e clientes): API-first já pronta. Próximo: empacotar com Capacitor (ou React Native/Expo) consumindo `/api/v1`; login de cliente (`customers.user_id` já reservado) e push de lembrete.
- Publicar: GitHub + Railway/Render com PostgreSQL gerenciado; trocar `JWT_SECRET` e a senha do admin.

## Convenções
- Nova mudança de banco = nova migration numerada (`002_...sql`), nunca editar a `001`.
- Erros de domínio via `AppError(status, code, mensagem pt-BR)`.
- Toda regra nova de horário precisa de teste em `tests/`.
- Express 5: rotas não aceitam regex no parâmetro (`/:id(\d+)` quebra); valide o id no handler.
