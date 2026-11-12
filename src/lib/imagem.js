// Edição de imagem (gpt-image-2.5-sunburst via Azure OpenAI, API v1 /images/edits)
// Variáveis: AZURE_OPENAI_KEY (segredo), AZURE_OPENAI_ENDPOINT, IMG_MODEL, IMG_QUALITY (padrão "low")
const ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT || "https://rinaldotg-6548-resource.openai.azure.com/openai/v1";
const MODEL = process.env.IMG_MODEL || "gpt-image-2.5-sunburst";

const REGRAS_PESSOA =
  "Retouch this photo of a person for social media: correct exposure and white balance, soft natural flattering light, " +
  "clean natural contrast, light noise reduction and gentle sharpening. Keep exactly the same person: preserve face, facial features, " +
  "skin tone and texture, hair, body, clothing, colors, pose and proportions. Do not slim, whiten, age or beautify, and do not smooth the skin unless a skin retouch is explicitly requested below. " +
  "Do not add or change any object. No filters, no stylization, no text.";

const REGRAS_PRODUTO =
  "Retouch this product photo for an online store and social media: correct exposure and white balance, soft even lighting, " +
  "clean natural contrast, realistic material texture. Preserve exactly the product's shape, colors, pattern, logo, stitching and " +
  "proportions. Do not add, remove or change any detail of the item. No filters, no text.";

function montarPrompt(modo, ajustes, remover) {
  let p = modo === "produto" ? REGRAS_PRODUTO : REGRAS_PESSOA;
  if (modo !== "produto" && !ajustes) p += " Background: keep the same setting, only cleaner and less cluttered.";
  if (modo !== "produto" && /skin|blemish|acne/i.test(ajustes || ""))
    p += " Skin retouch is allowed: remove temporary blemishes, spots, acne and stray marks, even out tone gently and reduce shine, but KEEP visible natural pores and fine skin texture, moles and freckles. The result must look like real skin in good light: never plastic, waxy, airbrushed or AI-looking. Same skin color, same face shape and features.";
  if (/blur|bokeh/i.test(ajustes || ""))
    p += " Background change is allowed only as a softly blurred, shallow depth-of-field background with natural bokeh; keep the subject edges clean and natural, hair detail intact.";
  if (ajustes) p += ` Requested adjustments (apply only these, within the rules above): ${ajustes}.`;
  if (remover) p += ` Remove only these background elements and fill naturally: ${remover}.`;
  return p;
}

// Lê largura/altura de PNG ou JPEG sem dependências
function dimensoes(buf) {
  try {
    if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i < buf.length - 9) {
        if (buf[i] !== 0xff) { i++; continue; }
        const m = buf[i + 1];
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
          return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
  } catch {}
  return null;
}

function escolherTamanho(buf) {
  const d = dimensoes(buf);
  if (!d) return "1024x1024";
  if (d.w > d.h * 1.15) return "1536x1024";
  if (d.h > d.w * 1.15) return "1024x1536";
  return "1024x1024";
}

async function editar(buffer, mime, modo, ajustes, remover) {
  const form = new FormData();
  const ext = (mime || "").includes("png") ? "png" : "jpg";
  form.append("model", MODEL);
  form.append("prompt", montarPrompt(modo, ajustes, remover));
  form.append("size", escolherTamanho(buffer));
  form.append("quality", process.env.IMG_QUALITY || "low");
  form.append("n", "1");
  form.append("image", new Blob([buffer], { type: mime || "image/jpeg" }), `foto.${ext}`);

  const res = await fetch(`${ENDPOINT}/images/edits`, {
    method: "POST",
    headers: { "api-key": process.env.AZURE_OPENAI_KEY },
    body: form,
  });
  if (!res.ok) throw new Error(`edicao falhou: ${res.status} ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  const b64 = j?.data?.[0]?.b64_json;
  if (!b64) throw new Error("edicao sem imagem na resposta");
  return { imagem: Buffer.from(b64, "base64"), usage: j.usage || null };
}

module.exports = { editar, montarPrompt, escolherTamanho };
