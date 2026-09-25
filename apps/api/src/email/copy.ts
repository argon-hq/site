// Fixed e-mail strings in one place. Portuguese only by decision; if another language ever
// comes, this becomes messages/<locale>.json read with createTranslator, as in the web app.
export const copy = {
  brand: { name: "Argon", tagline: "Business newsletter", symbol: "Símbolo" },
  header: { edition: "Edição de hoje" },
  item: { readMore: "Ler matéria completa" },
  signoff: { line: "Até a próxima e um grande abraço,", signature: "Time Argon" },
  footer: {
    reason: "Você está recebendo este e-mail porque se inscreveu na Argon Business Newsletter.",
    unsubscribe: "Cancele a assinatura aqui",
    privacy: "Política de privacidade",
    social: { site: "Site da Argon", linkedin: "LinkedIn", instagram: "Instagram", youtube: "YouTube" },
  },
  text: { unsubscribe: "Cancele a assinatura", privacy: "Política de privacidade" },
  confirmation: {
    subject: "Confirme a sua inscrição na Argon",
    preheader: "Falta um passo: confirmar o seu e-mail.",
    heading: "Confirme a sua inscrição",
    body: "Alguém pediu para receber a Argon Business Newsletter neste endereço. Se foi você, confirme no botão abaixo — nenhuma edição é enviada antes disso.",
    cta: "Confirmar inscrição",
    fallback: "Se o botão não funcionar, abra este endereço no navegador:",
    expiry: (hours: number) => `O link vale por ${hours} horas. Depois desse prazo, é só se inscrever de novo.`,
    ignore: "Se não foi você, ignore este e-mail: sem a confirmação, o endereço não entra na lista.",
  },
} as const;
