// Processo filho: lê um HEIC do stdin e escreve o JPEG no stdout. Roda isolado para que uma falha
// da biblioteca de conversão não derrube a Function inteira.
const chunks = [];
process.stdin.on("data", (d) => chunks.push(d));
process.stdin.on("end", async () => {
  try {
    const convert = require("heic-convert");
    const out = await convert({ buffer: Buffer.concat(chunks), format: "JPEG", quality: 0.95 });
    process.stdout.write(Buffer.from(out), () => process.exit(0));
  } catch (e) {
    process.stderr.write(String((e && e.stack) || e).slice(0, 500), () => process.exit(1));
  }
});
