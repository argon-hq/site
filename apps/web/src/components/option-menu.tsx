"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

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
 *
 * Keyboard follows the WAI-ARIA menu button pattern: arrows move between the
 * items (wrapping), Home/End jump to the ends, Enter/Space select, Escape
 * closes and returns focus to the trigger, Tab closes and lets focus move on.
 * Only one item is in the tab sequence at a time (roving tabindex).
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
  // Index of the item that holds focus while the menu is open.
  const [active, setActive] = useState(0);

  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const checkedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const lastIndex = options.length - 1;

  function openAt(index: number) {
    setActive(index);
    setOpen(true);
  }

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  // Clicking outside closes.
  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  // Focus follows the active item: on open it lands on the checked one, and
  // every arrow key moves it from there.
  useEffect(() => {
    if (open) itemRefs.current[active]?.focus();
  }, [open, active]);

  function handleSelect(next: T) {
    close(true);
    if (next === value) return;
    onSelect(next);
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    // Enter and Space already fire the click. The arrows open the menu with
    // focus on the first or last item, as the pattern asks.
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openAt(0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openAt(lastIndex);
    }
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActive((current) => (current + 1) % options.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        setActive((current) => (current - 1 + options.length) % options.length);
        break;
      case "Home":
        event.preventDefault();
        setActive(0);
        break;
      case "End":
        event.preventDefault();
        setActive(lastIndex);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        handleSelect(options[active].value);
        break;
      case "Escape":
        event.preventDefault();
        close(true);
        break;
      case "Tab":
        // Not prevented: focus goes back to the trigger first, so the browser
        // moves on from there to the next (or previous) element in the page.
        close(true);
        break;
    }
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
        onClick={() => (open ? close(false) : openAt(checkedIndex))}
        onKeyDown={handleTriggerKeyDown}
        className="flex size-8 items-center justify-center rounded-ctl border border-border bg-background text-muted transition hover:border-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
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
          // Out of the tab sequence: focus lives on the items. Focusable so
          // the key handler on the container is legitimate.
          tabIndex={-1}
          onKeyDown={handleMenuKeyDown}
          className="absolute right-0 top-full z-30 mt-2 min-w-44 overflow-hidden rounded-card border border-border bg-background py-1 shadow-lg"
        >
          {options.map((option, index) => {
            const isCurrent = option.value === value;

            return (
              <button
                key={option.value}
                ref={(element) => {
                  itemRefs.current[index] = element;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={isCurrent}
                tabIndex={index === active ? 0 : -1}
                onClick={() => handleSelect(option.value)}
                className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition hover:bg-surface focus-visible:bg-surface focus-visible:outline-none"
              >
                <span className="flex shrink-0 items-center justify-center text-muted">{option.icon}</span>
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
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" className="ml-auto text-accent">
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
