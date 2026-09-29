import { Column, Img, Row, Section, Text } from "@react-email/components";
import { copy } from "../copy";
import * as styles from "./styles";

// Brand on the left, over the dark band: the symbol in the first column, spanning both lines, and
// the drawn ARGON over the tagline in the second. Both are PNGs (mail clients accept no SVG),
// served from `assetBaseUrl` like the footer icons. `dateLabel` on the right belongs to the
// edition; a transactional e-mail simply leaves it out.
export function Header({ assetBaseUrl, dateLabel }: { assetBaseUrl: string; dateLabel?: string }) {
  return (
    <Section className="pad" style={styles.header}>
      <Row>
        <Column style={styles.brandCell}>
          <Row>
            <Column style={styles.brandMarkCell}>
              <Img
                src={`${assetBaseUrl}/header-symbol.png`}
                width="40"
                height="40"
                alt={copy.brand.symbol}
                style={styles.brandMark}
              />
            </Column>
            <Column style={styles.brandTextCell}>
              <Img
                src={`${assetBaseUrl}/header-wordmark.png`}
                width="120"
                height="20"
                alt={copy.brand.name}
                style={styles.brandName}
              />
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
