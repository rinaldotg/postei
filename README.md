# Postei

Serviço que melhora fotos para redes sociais, direto no Telegram (WhatsApp em breve).
O cliente envia a foto como **arquivo** (sem compressão), a IA ajusta luz, nitidez e pele
de forma natural, sem alterar o rosto, e devolve o resultado como documento.
A foto original é apagada logo após a entrega.

## Como funciona

1. Cliente envia a foto + pedido (opcional) no Telegram.
2. **Porteiro** (modelo de texto, Azure OpenAI) classifica o pedido: permitido, fora do escopo, esclarecer ou recusar.
3. **Edição** de imagem (Azure OpenAI Images) aplica só os ajustes permitidos.
4. O bot devolve a foto e apaga o original (Blob Storage com expiração de 1 dia como rede de segurança).
5. Pagamento por pacotes de fotos via **Mercado Pago** (Pix e cartão); créditos guardados no Blob Storage.

## Stack

- Azure Functions v4 (Node.js), Azure Blob Storage, Application Insights
- Azure OpenAI (Foundry): modelo de texto para o porteiro e modelo de imagem para a edição
- Telegram Bot API, Mercado Pago Checkout Pro

## Variáveis de ambiente (App Settings)

| Nome | Para que serve |
|---|---|
| `TELEGRAM_TOKEN`, `TELEGRAM_SECRET` | Bot e validação do webhook |
| `AZURE_OPENAI_KEY` | Chave do Azure OpenAI |
| `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` | Mercado Pago |
| `PACOTES` | JSON dos pacotes, ex.: `[{"id":"p5","fotos":5,"preco":5}]` |
| `ALLOWED_CHATS`, `ABERTO` | Controle de quem pode usar na fase de testes |
| `IMG_QUALITY` | Qualidade da edição (`low` por padrão) |

Nunca commite chaves. Use App Settings (ou Key Vault em produção).

## Deploy

```
zip -r postei.zip . -x "*.git*"
az functionapp deployment source config-zip -g <grupo> -n <function-app> --src postei.zip
```

## Limites conhecidos

- O filtro de segurança do Azure barra fotos com muito corpo exposto; o bot avisa e devolve o crédito.
- Nudez e conteúdo sexual explícito são recusados.
