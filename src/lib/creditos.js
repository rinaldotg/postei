// Saldo de créditos por chat (1 crédito = 1 foto editada) e pacotes à venda.
const { atualizarJson, lerJson } = require("./storage");

// PACOTES (env, JSON) ex.: [{"id":"p5","fotos":5,"preco":5},{"id":"p15","fotos":15,"preco":12}]
function pacotes() {
  try {
    const p = JSON.parse(process.env.PACOTES || "");
    if (Array.isArray(p) && p.length) return p;
  } catch {}
  return [
    { id: "p5", fotos: 5, preco: 5 },
    { id: "p15", fotos: 15, preco: 12 },
  ];
}

const arq = (chatId) => `cred/${chatId}.json`;

async function saldo(chatId) {
  const d = await lerJson(arq(chatId));
  return d?.saldo || 0;
}

async function somar(chatId, n) {
  const d = await atualizarJson(arq(chatId), (a) => ({ saldo: (a?.saldo || 0) + n }));
  return d.saldo;
}

// Gasta 1 crédito se houver. Retorna true/false.
async function gastar(chatId) {
  let ok = false;
  await atualizarJson(arq(chatId), (a) => {
    if ((a?.saldo || 0) < 1) { ok = false; return undefined; }
    ok = true;
    return { saldo: a.saldo - 1 };
  });
  return ok;
}

module.exports = { pacotes, saldo, somar, gastar };
