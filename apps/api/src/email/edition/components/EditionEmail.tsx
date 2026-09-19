import { Body, Container, Head, Html, Preview, Section } from "@react-email/components";
import { formatDate } from "../../format";
import { FONT_STYLESHEET } from "../../theme";
import type { EditionInput } from "../../types";
import { Footer } from "./Footer";
import { Header } from "./Header";
import { Item } from "./Item";
import { Signoff } from "./Signoff";
import * as styles from "./styles";
import { HEAD_CSS } from "./styles";

// The whole e-mail. `Head` already emits the charset and the Apple reformatting meta; `Preview`
// emits the hidden preheader with its padding.
export function EditionEmail({ input }: { input: EditionInput }) {
  const dateLabel = formatDate(input.date);
  return (
    <Html lang="pt-BR">
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <title>{input.subject}</title>
        <link href={FONT_STYLESHEET} rel="stylesheet" />
        <style dangerouslySetInnerHTML={{ __html: HEAD_CSS }} />
      </Head>
      <Preview>{input.title}</Preview>
      <Body className="dark-bg" style={styles.page}>
        <Section className="dark-bg" style={styles.canvas}>
          <Container className="container" style={styles.container}>
            <Header dateLabel={dateLabel} />
            {input.items.map((item) => (
              <Item key={item.url} item={item} />
            ))}
            <Signoff />
            <Footer
              sender={input.sender}
              social={input.social}
              assetBaseUrl={input.assetBaseUrl}
              unsubscribeUrl={input.unsubscribeUrl}
              privacyPolicyUrl={input.privacyPolicyUrl}
            />
          </Container>
        </Section>
      </Body>
    </Html>
  );
}
