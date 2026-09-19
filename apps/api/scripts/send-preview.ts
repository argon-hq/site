// Sends the edition fixture through the real transport, to see the template in an inbox.
//   pnpm email:send [destinatário]
// In development that inbox is Mailpit: http://localhost:8025. Nothing leaves the machine.
//
// The content is the fixture's, but the identity comes from the settings of this environment:
// the fixture points at a domain that does not exist, so its images would arrive broken.
//
// Locally it also makes the unsubscribe link real: the recipient is recorded as a confirmed
// subscriber and gets a token, so the footer link and the one-click header actually cancel it.
// Against Resend that step is skipped — a preview must not write subscribers into a real base.
//
// Wires the three pieces by hand instead of booting Nest: the script needs a transport and the
// sender setting, not the HTTP layer, the agents or the guard.

import "dotenv/config";
import { Effect } from "effect";
import { createTransport } from "nodemailer";
import { Resend } from "resend";
import { loadConfig, type Config } from "../src/config";
import { buildEdition } from "../src/email/edition/build";
import { editionFixture } from "../src/email/fixtures/edition";
import { MailService } from "../src/mail/mail.service";
import { ResendTransport } from "../src/mail/transports/resend.transport";
import { SmtpTransport } from "../src/mail/transports/smtp.transport";
import { PrismaService } from "../src/prisma/prisma.service";
import { SettingsService } from "../src/settings/settings.service";
import { normalizeEmail, SubscriberService } from "../src/subscriber/subscriber.service";
import { unsubscribeHeaders, unsubscribePageUrl } from "../src/subscriber/urls";

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

  const origins = { web: config.WEB_ORIGIN, api: config.API_ORIGIN };

  try {
    const identity = await settings.load();
    const token = await unsubscribeTokenFor(to, config, prisma, new SubscriberService(prisma, settings));
    const built = await Effect.runPromise(
      buildEdition({
        ...editionFixture,
        sender: identity.sender,
        social: identity.social,
        assetBaseUrl: identity.asset_base_url,
        privacyPolicyUrl: identity.privacy_policy_url,
        unsubscribeUrl: unsubscribePageUrl(origins, token),
      }),
    );
    const sent = await mail.send({
      to,
      subject: built.subject,
      html: built.html,
      text: built.text,
      // What every edition carries (RFC 8058): the endpoint the mail client posts to on its own.
      headers: unsubscribeHeaders(origins, token),
    });
    console.log(`Enviado para ${to} por ${transport.name} (id ${sent.id}).`);
    console.log(`Imagens: ${identity.asset_base_url}/logo.png`);
    console.log(`Cancelamento: ${unsubscribePageUrl(origins, token)}`);
    if (transport.name === "smtp") console.log("Caixa local: http://localhost:8025");
  } finally {
    await prisma.$disconnect();
  }
}

// A real token needs a subscriber to belong to, so the recipient becomes one — locally only.
// The confirmation route does not exist yet, so the last step is done here by hand: the check
// constraint wants a confirmed row to carry both the consent and the unsubscribe token.
async function unsubscribeTokenFor(
  email: string,
  config: Config,
  prisma: PrismaService,
  subscribers: SubscriberService,
): Promise<string> {
  if (config.MAIL_TRANSPORT !== "smtp") return "preview";

  await subscribers.signUp({ email });
  const subscriber = await prisma.subscriber.findUniqueOrThrow({ where: { email: normalizeEmail(email) } });
  const token = await subscribers.issueUnsubscribeToken(subscriber.id);
  await prisma.subscriber.update({
    where: { id: subscriber.id },
    data: { status: "confirmed", confirmedAt: new Date(), tokenHash: null, tokenExpiresAt: null },
  });
  return token;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
