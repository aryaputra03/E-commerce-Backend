// Dipakai oleh semua consumer Kafka kita. Untuk tiap pesan ada TIGA kemungkinan saat gagal:
//
//  1. Error SEMENTARA yang ditandai handler dengan err.transient = true (mis. Elasticsearch mati).
//     Pesannya benar, yang bermasalah dependency-nya -> TUNGGU dan coba lagi tanpa batas, jangan
//     dibuang ke DLQ. Sambil menunggu kita memanggil heartbeat() supaya Kafka tidak mengira
//     consumer ini mati lalu melakukan rebalance. (BARU di Fase 11)
//  2. Pesan RUSAK (bukan JSON valid, atau err.poison = true) -> langsung ke <topic>.dlq.
//  3. Error lain -> retry sampai maxAttempts dengan backoff, lalu ke <topic>.dlq.
//
// Setelah masuk DLQ, kita LANJUT ke pesan berikutnya supaya 1 pesan beracun tidak memblokir partisi.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function runWithDlq({
  consumer,
  producer,
  handle,
  maxAttempts = 3,
  shouldStop = () => false,
}) {
  return consumer.run({
    eachMessage: async ({ topic, partition, message, heartbeat }) => {
      const raw = message.value ? message.value.toString() : "";
      let attempt = 0; // hanya menghitung error NON-transient
      let transientWaits = 0;

      for (;;) {
        try {
          await handle(JSON.parse(raw), message.headers);
          return; // sukses -> lanjut ke pesan berikutnya secara normal
        } catch (err) {
          if (err.transient) {
            // Sedang shutdown? Lepas pesan ini tanpa DLQ: offset belum di-commit, jadi pesan
            // akan diproses lagi oleh consumer berikutnya.
            if (shouldStop()) throw err;
            transientWaits++;
            await sleep(Math.min(500 * 2 ** transientWaits, 10000)); // 1s, 2s, 4s, ... maks 10s
            await heartbeat(); // lempar error bila group sedang rebalance -> biarkan naik ke kafkajs
            continue;
          }

          attempt++;
          const poison = err instanceof SyntaxError || err.poison; // JSON.parse gagal = pesan rusak

          if (poison || attempt >= maxAttempts) {
            await producer.send({
              topic: `${topic}.dlq`,
              messages: [
                {
                  key: message.key,
                  value: raw,
                  headers: {
                    error: String(err.message).slice(0, 200),
                    attempts: String(attempt),
                    origin: `${topic}/${partition}/${message.offset}`,
                  },
                },
              ],
            });
            return;
          }

          await sleep(200 * 2 ** attempt); // backoff: 400ms, 800ms, ...
        }
      }
    },
  });
}

module.exports = runWithDlq;
