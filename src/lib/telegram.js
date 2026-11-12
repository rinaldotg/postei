// Adaptador Telegram: mesma lógica de entrada/saída do WhatsApp, outro canal.
const crypto = require("crypto");

function verifySecret(headerValue, secret) {
  if (!secret || !headerValue) return false;
  const a = Buffer.from(headerValue);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Normaliza um update do Telegram para {chatId, messageId, type}
// type: "document" (qualidade original), "image" (comprimida), "text"
function parseUpdate(update) {
  const m = update?.message;
  if (!m) return null;
  let type = "text";
  if (m.document && (m.document.mime_type || "").startsWith("image/")) type = "document";
  else if (m.photo) type = "image";
  const fileId = type === "document" ? m.document.file_id : null;
  const mime = type === "document" ? m.document.mime_type : null;
  const size = type === "document" ? m.document.file_size : null;
  const caption = m.caption || "";
  const text = m.text || "";
  return { chatId: m.chat.id, messageId: m.message_id, type, fileId, mime, size, caption, text };
}

async function sendText(chatId, text, token) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });
  if (!res.ok) throw new Error(`telegram sendText falhou: ${res.status} ${await res.text()}`);
  return res.json();
}

// Baixa um arquivo do Telegram (limite do Telegram: 20 MB) e devolve um Buffer
async function downloadFile(fileId, token) {
  const r = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`);
  const j = await r.json();
  if (!j.ok) throw new Error(`telegram getFile falhou: ${j.description}`);
  const f = await fetch(`https://api.telegram.org/file/bot${token}/${j.result.file_path}`);
  if (!f.ok) throw new Error(`telegram download falhou: ${f.status}`);
  return Buffer.from(await f.arrayBuffer());
}

// Envia como ARQUIVO (sem compressão do Telegram)
async function sendDocument(chatId, buffer, filename, caption, token) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) form.append("caption", caption);
  form.append("document", new Blob([buffer], { type: "image/png" }), filename);
  const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`telegram sendDocument falhou: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

module.exports = { verifySecret, parseUpdate, sendText, downloadFile, sendDocument };
