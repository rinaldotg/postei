// Converte HEIC/HEIF (formato padrão do iPhone) para JPEG, pois o editor de imagem só aceita JPG, PNG e WebP.
// A conversão roda em processo filho com limite de tempo: se travar ou quebrar, a Function não cai.
const { spawn } = require("child_process");
const path = require("path");
const MARCAS = ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"];

function ehHeic(buf) {
  return buf.length > 12 && buf.toString("latin1", 4, 8) === "ftyp" && MARCAS.includes(buf.toString("latin1", 8, 12));
}

function converterEmProcesso(buf) {
  return new Promise((resolve, reject) => {
    const filho = spawn(process.execPath, ["--max-old-space-size=1024", path.join(__dirname, "heic-worker.js")], { stdio: ["pipe", "pipe", "pipe"] });
    const saida = [];
    let erro = "";
    const timer = setTimeout(() => { filho.kill("SIGKILL"); reject(new Error("heic: tempo esgotado")); }, 90000);
    filho.stdout.on("data", (d) => saida.push(d));
    filho.stderr.on("data", (d) => { if (erro.length < 500) erro += d; });
    filho.on("error", (e) => { clearTimeout(timer); reject(e); });
    filho.on("close", (codigo) => {
      clearTimeout(timer);
      if (codigo === 0 && saida.length) resolve(Buffer.concat(saida));
      else reject(new Error(`heic: processo terminou com codigo ${codigo} ${erro}`.slice(0, 400)));
    });
    filho.stdin.on("error", () => {});
    filho.stdin.end(buf);
  });
}

// Devolve { buffer, mime }. Se não for HEIC, devolve a foto como veio.
async function normalizar(buf, mime) {
  if (!ehHeic(buf)) return { buffer: buf, mime };
  return { buffer: await converterEmProcesso(buf), mime: "image/jpeg" };
}

module.exports = { ehHeic, normalizar };
