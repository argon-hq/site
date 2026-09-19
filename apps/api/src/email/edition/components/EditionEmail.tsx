import { EmailLayout } from "../../components/EmailLayout";
import { Footer } from "../../components/Footer";
import { Header } from "../../components/Header";
import { Signoff } from "../../components/Signoff";
import { formatDate } from "../../format";
import type { EditionInput } from "../../types";
import { Item } from "./Item";

// The edition: the shared shell, the shared header and footer, and the items, which are the only
// part of the layout that belongs to this template.
export function EditionEmail({ input }: { input: EditionInput }) {
  return (
    <EmailLayout title={input.subject} preheader={input.title}>
      <Header dateLabel={formatDate(input.date)} />
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
    </EmailLayout>
  );
}
