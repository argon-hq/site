"use client";

import { useEffect } from "react";

export const ENTRY_PATH_KEY = "argon:entry-path";

/**
 * Marca, uma vez por carregamento de documento, em que rota o visitante entrou
 * no site.
 *
 * É o que permite ao botão de voltar saber se existe página anterior *dentro*
 * do site: o Next 16 não expõe índice de histórico, `document.referrer` vem
 * vazio em navegação client-side, e `history.length` conta o about:blank da
 * aba — usar esse último levaria o visitante para uma tela em branco.
 */
export function EntryPathTracker() {
  useEffect(() => {
    try {
      if (!sessionStorage.getItem(ENTRY_PATH_KEY)) {
        sessionStorage.setItem(ENTRY_PATH_KEY, window.location.pathname);
      }
    } catch {
      // Navegação privada ou storage bloqueado: o botão cai na home.
    }
  }, []);

  return null;
}
