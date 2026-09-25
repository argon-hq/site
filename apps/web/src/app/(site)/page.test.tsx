import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { messages, renderWithIntl } from "@/test/render";
import HomePage from "./page";

vi.mock("@/actions/subscribe", () => ({ subscribe: vi.fn() }));

const text = messages.home;

describe("HomePage", () => {
  it("has a single h1 with the essence", () => {
    renderWithIntl(<HomePage />);

    const h1 = screen.getAllByRole("heading", { level: 1 });
    expect(h1).toHaveLength(1);
    expect(h1[0]).toHaveTextContent(text.hero.heading);
  });

  it("labels every section by its heading", () => {
    renderWithIntl(<HomePage />);

    for (const name of [text.hero.heading, messages.newsletter.heading, text.consulting.heading, text.events.heading]) {
      expect(screen.getByRole("region", { name })).toBeInTheDocument();
    }
  });

  it("points the calls to action at the home sections", () => {
    renderWithIntl(<HomePage />);

    expect(screen.getByRole("link", { name: text.hero.primaryCta })).toHaveAttribute("href", "#newsletter");
    expect(screen.getByRole("link", { name: text.hero.secondaryCta })).toHaveAttribute("href", "#consultoria");
    expect(screen.getByRole("link", { name: text.events.notifyCta })).toHaveAttribute("href", "#newsletter");
  });

  it("embeds the real newsletter form in the newsletter section", () => {
    renderWithIntl(<HomePage />);

    const section = screen.getByRole("region", { name: messages.newsletter.heading });
    expect(section).toHaveAttribute("id", "newsletter");
    expect(within(section).getByRole("textbox", { name: messages.newsletter.emailLabel })).toBeInTheDocument();
    expect(within(section).getByRole("checkbox")).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: messages.newsletter.submit })).toBeInTheDocument();
  });

  it("lists the three consulting steps in order", () => {
    renderWithIntl(<HomePage />);

    const section = screen.getByRole("region", { name: text.consulting.heading });
    const steps = within(section).getAllByRole("listitem");
    expect(steps.map((step) => within(step).getByRole("heading").textContent)).toEqual([
      text.consulting.steps.analysis.title,
      text.consulting.steps.strategy.title,
      text.consulting.steps.execution.title,
    ]);
  });
});
