"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export type MenuOption<T extends string> = {
  value: T;
  label: string;
  icon: ReactNode;
};

type OptionMenuProps<T extends string> = {
  /** Vira o nome acessível do gatilho, junto do rótulo da opção ativa. */
  label: string;
  triggerIcon: ReactNode;
  value: T;
  valueLabel: string;
  options: MenuOption<T>[];
  onSelect: (value: T) => void;
  disabled?: boolean;
};

/**
 * Botão compacto que abre uma lista de opções exclusivas. Compartilhado pelos
 * seletores de idioma e de tema — a diferença entre eles é só o ícone e a
 * lista, não o comportamento.
 */
export function OptionMenu<T extends string>({
  label,
  triggerIcon,
  value,
  valueLabel,
  options,
  onSelect,
  disabled = false,
}: OptionMenuProps<T>) {
  const [open, setOpen] = useState(false);

  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const activeItemRef = useRef<HTMLButtonElement>(null);

  // Clique fora e Escape fecham. Escape devolve o foco ao gatilho.
  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  // Ao abrir, o foco vai para a opção em uso.
  useEffect(() => {
    if (open) activeItemRef.current?.focus();
  }, [open]);

  function handleSelect(next: T) {
    setOpen(false);
    if (next === value) return;
    onSelect(next);
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className="flex size-8 items-center justify-center rounded-lg border border-border bg-background text-muted transition hover:border-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
      >
        <span className="sr-only">
          {label}: {valueLabel}
        </span>
        {triggerIcon}
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          className="absolute right-0 top-full z-30 mt-2 min-w-44 overflow-hidden rounded-lg border border-border bg-background py-1 shadow-lg"
        >
          {options.map((option) => {
            const isCurrent = option.value === value;

            return (
              <button
                key={option.value}
                ref={isCurrent ? activeItemRef : undefined}
                type="button"
                role="menuitemradio"
                aria-checked={isCurrent}
                onClick={() => handleSelect(option.value)}
                className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition hover:bg-surface focus-visible:bg-surface focus-visible:outline-none"
              >
                <span className="flex shrink-0 items-center justify-center text-muted">
                  {option.icon}
                </span>
                <span className={isCurrent ? "font-medium" : "text-muted"}>{option.label}</span>
                {isCurrent && <Check />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Check() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
      className="ml-auto text-accent"
    >
      <path
        d="M3.5 8.5L6.5 11.5L12.5 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
