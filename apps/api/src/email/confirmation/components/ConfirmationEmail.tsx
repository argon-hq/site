import { Heading, Link, Section, Text } from "@react-email/components";
import { EmailLayout } from "../../components/EmailLayout";
import { Footer } from "../../components/Footer";
import { Header } from "../../components/Header";
import { Signoff } from "../../components/Signoff";
import { copy } from "../../copy";
import type { ConfirmationInput } from "../../types";
import * as styles from "./styles";

// Sign-up confirmation. Same shell and same footer as the edition; no date in the header and no
// unsubscribe link in the footer, because neither exists before the subscription is confirmed.
export function ConfirmationEmail({ input }: { input: ConfirmationInput }) {
  return (
    <EmailLayout title={copy.confirmation.subject} preheader={copy.confirmation.preheader}>
      <Header assetBaseUrl={input.assetBaseUrl} />

      <Section className="pad dark-card" style={styles.content}>
        <Heading as="h1" className="dark-text" style={styles.heading}>
          {copy.confirmation.heading}
        </Heading>
        <Text className="dark-muted" style={styles.body}>
          {copy.confirmation.body}
        </Text>

        <Section style={styles.buttonCell}>
          <Link href={input.confirmUrl} style={styles.button}>
            {copy.confirmation.cta}
          </Link>
        </Section>

        {/* Every client that blocks the button still has to be able to confirm. */}
        <Text className="dark-muted" style={styles.fallback}>
          {copy.confirmation.fallback}
        </Text>
        <Text style={styles.fallbackUrl}>{input.confirmUrl}</Text>

        <Text className="dark-muted" style={styles.note}>
          {copy.confirmation.expiry(input.expiresInHours)}
        </Text>
        <Text className="dark-muted" style={styles.note}>
          {copy.confirmation.ignore}
        </Text>
      </Section>

      <Signoff />

      <Footer
        sender={input.sender}
        social={input.social}
        assetBaseUrl={input.assetBaseUrl}
        privacyPolicyUrl={input.privacyPolicyUrl}
      />
    </EmailLayout>
  );
}
