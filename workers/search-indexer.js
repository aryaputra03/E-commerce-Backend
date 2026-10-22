// Consumer product.events -> indeks Elasticsearch. Boleh dijalankan lebih dari satu instance:
// consumer group "search-indexer" membagi partisi, dan versi eksternal membuat urutan antar
// instance tidak berbahaya.
require("dotenv").config();
const kafka = require("../src/config/kafka");
const es = require("../src/config/elasticsearch");
const runWithDlq = require("../src/kafka/runWithDlq");
const {
  ensureIndex,
  applyProductEvent,
} = require("../src/services/search.service");

let stopping = false;

// env = envelope dari outbox-relay: { eventId, type, version, occurredAt, requestId, payload }
async function handle(env) {
  const result = await applyProductEvent(es, env.payload);
  console.log(
    `${new Date().toISOString()} [${env.requestId || "-"}] product.events ${env.payload.type} ${env.payload.product.id} -> ${result}`,
  );
}

async function main() {
  const consumer = kafka.consumer({ groupId: "search-indexer" });
  const dlqProducer = kafka.producer();

  await consumer.connect();
  await dlqProducer.connect();

  // Worker boleh menyala duluan sebelum Elasticsearch siap: kalau gagal, applyProductEvent akan
  // mencoba membuat indeks lagi saat event pertama datang.
  try {
    await ensureIndex(es);
  } catch (err) {
    console.warn(
      "[search-indexer] Elasticsearch belum siap, indeks dibuat nanti:",
      err.message,
    );
  }

  // fromBeginning: true -> group BARU membaca semua event lama. Aman: versi eksternal membuang duplikat.
  await consumer.subscribe({ topic: "product.events", fromBeginning: true });
  console.log(
    "[search-indexer] Worker siap, mendengarkan topic product.events...",
  );

  await runWithDlq({
    consumer,
    producer: dlqProducer,
    handle,
    shouldStop: () => stopping,
  });

  const shutdown = async () => {
    stopping = true;
    console.log("[search-indexer] Shutdown...");
    await consumer.disconnect();
    await dlqProducer.disconnect();
    await es.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[search-indexer] Gagal start:", err.message);
  process.exit(1);
});
