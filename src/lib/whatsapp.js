// Camada de canal: tudo que fala com o WhatsApp Cloud API fica aqui.
// O núcleo do Postei (porteiro, edição, Pix) não deve importar nada deste arquivo,
// para que o canal possa ser trocado (ex.: Telegram) sem mexer no resto.

const crypto = require("crypto");

const GRAPH_VERSION = "v21.0";

function verifySignature(rawBody, signatureHeader, appSecret) {
  // Meta envia "sha256=<hex>" em X-Hub-Signature-256, calculado com o App Secret.
  if (!signatureHeader || !appSecret) return false;
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Extrai mensagens recebidas do payload da Meta num formato simples e neutro.
function parseIncoming(body) {
  const out = [];
  for (const entry of body?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      for (const m of value.messages ?? []) {
        out.push({
          channel: "whatsapp",
          messageId: m.id,
          from: m.from,
          type: m.type, // text | image | document | interactive ...
          text: m.text?.body ?? null,
          mediaId: m.image?.id ?? m.document?.id ?? null,
          mimeType: m.image?.mime_type ?? m.document?.mime_type ?? null,
          fileName: m.document?.filename ?? null,
          caption: m.image?.caption ?? m.document?.caption ?? null,
          receivedAt: m.timestamp,
        });
      }
    }
  }
  return out;
}

// Extrai atualizações de status de entrega (sent/delivered/read/failed), sem dados pessoais.
function parseStatuses(body) {
  const out = [];
  for (const entry of body?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const st of change.value?.statuses ?? []) {
        out.push({
          id: st.id,
          status: st.status,
          errorCode: st.errors?.[0]?.code ?? null,
          errorTitle: st.errors?.[0]?.title ?? null,
          errorDetails: st.errors?.[0]?.error_data?.details ?? null,
        });
      }
    }
  }
  return out;
}

async function sendText(to, text, { token, phoneNumberId }) {
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text },
      }),
    }
  );
  if (!res.ok) {
    // Não registrar o token; só status e corpo da resposta.
    throw new Error(`sendText falhou: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

module.exports = { verifySignature, parseIncoming, parseStatuses, sendText };
