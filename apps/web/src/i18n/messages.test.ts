import { describe, expect, it } from "vitest";
import enUS from "../../messages/en-US.json";
import ptBR from "../../messages/pt-BR.json";

/** Every leaf key as a dotted path, so a missing translation names itself. */
function keys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => keys(child, prefix ? `${prefix}.${key}` : key));
}

describe("messages", () => {
  it("has the same keys in every locale", () => {
    expect(keys(enUS).sort()).toEqual(keys(ptBR).sort());
  });
});
