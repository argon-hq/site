import { Heading, Link, Section, Text } from "@react-email/components";
import { copy } from "../../copy";
import type { EditionItem } from "../../types";
import * as styles from "./styles";

// One news item: category, headline, the paragraph the writer produced, and the source link.
export function Item({ item }: { item: EditionItem }) {
  return (
    <Section className="pad dark-card" style={styles.item}>
      <Text style={styles.itemCategory}>{item.category}</Text>
      <Heading as="h2" className="dark-text" style={styles.itemHeadline}>
        {item.headline}
      </Heading>
      <Text className="dark-muted" style={styles.itemBody}>
        {item.body}
      </Text>
      <Link href={item.url} style={styles.itemLink}>
        {copy.item.readMore} &rarr;
      </Link>
    </Section>
  );
}
