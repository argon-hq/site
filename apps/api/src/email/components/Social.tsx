import { Column, Img, Link, Row } from "@react-email/components";
import { copy } from "../copy";
import type { SocialLinks } from "../types";
import * as styles from "./styles";

type SocialProps = { social: SocialLinks; assetBaseUrl: string };

// PNG only: e-mail clients accept neither SVG nor relative paths. A network without a URL in the
// settings is simply left out.
export function Social({ social, assetBaseUrl }: SocialProps) {
  const all: Array<{ icon: string; url: string | undefined; alt: string }> = [
    { icon: "logo", url: social.site, alt: copy.footer.social.site },
    { icon: "linkedin", url: social.linkedin, alt: copy.footer.social.linkedin },
    { icon: "instagram", url: social.instagram, alt: copy.footer.social.instagram },
    { icon: "youtube", url: social.youtube, alt: copy.footer.social.youtube },
  ];
  const links = all.filter((link): link is { icon: string; url: string; alt: string } => Boolean(link.url));

  return (
    <Row style={styles.socialRow}>
      <Column align="center">
        {links.map((link) => (
          <Link key={link.icon} href={link.url} style={styles.socialLink}>
            <Img src={`${assetBaseUrl}/${link.icon}.png`} width="20" height="20" alt={link.alt} style={styles.socialIcon} />
          </Link>
        ))}
      </Column>
    </Row>
  );
}
