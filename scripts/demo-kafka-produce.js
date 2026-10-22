// Script belajar SEMENTARA — hapus file ini (dan demo-kafka-consume.js) setelah selesai Fase 9.
require("dotenv").config();
const kafka = require("../src/config/kafka");

async function main() {
  const producer = kafka.producer();
  await producer.connect();

  const keys = ["user-a", "user-b", "user-c"];

  for (let i = 0; i < 20; i++) {
    const key = keys[i % keys.length];
    await producer.send({
      topic: "demo.hello",
      messages: [{ key, value: `pesan ke-${i} dari key ${key}` }],
    });
    console.log(`Terkirim: key=${key}, pesan ke-${i}`);
  }

  await producer.disconnect();
}

main().catch(console.error);
