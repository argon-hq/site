import { Section, Text } from "@react-email/components";
import { copy } from "../copy";
import * as styles from "./styles";

// Fixed closing, the same in every edition.
export function Signoff() {
  return (
    <Section className="pad dark-card" style={styles.signoff}>
      <Text className="dark-muted" style={styles.signoffLine}>
        {copy.signoff.line}
      </Text>
      <Text className="dark-text" style={styles.signoffSignature}>
        {copy.signoff.signature}
      </Text>
    </Section>
  );
}
