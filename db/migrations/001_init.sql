CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Estabelecimento (linha única). Regras rígidas de funcionamento ficam aqui.
CREATE TABLE business (
  id               int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  name             text NOT NULL DEFAULT 'Barbearia Studio',
  timezone         text NOT NULL DEFAULT 'America/Sao_Paulo',
  slot_step_min    int  NOT NULL DEFAULT 30 CHECK (slot_step_min BETWEEN 5 AND 240),
  min_notice_min   int  NOT NULL DEFAULT 60  CHECK (min_notice_min >= 0),
  max_days_ahead   int  NOT NULL DEFAULT 60  CHECK (max_days_ahead BETWEEN 1 AND 365),
  lunch_start      time NOT NULL DEFAULT '11:00',
  lunch_end        time NOT NULL DEFAULT '13:00',
  closed_weekdays  int[] NOT NULL DEFAULT '{7}',          -- ISO: 1=segunda ... 7=domingo
  theme            jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (lunch_end > lunch_start)
);
INSERT INTO business (id) VALUES (1);

CREATE TABLE users (
  id            serial PRIMARY KEY,
  email         text NOT NULL UNIQUE,
  name          text NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL DEFAULT 'admin' CHECK (role IN ('admin','professional','customer')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE professionals (
  id         serial PRIMARY KEY,
  name       text NOT NULL,
  color      text NOT NULL DEFAULT '#f5a623',
  avatar_url text,
  active     boolean NOT NULL DEFAULT true
);

CREATE TABLE services (
  id           serial PRIMARY KEY,
  name         text NOT NULL,
  description  text,
  duration_min int  NOT NULL CHECK (duration_min BETWEEN 5 AND 480),
  price_cents  int  NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  active       boolean NOT NULL DEFAULT true
);

CREATE TABLE professional_services (
  professional_id int NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  service_id      int NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (professional_id, service_id)
);

-- Expediente semanal por profissional. Sem linha para o dia = não trabalha.
CREATE TABLE working_hours (
  professional_id int  NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  weekday         int  NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_time      time NOT NULL,
  end_time        time NOT NULL,
  PRIMARY KEY (professional_id, weekday),
  CHECK (end_time > start_time)
);

-- Feriados / folgas / férias. professional_id NULL = estabelecimento inteiro.
CREATE TABLE time_off (
  id              serial PRIMARY KEY,
  professional_id int REFERENCES professionals(id) ON DELETE CASCADE,
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,
  reason          text,
  CHECK (ends_at > starts_at)
);

CREATE TABLE customers (
  id         serial PRIMARY KEY,
  name       text NOT NULL,
  phone      text NOT NULL UNIQUE,               -- apenas dígitos
  email      text,
  user_id    int REFERENCES users(id),           -- reservado para o app de clientes (fase 2)
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE appointments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id int  NOT NULL REFERENCES professionals(id),
  customer_id     int  NOT NULL REFERENCES customers(id),
  service_id      int  NOT NULL REFERENCES services(id),
  starts_at       timestamptz NOT NULL,          -- sempre UTC no armazenamento
  ends_at         timestamptz NOT NULL,
  status          text NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','cancelled','done','no_show')),
  notes           text,
  idempotency_key text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  time_range      tstzrange GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED,
  CHECK (ends_at > starts_at),
  -- ANTI-DUPLICIDADE: o banco recusa dois agendamentos ativos sobrepostos para o mesmo profissional,
  -- mesmo com requisições concorrentes.
  CONSTRAINT appointments_no_overlap
    EXCLUDE USING gist (professional_id WITH =, time_range WITH &&) WHERE (status = 'booked')
);
CREATE UNIQUE INDEX appointments_idempotency_key_uq ON appointments (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX appointments_starts_idx ON appointments (starts_at);

-- DEFESA EM PROFUNDIDADE: mesmo acessando o banco diretamente, não é possível gravar agendamento
-- em dia fechado (domingo), no horário de almoço, fora do expediente ou em folga/feriado.
CREATE OR REPLACE FUNCTION appointments_guard() RETURNS trigger AS $$
DECLARE
  b  business%ROWTYPE;
  s  timestamp;
  e  timestamp;
BEGIN
  IF NEW.status <> 'booked' THEN RETURN NEW; END IF;
  SELECT * INTO b FROM business WHERE id = 1;
  s := NEW.starts_at AT TIME ZONE b.timezone;
  e := NEW.ends_at   AT TIME ZONE b.timezone;

  IF s::date <> e::date THEN
    RAISE EXCEPTION 'Agendamento não pode atravessar a meia-noite' USING ERRCODE = 'AG003';
  END IF;
  IF extract(isodow FROM s)::int = ANY (b.closed_weekdays) THEN
    RAISE EXCEPTION 'Estabelecimento fechado neste dia da semana' USING ERRCODE = 'AG001';
  END IF;
  IF s::time < b.lunch_end AND e::time > b.lunch_start THEN
    RAISE EXCEPTION 'Horário de almoço (% - %) indisponível', b.lunch_start, b.lunch_end USING ERRCODE = 'AG002';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM working_hours w
     WHERE w.professional_id = NEW.professional_id
       AND w.weekday = extract(isodow FROM s)::int
       AND s::time >= w.start_time AND e::time <= w.end_time
  ) THEN
    RAISE EXCEPTION 'Fora do expediente do profissional' USING ERRCODE = 'AG003';
  END IF;
  IF EXISTS (
    SELECT 1 FROM time_off t
     WHERE (t.professional_id IS NULL OR t.professional_id = NEW.professional_id)
       AND tstzrange(t.starts_at, t.ends_at, '[)') && tstzrange(NEW.starts_at, NEW.ends_at, '[)')
  ) THEN
    RAISE EXCEPTION 'Profissional/estabelecimento indisponível (folga ou feriado)' USING ERRCODE = 'AG004';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER appointments_guard_trg
  BEFORE INSERT OR UPDATE OF starts_at, ends_at, status, professional_id ON appointments
  FOR EACH ROW EXECUTE FUNCTION appointments_guard();
