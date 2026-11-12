// Fluxo comum às funções do bot: gasta 1 crédito, edita a foto, entrega e apaga o original.
const { sendText, sendDocument } = require("./telegram");
const { apagar, ler } = require("./storage");
const { editar } = require("./imagem");
const { ehHeic } = require("./heic");
const { gastar, somar, pacotes } = require("./creditos");
const { criarLink } = require("./mercadopago");

const reais = (v) => "R$ " + Number(v).toFixed(2).replace(".", ",");

// Retorna "ok" | "sem_saldo" | "sem_foto" | "erro"
async function processarFoto({ chatId, nome, mime, modo, ajustes, remover, log }) {
  const token = process.env.TELEGRAM_TOKEN;
  const buf = await ler(nome);
  if (!buf) {
    await sendText(chatId, "Não encontrei mais a sua foto. Envie de novo, por favor.", token);
    return "sem_foto";
  }
  if (ehHeic(buf)) { // o servidor não consegue converter HEIC com segurança: orienta o cliente, sem cobrar
    await sendText(chatId, "Essa foto está no formato HEIC (padrão do iPhone), que ainda não consigo editar. Envie de novo em JPG: no iPhone, abra a foto > Compartilhar > Opções > Mais compatível, ou ajuste em Ajustes > Câmera > Formatos > Mais Compatível. Nenhum crédito foi usado.", token);
    await apagar(nome);
    return "erro";
  }
  if (!(await gastar(chatId))) return "sem_saldo";
  await sendText(chatId, "Recebi! Estou melhorando a sua foto, leva cerca de um minuto.", token);
  const t0 = Date.now();
  try {
    const { imagem, usage } = await editar(buf, mime, modo, ajustes, remover);
    log(`tg edicao ok ms=${Date.now() - t0} bytes=${imagem.length} usage=${JSON.stringify(usage)}`);
    await sendDocument(chatId, imagem, "postei.png", "Pronto! Foto melhorada, em qualidade máxima.", token);
    log("tg entrega ok");
    return "ok";
  } catch (e) {
    log("tg erro edicao " + String(e).slice(0, 300));
    await somar(chatId, 1); // devolve o crédito: o cliente não paga por foto que falhou
    const barrada = /safety_violations|rejected by the safety|content_policy|moderation_blocked/i.test(String(e));
    await sendText(chatId, barrada
      ? "Essa foto foi barrada pelo filtro de segurança da IA, o que é comum em fotos com o corpo muito exposto. Seu crédito foi devolvido. Fotos com roupa de banho, camiseta ou o corpo mais coberto costumam passar."
      : "Não consegui melhorar essa foto agora e o seu crédito foi devolvido. Tente enviar de novo em instantes.", token);
    return "erro";
  } finally {
    await apagar(nome); // o original some logo após a entrega (ou falha)
  }
}

// Envia os links de pagamento (Pix ou cartão) dos pacotes.
async function oferecerPacotes(chatId, intro) {
  const token = process.env.TELEGRAM_TOKEN;
  const linhas = [];
  for (const p of pacotes()) {
    const link = await criarLink(chatId, p);
    linhas.push(`[${p.fotos} fotos por ${reais(p.preco)}](${link})`);
  }
  await sendText(chatId, `${intro}\n\n${linhas.join("\n")}\n\nNa página você paga com *Pix* ou *cartão*. Assim que o pagamento for confirmado, eu aviso aqui.`, token);
}

module.exports = { processarFoto, oferecerPacotes, reais };
