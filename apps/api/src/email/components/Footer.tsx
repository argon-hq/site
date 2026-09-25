import { Link, Section, Text } from "@react-email/components";
import { copy } from "../copy";
import type { Sender, SocialLinks } from "../types";
import * as styles from "./styles";
import { Social } from "./Social";

type FooterProps = {
  sender: Sender;
  social: SocialLinks;
  assetBaseUrl: string;
  privacyPolicyUrl: string;
  // Only the edition has one: the permanent token is issued at confirmation, so the e-mail that
  // asks for that confirmation cannot carry a link to cancel what does not exist yet.
  unsubscribeUrl?: string;
};

// Everything the law and the mail providers require: why the reader got this, who sent it, the
// postal address, one-click unsubscribe and the privacy policy.
export function Footer({ sender, social, assetBaseUrl, unsubscribeUrl, privacyPolicyUrl }: FooterProps) {
  return (
    <Section className="pad" style={styles.footer}>
      <Social social={social} assetBaseUrl={assetBaseUrl} />
      <Text style={styles.footerBrand}>
        {copy.brand.name} &middot; {copy.brand.tagline}
      </Text>
      <Text style={styles.footerSmall}>{copy.footer.reason}</Text>
      <Text style={styles.footerSmall}>
        {sender.name} &lt;{sender.address}&gt; &middot; {sender.postalAddress}
      </Text>
      <Text style={styles.footerLinks}>
        {unsubscribeUrl && (
          <>
            <Link href={unsubscribeUrl} style={styles.footerLink}>
              {copy.footer.unsubscribe}
            </Link>
            {" · "}
          </>
        )}
        <Link href={privacyPolicyUrl} style={styles.footerLink}>
          {copy.footer.privacy}
        </Link>
      </Text>
    </Section>
  );
}
