// Fixed e-mail strings in one place. Portuguese only by decision; if another language ever
// comes, this becomes messages/<locale>.json read with createTranslator, as in the web app.
export const copy = {
  brand: { name: "Argon", tagline: "Business newsletter" },
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
} as const;
