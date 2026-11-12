// Mercado Pago — Checkout Pro: o cliente abre um link e escolhe Pix ou cartão na página do Mercado Pago
// (nenhum dado de cartão passa pelo nosso código). Variáveis: MP_ACCESS_TOKEN (segredo), MP_WEBHOOK_SECRET (texto aleatório),
// PUBLIC_URL (opcional).
const API = "https://api.mercadopago.com";
const PUBLIC_URL = () => process.env.PUBLIC_URL || "https://postei-webhook-ffbghrcygxbbepc4.westus3-01.azurewebsites.net";

async function mp(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN || process.env.MP_ACESS_TOKEN}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`mercadopago ${path} ${res.status}: ${txt.slice(0, 300)}`);
  return JSON.parse(txt);
}

// Cria um link de pagamento para um pacote. external_reference = "chatId:pacoteId".
async function criarLink(chatId, pacote) {
  const pref = await mp("/checkout/preferences", {
    method: "POST",
    body: JSON.stringify({
      items: [{ id: pacote.id, title: `Postei - ${pacote.fotos} fotos melhoradas`, quantity: 1, unit_price: pacote.preco, currency_id: "BRL" }],
      external_reference: `${chatId}:${pacote.id}`,
      notification_url: `${PUBLIC_URL()}/api/mercadopago?s=${encodeURIComponent(process.env.MP_WEBHOOK_SECRET || "")}`,
      payment_methods: { excluded_payment_types: [{ id: "ticket" }], installments: 1 }, // sem boleto: só Pix e cartão
      back_urls: { success: "https://t.me/postei_fotos_bot", pending: "https://t.me/postei_fotos_bot", failure: "https://t.me/postei_fotos_bot" },
      auto_return: "approved",
    }),
  });
  return pref.init_point;
}

async function buscarPagamento(id) {
  return mp(`/v1/payments/${encodeURIComponent(id)}`);
}

module.exports = { criarLink, buscarPagamento };
