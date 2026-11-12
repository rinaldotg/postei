const { app } = require("@azure/functions");
const { verifySignature, parseIncoming, parseStatuses, sendText } = require("../lib/whatsapp");

// Variáveis de ambiente (configuradas na Function App; depois migram para o Key Vault):
//   VERIFY_TOKEN       texto que você inventa e cadastra também no painel da Meta
//   APP_SECRET         "Chave secreta do app" (Configurações do app > Básico)
//   WHATSAPP_TOKEN     token de acesso do WhatsApp (nunca no código)
//   PHONE_NUMBER_ID    ID do número de telefone (não é segredo)

const MSG = {
  boasVindas:
    "Oi! Eu melhoro a luz e o fundo da sua foto para você postar rápido.\n\n" +
    "Para manter a qualidade, envie a foto como *Documento*: toque no clipe, " +
    "escolha Documento e selecione a foto.",
  reenviarComoDocumento:
    "Recebi a foto, mas o WhatsApp comprime fotos enviadas como imagem. " +
    "Para melhor qualidade, reenvie como *Documento*: clipe > Documento > sua foto.",
  recebeuDocumento:
    "Recebi a sua foto em qualidade original. Em breve vou processar.",
};

app.http("whatsapp", {
  methods: ["GET", "POST"],
  authLevel: "anonymous", // a Meta precisa chamar sem chave; a segurança é a assinatura
  route: "whatsapp",
  handler: async (request, context) => {
    // 1) Verificação do webhook (a Meta chama uma vez ao cadastrar o endereço)
    if (request.method === "GET") {
      const mode = request.query.get("hub.mode");
      const token = request.query.get("hub.verify_token");
      const challenge = request.query.get("hub.challenge");
      if (mode === "subscribe" && token && token === process.env.VERIFY_TOKEN) {
        return { status: 200, body: challenge };
      }
      return { status: 403, body: "forbidden" };
    }

    // 2) Mensagens recebidas
    const raw = await request.text();
    const ok = verifySignature(
      raw,
      request.headers.get("x-hub-signature-256"),
      process.env.APP_SECRET
    );
    if (!ok) {
      context.warn("Assinatura inválida: requisição ignorada");
      return { status: 401, body: "invalid signature" };
    }

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return { status: 400, body: "bad json" };
    }

    const creds = {
      token: process.env.WHATSAPP_TOKEN,
      phoneNumberId: process.env.PHONE_NUMBER_ID,
    };

    for (const msg of parseIncoming(body)) {
      // Log mínimo e sem conteúdo pessoal (LGPD): só tipo e id.
      context.log(`msg ${msg.messageId} tipo=${msg.type}`);

      try {
        if (msg.type === "document") {
          // TODO fase seguinte: baixar a mídia, enviar ao porteiro e ao Sunburst
          const r = await sendText(msg.from, MSG.recebeuDocumento, creds);
          context.log(`resposta enviada ${r?.messages?.[0]?.id} status=${r?.messages?.[0]?.message_status}`);
        } else if (msg.type === "image") {
          const r = await sendText(msg.from, MSG.reenviarComoDocumento, creds);
          context.log(`resposta enviada ${r?.messages?.[0]?.id} status=${r?.messages?.[0]?.message_status}`);
        } else {
          const r = await sendText(msg.from, MSG.boasVindas, creds);
          context.log(`resposta enviada ${r?.messages?.[0]?.id} status=${r?.messages?.[0]?.message_status}`);
        }
      } catch (err) {
        context.error(String(err));
      }
    }

    for (const st of parseStatuses(body)) {
      context.log(
        `status ${st.id} ${st.status} erro=${st.errorCode ?? "-"} ${st.errorTitle ?? ""} ${st.errorDetails ?? ""}`
      );
    }

    // Sempre 200 rápido: a Meta reenvia se demorar ou falhar.
    return { status: 200, body: "ok" };
  },
});
