# Agenda Barbearia / Consultório

Sistema de agendamento com site público, painel administrativo e API REST (PWA instalável no celular).

## Rodar
```bash
docker compose up -d          # ou use um PostgreSQL 16 local (precisa da extensão btree_gist)
cp .env.example .env
npm install
npm run migrate && npm run seed
npm start                     # http://localhost:3000   |   admin: http://localhost:3000/admin
```
Login inicial: `admin@barbearia.local` / `admin123` (troque em `.env` antes de publicar).

## Testes
```bash
npm test        # cria o schema em agenda_test (TEST_DATABASE_URL opcional)
npm run typecheck
```

## Regras garantidas
| Regra | Onde é garantida |
|---|---|
| Dois clientes não ocupam o mesmo horário | `EXCLUDE USING gist` em `appointments` + transação (`409 SLOT_TAKEN`) |
| Domingo fechado | `business.closed_weekdays` · disponibilidade · API (422) · trigger no banco |
| Almoço 11:00–13:00 bloqueado (inclui serviços que "invadem" o almoço) | `business.lunch_*` · idem |
| Fuso horário | Tudo em `timestamptz` (UTC); regras no fuso IANA do estabelecimento (Luxon, trata horário de verão); o cliente vê no fuso dele |
| Duplo clique / reenvio | cabeçalho `Idempotency-Key` |

Admin também não consegue agendar domingo/almoço. Horários, almoço, dias fechados, fuso, cores e textos do site são configuráveis em **Configurações**.

## API (`/api/v1`)
Pública: `GET /public/business|services|professionals`, `GET /public/availability?serviceId&professionalId&date&tz`, `GET /public/availability/days?serviceId&month`, `POST /public/appointments`.
Admin (Bearer JWT via `POST /auth/login`): `/admin/dashboard|appointments|services|professionals|customers|time-off|business`.

## App de celular
A API é a mesma para web e app. Hoje o front já é PWA (manifest + service worker). Próximo passo: empacotar com Capacitor ou criar app React Native consumindo `/api/v1`; clientes com login/push (`customers.user_id` já reservado).

## Personalização
Imagem de fundo do site: Configurações → "Imagem de fundo (URL)", ou coloque arquivos em `web/public/` e use `/arquivo.jpg`.
