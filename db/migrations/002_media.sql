-- Imagens enviadas pelo painel (ex.: fundo do site). Ficam no banco para sobreviver a deploys com disco efêmero.
CREATE TABLE media (
  id           bigserial PRIMARY KEY,
  content_type text  NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  data         bytea NOT NULL CHECK (octet_length(data) <= 5242880),
  created_at   timestamptz NOT NULL DEFAULT now()
);
