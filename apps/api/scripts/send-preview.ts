// Sends the edition fixture through the real transport, to see the template in an inbox.
//   pnpm email:send [destinatário]
// In development that inbox is Mailpit: http://localhost:8025. Nothing leaves the machine.
//
// The content is the fixture's, but the identity comes from the settings of this environment:
// the fixture points at a domain that does not exist, so its images would arrive broken.
//
// Wires the three pieces by hand instead of booting Nest: the script needs a transport and the
// sender setting, not the HTTP layer, the agents or the guard.

import "dotenv/config";
import { Effect } from "effect";
import { createTransport } from "nodemailer";
import { Resend } from "resend";
import { loadConfig } from "../src/config";
import { buildEdition } from "../src/email/edition/build";
import { editionFixture } from "../src/email/fixtures/edition";
import { MailService } from "../src/mail/mail.service";
import { ResendTransport } from "../src/mail/transports/resend.transport";
import { SmtpTransport } from "../src/mail/transports/smtp.transport";
import { PrismaService } from "../src/prisma/prisma.service";
import { SettingsService } from "../src/settings/settings.service";

async function main() {
  const to = process.argv[2] ?? "assinante@example.com";
  const config = loadConfig();

  const prisma = new PrismaService(config.DATABASE_URL);
  const transport =
    config.MAIL_TRANSPORT === "resend"
      ? new ResendTransport(new Resend(config.RESEND_API_KEY))
      : new SmtpTransport(createTransport(config.SMTP_URL));
  const settings = new SettingsService(prisma);
  const mail = new MailService(transport, settings);

  try {
    const identity = await settings.load();
    const built = await Effect.runPromise(
      buildEdition({
        ...editionFixture,
        sender: identity.sender,
        social: identity.social,
        assetBaseUrl: identity.asset_base_url,
        privacyPolicyUrl: identity.privacy_policy_url,
      }),
    );
    const sent = await mail.send({
      to,
      subject: built.subject,
      html: built.html,
      text: built.text,
      // What the edition carries in production (RFC 8058). This URL is the fixture's.
      headers: {
        "List-Unsubscribe": `<${editionFixture.unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    console.log(`Enviado para ${to} por ${transport.name} (id ${sent.id}).`);
    console.log(`Imagens: ${identity.asset_base_url}/logo.png`);
    if (transport.name === "smtp") console.log("Caixa local: http://localhost:8025");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
