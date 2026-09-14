"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { isValidEmail, normalizeEmail } from "@/lib/email";

type Status = "idle" | "submitting" | "sent";

export function NewsletterForm() {
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
    if (!email.trim()) return "Informe o seu e-mail.";
    if (!isValidEmail(email)) {
      return "Esse e-mail parece incompleto. Confira o formato: nome@dominio.com";
    }
    if (!consent) return "Marque o aceite da política de privacidade para continuar.";
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
            Seu e-mail
          </label>
          <input
            id={emailId}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="Coloque o seu melhor e-mail"
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
          {status === "submitting" ? "Enviando..." : "Inscreva-se"}
        </button>
      </div>

      {/* Honeypot: invisível para pessoas, atraente para bots. */}
      <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="empresa-site">Não preencha este campo</label>
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
        <p id={errorId} role="alert" className="text-sm font-medium text-danger">
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
          Li e aceito a{" "}
          <Link
            href="/privacidade"
            className="font-medium text-foreground underline underline-offset-2"
          >
            política de privacidade
          </Link>{" "}
          e quero receber a newsletter da Argon. Sem spam — você cancela quando quiser, em um
          clique.
        </label>
      </div>
    </form>
  );
}

function ConfirmationNotice({ email }: { email: string }) {
  return (
    <div
      role="status"
      className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-6"
    >
      <h2 className="text-xl font-semibold">Falta um passo: confirme no seu e-mail</h2>
      <p className="text-muted">
        Enviamos um link de confirmação para <strong className="text-foreground">{email}</strong>.
        Seu cadastro só fica ativo depois que você clicar nele — e nenhuma edição é enviada antes
        disso.
      </p>
      <p className="text-sm text-muted">
        O link vale por 48 horas. Não achou? Procure no spam ou nas promoções.
      </p>
    </div>
  );
}
