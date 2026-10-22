CREATE TABLE outbox_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, -- urutan kronologis, dipakai relay baca berurutan
  event_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE, -- kunci idempotency di sisi consumer nanti
  topic text NOT NULL,
  key text NOT NULL,
  payload jsonb NOT NULL,
  headers jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz -- NULL = belum terkirim ke Kafka
);

-- Index parsial: hanya mengindeks baris yang BELUM terkirim — inilah baris yang
-- selalu dicari relay di setiap polling, jadi index ini jauh lebih kecil & cepat
-- dibanding index biasa atas seluruh tabel (yang akan terus membesar selamanya).
CREATE INDEX idx_outbox_unpublished ON outbox_events (id) WHERE published_at IS NULL;

CREATE TABLE processed_events (
  consumer text NOT NULL,
  event_id uuid NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, event_id)
);

ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE processed_events ENABLE ROW LEVEL SECURITY;