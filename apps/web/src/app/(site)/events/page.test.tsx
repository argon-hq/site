import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { events } from "@/lib/events";
import { messages, renderWithIntl } from "@/test/render";
import EventsPage from "./page";

const text = messages.events;

describe("EventsPage", () => {
  it("has a single h1 and a section per scope", () => {
    renderWithIntl(<EventsPage />);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    for (const name of Object.values(text.scopes)) {
      expect(screen.getByRole("region", { name })).toBeInTheDocument();
    }
  });

  it("lists each event under its scope, with the organizer's page as an external link", () => {
    renderWithIntl(<EventsPage />);

    for (const event of events) {
      const section = screen.getByRole("region", { name: text.scopes[event.scope] });
      const link = within(section).getByRole("link", { name: new RegExp(`^${event.name}`) });

      expect(link).toHaveAttribute("href", event.url);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    }
  });

  it("writes the date range in the visitor's language, with no time zone shift", () => {
    renderWithIntl(<EventsPage />);

    const section = screen.getByRole("region", { name: text.scopes.region });
    const [first] = within(section).getAllByRole("listitem");
    expect(first).toHaveTextContent(/16\D+17 de outubro/);
  });

  it("marks as free only the events whose organizer says so", () => {
    renderWithIntl(<EventsPage />);

    const free = events.filter((event) => event.free);
    expect(screen.getAllByText(text.free)).toHaveLength(free.length);
  });

  it("keeps the events sorted by start date inside each scope", () => {
    for (const scope of Object.keys(text.scopes)) {
      const starts = events.filter((event) => event.scope === scope).map((event) => event.start);
      expect(starts).toEqual([...starts].sort());
    }
  });
});
