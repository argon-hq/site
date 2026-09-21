import { Column, Row, Section, Text } from "@react-email/components";
import { copy } from "../copy";
import * as styles from "./styles";

// Brand on the left, over the dark band. `dateLabel` on the right belongs to the edition; a
// transactional e-mail simply leaves it out.
export function Header({ dateLabel }: { dateLabel?: string }) {
  return (
    <Section className="pad" style={styles.header}>
      <Row>
        <Column style={styles.brandCell}>
          <Row>
            <Column style={styles.brandMark}>&nbsp;</Column>
            <Column style={styles.brandTextCell}>
              <Text style={styles.brandName}>{copy.brand.name}</Text>
              <Text style={styles.brandTagline}>{copy.brand.tagline}</Text>
            </Column>
          </Row>
        </Column>
        {dateLabel && (
          <Column align="right" style={styles.headerDate}>
            {copy.header.edition} &middot; {dateLabel}
          </Column>
        )}
      </Row>
    </Section>
  );
}
