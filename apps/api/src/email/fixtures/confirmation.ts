import type { ConfirmationInput } from "../types";

// Fixture of the confirmation e-mail, for the snapshot and the preview.
export const confirmationFixture: ConfirmationInput = {
  confirmUrl: "https://argon.com.br/newsletter/confirm?token=fixture",
  expiresInHours: 48,
  sender: {
    name: "Argon",
    address: "newsletter@argon.com.br",
    postalAddress: "Rua Exemplo, 100 · Panambi, RS, Brasil",
  },
  privacyPolicyUrl: "https://argon.com.br/privacy",
  assetBaseUrl: "https://argon.com.br/email",
  social: {
    site: "https://argon.com.br",
    linkedin: "https://www.linkedin.com/company/argon",
    instagram: "https://www.instagram.com/argon",
    youtube: "https://www.youtube.com/@argon",
  },
};
