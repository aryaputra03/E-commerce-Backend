// Script belajar SEMENTARA — hapus setelah selesai Fase 9.
// Cara pakai: node scripts/demo-kafka-consume.js <groupId>
require("dotenv").config();
const kafka = require("../src/config/kafka");

const groupId = process.argv[2] || "group-belajar";

async function main() {
  const consumer = kafka.consumer({ groupId });
  await consumer.connect();
  await consumer.subscribe({ topic: "demo.hello", fromBeginning: true });

  console.log(`Consumer dengan group "${groupId}" siap menerima pesan...`);

  await consumer.run({
    eachMessage: async ({ partition, message }) => {
      console.log(
        `[group=${groupId}] partisi=${partition} key=${message.key?.toString()} value=${message.value.toString()}`,
      );
    },
  });
}

main().catch(console.error);
