// Dipakai oleh semua consumer Kafka kita. Untuk tiap pesan: coba proses (handle), kalau gagal
// karena error SEMENTARA (koneksi DB putus sesaat, dll) -> retry dengan jeda yang makin lama.
// Kalau pesannya memang RUSAK (bukan JSON valid) atau sudah mencoba maxAttempts kali -> kirim
// ke topic <topic>.dlq, lalu LANJUT ke pesan berikutnya (jangan sampai 1 pesan beracun
// memblokir seluruh partisi selamanya).
function runWithDlq({ consumer, producer, handle, maxAttempts = 3 }) {
  return consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      const raw = message.value ? message.value.toString() : "";

      for (let attempt = 1; ; attempt++) {
        try {
          await handle(JSON.parse(raw), message.headers);
          return; // sukses -> selesai, lanjut ke pesan berikutnya secara normal
        } catch (err) {
          const poison = err instanceof SyntaxError || err.poison; // JSON.parse gagal = pesan rusak, retry percuma

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
            return; // sudah dikirim ke DLQ -> lanjut ke pesan berikutnya, partisi tidak macet
          }

          await new Promise((r) => setTimeout(r, 200 * 2 ** attempt)); // backoff: 400ms, 800ms, ...
        }
      }
    },
  });
}

module.exports = runWithDlq;
