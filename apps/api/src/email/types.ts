// Builder input and output contract. Independent of the database schema: the adapter that
// reads edition + article (from-db.ts) converts to this shape.

// Shared by every template, not just the edition: the components in `email/components` take
// these, so they never depend on the edition contract.
export type Sender = { name: string; address: string; postalAddress: string };

export type SocialLinks = { site: string; linkedin?: string; instagram?: string; youtube?: string };

export type EditionItem = {
  category: string;
  headline: string;
  body: string;
  url: string;
};

export type EditionInput = {
  // Edition date. Received, not read from the clock, so the output is reproducible.
  date: Date;
  title: string;
  subject: string;
  items: EditionItem[];
  sender: Sender;
  // Absolute URLs built by the caller. The builder never builds a URL.
  unsubscribeUrl: string;
  privacyPolicyUrl: string;
  // Absolute base of the images in public/email. E-mail clients accept neither SVG nor relative paths.
  assetBaseUrl: string;
  social: SocialLinks;
};

// Transactional e-mail of the sign-up (ARG-38). It carries no unsubscribe link: the permanent
// token is only issued at confirmation, so there is nothing to cancel yet.
export type ConfirmationInput = {
  // Absolute, built by the caller with the subscriber's one-time token.
  confirmUrl: string;
  expiresInHours: number;
  sender: Sender;
  privacyPolicyUrl: string;
  assetBaseUrl: string;
  social: SocialLinks;
};

export type BuiltEmail = { subject: string; html: string; text: string };

export type BuiltEdition = BuiltEmail;

export type ValidationCode =
  | "html_unparseable"
  | "script_present"
  | "stylesheet_not_allowed"
  | "image_not_absolute"
  | "image_not_allowed"
  | "image_alt_missing"
  | "link_not_absolute"
  | "html_too_large"
  | "subject_too_long"
  | "body_too_long"
  | "item_link_missing_in_html"
  | "item_link_missing_in_text"
  | "unsubscribe_missing"
  | "postal_address_missing"
  | "policy_link_missing"
  | "text_empty";

export type ValidationError = { code: ValidationCode; message: string; item?: number };
