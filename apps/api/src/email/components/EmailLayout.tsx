import { Body, Container, Head, Html, Preview, Section } from "@react-email/components";
import type { ReactNode } from "react";
import { FONT_STYLESHEET } from "../theme";
import * as styles from "./styles";
import { HEAD_CSS } from "./styles";

// The shell every e-mail shares: head, dark-mode hooks, the page band and the 600px card.
// `Head` already emits the charset and the Apple reformatting meta; `Preview` emits the hidden
// preheader with its padding. Templates fill in the card.
export function EmailLayout({ title, preheader, children }: { title: string; preheader: string; children: ReactNode }) {
  return (
    <Html lang="pt-BR">
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <title>{title}</title>
        <link href={FONT_STYLESHEET} rel="stylesheet" />
        <style dangerouslySetInnerHTML={{ __html: HEAD_CSS }} />
      </Head>
      <Preview>{preheader}</Preview>
      <Body className="dark-bg" style={styles.page}>
        <Section className="dark-bg" style={styles.canvas}>
          <Container className="container" style={styles.container}>
            {children}
          </Container>
        </Section>
      </Body>
    </Html>
  );
}
