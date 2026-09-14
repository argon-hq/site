import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Política de privacidade",
};

// Placeholder: o texto legal ainda será redigido pelo time. A página existe
// para que o aceite no cadastro (REB-38) tenha um destino válido.
export default function PrivacidadePage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-20">
      <h1 className="text-3xl font-bold tracking-tight">Política de privacidade</h1>
      <p className="text-muted">
        Este conteúdo ainda está sendo redigido. Em breve você encontrará aqui como a
        Argon coleta, usa e protege os seus dados.
      </p>
    </div>
  );
}
