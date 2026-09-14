"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { isValidEmail, normalizeEmail } from "@/lib/email";

type Status = "idle" | "submitting" | "sent";

export function NewsletterForm() {
  const t = useTranslations("newsletter");

  const emailId = useId();
  const errorId = useId();
  const consentId = useId();

  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [sentTo, setSentTo] = useState("");

  function validate(): string | null {
    if (!email.trim()) return t("errors.required");
    if (!isValidEmail(email)) return t("errors.invalid");
    if (!consent) return t("errors.consent");
    return null;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const validationError = validate();
    if (validationError) {
      // O valor digitado nunca é apagado: o usuário corrige o que já escreveu.
      setError(validationError);
      return;
    }

    // Honeypot: preenchido significa bot. Respondemos como sucesso para não
    // dar sinal ao script, mas nada é enviado.
    if (honeypot) {
      setSentTo(normalizeEmail(email));
      setStatus("sent");
      return;
    }

    setError(null);
    setStatus("submitting");

    // TODO(REB-74/REB-75): trocar pela chamada real de cadastro, que gera o
    // token de uso único e dispara o e-mail de confirmação.
    await new Promise((resolve) => setTimeout(resolve, 600));

    setSentTo(normalizeEmail(email));
    setStatus("sent");
  }

  if (status === "sent") {
    return <ConfirmationNotice email={sentTo} />;
  }

  const invalid = Boolean(error);

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex-1">
          <label htmlFor={emailId} className="sr-only">
            {t("emailLabel")}
          </label>
          <input
            id={emailId}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder={t("emailPlaceholder")}
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              if (error) setError(null);
            }}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? errorId : undefined}
            className="h-14 w-full rounded-lg border border-border bg-surface px-4 text-base outline-none transition placeholder:text-muted focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40 aria-invalid:border-danger aria-invalid:focus-visible:ring-danger/30"
          />
        </div>

        <button
          type="submit"
          disabled={status === "submitting"}
          className="h-14 shrink-0 rounded-lg bg-accent px-8 text-base font-semibold text-accent-foreground transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status === "submitting" ? t("submitting") : t("submit")}
        </button>
      </div>

      {/* Honeypot: invisível para pessoas, atraente para bots. */}
      <div
        aria-hidden="true"
        className="absolute left-[-9999px] h-0 w-0 overflow-hidden"
      >
        <label htmlFor="empresa-site">{t("honeypotLabel")}</label>
        <input
          id="empresa-site"
          name="empresa-site"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(event) => setHoneypot(event.target.value)}
        />
      </div>

      {error && (
        <p
          id={errorId}
          role="alert"
          className="text-sm font-medium text-danger"
        >
          {error}
        </p>
      )}

      {/* O input fica fora do <label> para que clicar no link da política
          navegue sem marcar a caixa. */}
      <div className="flex items-start gap-3 text-sm text-muted">
        <input
          id={consentId}
          name="consent"
          type="checkbox"
          checked={consent}
          onChange={(event) => {
            setConsent(event.target.checked);
            if (error) setError(null);
          }}
          className="mt-0.5 size-4 shrink-0 accent-accent"
        />
        <label htmlFor={consentId}>
          {t.rich("consent", {
            link: (chunks) => (
              <Link
                href="/privacy"
                className="font-medium text-foreground underline underline-offset-2"
              >
                {chunks}
              </Link>
            ),
          })}
        </label>
      </div>
    </form>
  );
}

function ConfirmationNotice({ email }: { email: string }) {
  const t = useTranslations("newsletter.success");

  return (
    <div
      role="status"
      className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-6"
    >
      <h2 className="text-xl font-semibold">{t("title")}</h2>
      <p className="text-muted">
        {t.rich("body", {
          email,
          strong: (chunks) => (
            <strong className="text-foreground">{chunks}</strong>
          ),
        })}
      </p>
      <p className="text-sm text-muted">{t("expiry")}</p>
    </div>
  );
}
