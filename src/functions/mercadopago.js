const { app } = require("@azure/functions");
const crypto = require("crypto");
const { buscarPagamento } = require("../lib/mercadopago");
const { pacotes, somar } = require("../lib/creditos");
const { atualizarJson, lerJson, ler, apagar, salvar } = require("../lib/storage");
const { sendText } = require("../lib/telegram");
const { processarFoto } = require("../lib/fluxo");

// Webhook do Mercado Pago. Não confiamos no corpo da chamada: só usamos o id do pagamento e consultamos a API do Mercado Pago.
// Segurança extra: a URL de notificação carrega ?s=MP_WEBHOOK_SECRET.
app.http("mercadopago", {
  methods: ["POST", "GET"],
  authLevel: "anonymous",
  route: "mercadopago",
  handler: async (request, context) => {
    const esperado = process.env.MP_WEBHOOK_SECRET || "";
    const recebido = request.query.get("s") || "";
    const a = Buffer.from(recebido), b = Buffer.from(esperado);
    if (!esperado || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      context.warn("mp: segredo inválido");
      return { status: 401, body: "unauthorized" };
    }
    let id = request.query.get("data.id") || request.query.get("id");
    let tipo = request.query.get("type") || request.query.get("topic");
    if (!id) {
      try {
        const body = await request.json();
        id = body?.data?.id || body?.id;
        tipo = tipo || body?.type || body?.topic;
      } catch {}
    }
    if (!id || (tipo && tipo !== "payment")) return { status: 200, body: "ignored" };
    try {
      const pg = await buscarPagamento(id);
      context.log(`mp pagamento ${id} status=${pg.status}`);
      if (pg.status !== "approved") return { status: 200, body: "ok" };
      const [chatId, pacoteId] = String(pg.external_reference || "").split(":");
      const pacote = pacotes().find((p) => p.id === pacoteId);
      if (!chatId || !pacote) { context.warn("mp: referência desconhecida"); return { status: 200, body: "ok" }; }
      if (Number(pg.transaction_amount) + 0.001 < pacote.preco) { context.warn("mp: valor menor que o pacote"); return { status: 200, body: "ok" }; }
      // idempotência: cada pagamento credita uma única vez, mesmo que o Mercado Pago avise várias vezes
      let jaProcessado = true;
      await atualizarJson(`pag/${id}.json`, (atual) => {
        if (atual) return undefined;
        jaProcessado = false;
        return { chatId, pacoteId, em: new Date().toISOString() };
      });
      if (jaProcessado) return { status: 200, body: "ok" };
      const novo = await somar(chatId, pacote.fotos);
      context.log(`mp credito +${pacote.fotos} saldo=${novo}`);
      const token = process.env.TELEGRAM_TOKEN;
      await sendText(chatId, `Pagamento confirmado! Você recebeu *${pacote.fotos} créditos* (saldo: ${novo}).`, token);
      // se havia uma foto esperando o pagamento, edita agora
      const pendNome = `pend/${chatId}.json`;
      const raw = await ler(pendNome);
      if (raw) {
        let pend; try { pend = JSON.parse(raw.toString()); } catch {}
        if (pend?.estado === "pagamento") {
          await apagar(pendNome);
          await processarFoto({ chatId, nome: pend.nome, mime: pend.mime, modo: pend.modo, ajustes: pend.ajustes, remover: pend.remover, log: (m) => context.log(m) });
        }
      }
    } catch (e) {
      context.error(String(e));
      return { status: 500, body: "erro" }; // o Mercado Pago tenta de novo
    }
    return { status: 200, body: "ok" };
  },
});
