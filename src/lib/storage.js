// Armazenamento temporário das fotos. Regra: apagar assim que entregar; rede de segurança de 1 dia (lifecycle).
const { BlobServiceClient } = require("@azure/storage-blob");

const CONTAINER = "fotos";
let containerClient;

async function getContainer() {
  if (!containerClient) {
    const svc = BlobServiceClient.fromConnectionString(process.env.AzureWebJobsStorage);
    containerClient = svc.getContainerClient(CONTAINER);
    await containerClient.createIfNotExists(); // privado por padrão
  }
  return containerClient;
}

async function salvar(nome, buffer, contentType) {
  const c = await getContainer();
  await c.getBlockBlobClient(nome).uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: contentType || "application/octet-stream" },
  });
}

async function apagar(nome) {
  const c = await getContainer();
  await c.deleteBlob(nome, { deleteSnapshots: "include" }).catch(() => {});
}

async function existe(nome) {
  const c = await getContainer();
  return c.getBlockBlobClient(nome).exists();
}

async function ler(nome) {
  const c = await getContainer();
  try {
    return await c.getBlockBlobClient(nome).downloadToBuffer();
  } catch {
    return null;
  }
}

// Container "dados": saldo de créditos e pagamentos processados. Sem lifecycle (não expira).
let dadosClient;
async function getDados() {
  if (!dadosClient) {
    const svc = BlobServiceClient.fromConnectionString(process.env.AzureWebJobsStorage);
    dadosClient = svc.getContainerClient("dados");
    await dadosClient.createIfNotExists();
  }
  return dadosClient;
}

// Lê JSON e grava de volta com concorrência otimista (ETag). fn(atual|null) -> novo objeto, ou undefined para não gravar.
async function atualizarJson(nome, fn) {
  const c = await getDados();
  const b = c.getBlockBlobClient(nome);
  for (let i = 0; i < 6; i++) {
    let atual = null;
    let etag = null;
    try {
      const r = await b.download();
      atual = JSON.parse((await streamToBuffer(r.readableStreamBody)).toString());
      etag = r.etag;
    } catch (e) {
      if (e.statusCode !== 404) throw e;
    }
    const novo = fn(atual);
    if (novo === undefined) return atual;
    const body = Buffer.from(JSON.stringify(novo));
    try {
      await b.uploadData(body, {
        blobHTTPHeaders: { blobContentType: "application/json" },
        conditions: etag ? { ifMatch: etag } : { ifNoneMatch: "*" },
      });
      return novo;
    } catch (e) {
      if (e.statusCode === 409 || e.statusCode === 412) continue; // alguém gravou antes: tenta de novo
      throw e;
    }
  }
  throw new Error("atualizarJson: conflito repetido em " + nome);
}

async function lerJson(nome) {
  const c = await getDados();
  try {
    const r = await c.getBlockBlobClient(nome).download();
    return JSON.parse((await streamToBuffer(r.readableStreamBody)).toString());
  } catch (e) {
    if (e.statusCode === 404) return null;
    throw e;
  }
}

async function streamToBuffer(stream) {
  const parts = [];
  for await (const d of stream) parts.push(Buffer.isBuffer(d) ? d : Buffer.from(d));
  return Buffer.concat(parts);
}

module.exports = { salvar, apagar, existe, ler, atualizarJson, lerJson };
