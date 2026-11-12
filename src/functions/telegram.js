const { app } = require("@azure/functions");
const { verifySecret, parseUpdate, sendText, downloadFile, sendDocument } = require("../lib/telegram");
const { salvar, apagar, existe, ler } = require("../lib/storage");
const { classificar } = require("../lib/porteiro");
const { saldo, somar } = require("../lib/creditos");
const { processarFoto, oferecerPacotes } = require("../lib/fluxo");

// Variáveis de ambiente:
//   TELEGRAM_TOKEN   token do bot (@BotFather) — nunca no código
//   TELEGRAM_SECRET  texto aleatório que você inventa; o Telegram o devolve em cada chamada

const MSG = {
  boasVindas:
    "Oi! Eu melhoro a luz e o fundo da sua foto para você postar rápido.\n\n" +
    "Para manter a qualidade, envie a foto como *arquivo*: toque no clipe, " +
    "escolha *Arquivo* e selecione a foto (não como imagem comum).",
  reenviarComoDocumento:
    "Recebi a foto, mas o Telegram comprime imagens enviadas como foto. " +
    "Para melhor qualidade, reenvie como *arquivo*: clipe > Arquivo > sua foto.",
  recebeuDocumento: "Recebi a sua foto em qualidade original. Em breve vou processar.",
};

app.http("telegram", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "telegram",
  handler: async (request, context) => {
    if (!verifySecret(request.headers.get("x-telegram-bot-api-secret-token"), process.env.TELEGRAM_SECRET)) {
      context.warn("Telegram: segredo inválido");
      return { status: 401, body: "unauthorized" };
    }
    let update;
    try {
      update = await request.json();
    } catch {
      return { status: 400, body: "bad json" };
    }
    const msg = parseUpdate(update);
    if (!msg) return { status: 200, body: "ok" };

    context.log(`tg msg ${msg.messageId} tipo=${msg.type}`); // sem conteúdo pessoal (LGPD)
    const token = process.env.TELEGRAM_TOKEN;
    const pendNome = `pend/${msg.chatId}.json`;
    const permitidos = (process.env.ALLOWED_CHATS || "").split(",").map((x) => x.trim()).filter(Boolean);

    // Decide o que fazer com uma foto já salva (nome) + texto do cliente. Serve para foto nova e para resposta a pergunta.
    async function tratar(nome, mime, modo, textoCliente) {
      const buf = await ler(nome);
      if (!buf) {
        await apagar(pendNome);
        await sendText(msg.chatId, "Não encontrei mais a sua foto. Envie de novo, por favor.", token);
        return;
      }
      const r = await classificar(modo, textoCliente);
      context.log(`tg porteiro decisao=${r.decisao}`);
      const resp = (r.resposta_ao_cliente || "").trim();
      // pergunta ao cliente (esclarecer, ou recusa parcial que oferece alternativa e termina em "?"): mantém a foto
      if (r.decisao === "esclarecer" || (r.decisao === "fora_do_escopo" && resp.endsWith("?"))) {
        await salvar(pendNome, Buffer.from(JSON.stringify({ nome, mime, modo, texto: textoCliente, pergunta: resp, ts: Date.now() })), "application/json");
        await sendText(msg.chatId, r.resposta_ao_cliente || "Pode detalhar o que você quer ajustar na foto?", token);
        return;
      }
      await apagar(pendNome);
      if (r.decisao !== "permitido") {
        await apagar(nome);
        await sendText(msg.chatId, r.resposta_ao_cliente || MSG.boasVindas, token);
        return;
      }
      if (!permitidos.includes(String(msg.chatId)) && process.env.ABERTO !== "1") {
        await apagar(nome);
        await sendText(msg.chatId, "O serviço está em fase de testes e ainda não está aberto. Em breve!", token);
        return;
      }
      if ((await saldo(msg.chatId)) < 1) {
        // sem crédito: guarda a foto e o pedido; depois do pagamento o webhook processa sozinho
        await salvar(pendNome, Buffer.from(JSON.stringify({ estado: "pagamento", nome, mime, modo, ajustes: r.ajustes, remover: r.remover, ts: Date.now() })), "application/json");
        await oferecerPacotes(msg.chatId, "Combinado! Para editar essa foto você precisa de créditos (1 foto = 1 crédito).");
        return;
      }
      await apagar(pendNome);
      await processarFoto({ chatId: msg.chatId, nome, mime, modo, ajustes: r.ajustes, remover: r.remover, log: (m) => context.log(m) });
    }

    try {
      if (msg.type === "document") {
        if (msg.size && msg.size > 20 * 1024 * 1024) {
          await sendText(msg.chatId, "A foto passou de 20 MB. Envie uma menor, por favor.", token);
          return { status: 200, body: "ok" };
        }
        const nome = `in/${msg.chatId}-${msg.messageId}`;
        if (await existe(nome)) return { status: 200, body: "ok" }; // reentrega do Telegram
        // foto nova substitui qualquer pendência antiga
        const antigo = await ler(pendNome);
        if (antigo) {
          try { await apagar(JSON.parse(antigo.toString()).nome); } catch {}
          await apagar(pendNome);
        }
        const buf = await downloadFile(msg.fileId, token);
        await salvar(nome, buf, msg.mime);
        context.log(`tg foto salva ${nome} bytes=${buf.length}`);
        const modo = /produto/i.test(msg.caption) ? "produto" : "pessoa"; // provisório
        await tratar(nome, msg.mime, modo, msg.caption);
        return { status: 200, body: "ok" };
      }

      if (msg.type === "text") {
        const t = (msg.text || "").trim();
        if (/^\/saldo\b/i.test(t)) {
          const n = await saldo(msg.chatId);
          await sendText(msg.chatId, `Você tem *${n}* ${n === 1 ? "crédito" : "créditos"} (1 foto = 1 crédito). Para comprar mais: /comprar`, token);
          return { status: 200, body: "ok" };
        }
        if (/^\/comprar\b/i.test(t)) {
          await oferecerPacotes(msg.chatId, "Escolha um pacote de fotos:");
          return { status: 200, body: "ok" };
        }
        const dar = /^\/dar\s+(\d{1,3})\b/i.exec(t);
        if (dar && permitidos.includes(String(msg.chatId))) { // só o administrador: créditos de teste
          const n = await somar(msg.chatId, Number(dar[1]));
          await sendText(msg.chatId, `Pronto, agora você tem ${n} créditos.`, token);
          return { status: 200, body: "ok" };
        }
        const raw = await ler(pendNome);
        if (raw) {
          let pend;
          try { pend = JSON.parse(raw.toString()); } catch {}
          if (pend && pend.estado === "pagamento" && Date.now() - pend.ts < 6 * 60 * 60 * 1000) {
            await sendText(msg.chatId, "Estou aguardando o pagamento para editar a sua foto. Se precisar de um novo link, envie /comprar.", token);
            return { status: 200, body: "ok" };
          }
          if (pend && !pend.estado && Date.now() - pend.ts < 30 * 60 * 1000) {
            const texto =
              `pedido original: ${pend.texto || ""} | pergunta que você fez ao cliente: ${pend.pergunta || ""} | resposta do cliente: ${msg.text || ""} | ` +
              `o cliente já foi avisado do que não é feito; considere somente o que ele confirmou na resposta (iluminação, nitidez etc.)`;
            context.log("tg resposta a pendencia");
            await tratar(pend.nome, pend.mime, pend.modo, texto);
            return { status: 200, body: "ok" };
          }
          if (pend) await apagar(pend.nome);
          await apagar(pendNome);
        }
      }

      const text = msg.type === "image" ? MSG.reenviarComoDocumento : MSG.boasVindas;
      const r = await sendText(msg.chatId, text, token);
      context.log(`tg resposta enviada ok=${r?.ok}`);
    } catch (err) {
      context.error(String(err));
    }
    return { status: 200, body: "ok" };
  },
});
