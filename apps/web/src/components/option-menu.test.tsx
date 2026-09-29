import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OptionMenu, type MenuOption } from "./option-menu";

type Fruit = "apple" | "banana" | "cherry";

const options: MenuOption<Fruit>[] = [
  { value: "apple", label: "Apple", icon: null },
  { value: "banana", label: "Banana", icon: null },
  { value: "cherry", label: "Cherry", icon: null },
];

function setup(value: Fruit = "banana") {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  render(
    <>
      <OptionMenu
        label="Fruit"
        triggerIcon={<span>F</span>}
        value={value}
        valueLabel={options.find((option) => option.value === value)?.label ?? ""}
        options={options}
        onSelect={onSelect}
      />
      <button type="button">After</button>
    </>,
  );
  const trigger = screen.getByRole("button", { name: /Fruit/ });
  return { user, onSelect, trigger };
}

const item = (name: string) => screen.getByRole("menuitemradio", { name });

describe("OptionMenu", () => {
  it("opens on click with focus on the checked item", async () => {
    const { user, trigger } = setup();

    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await user.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menu", { name: "Fruit" })).toBeInTheDocument();
    expect(item("Banana")).toHaveFocus();
    expect(item("Banana")).toHaveAttribute("aria-checked", "true");
    expect(item("Banana")).toHaveAttribute("tabindex", "0");
    expect(item("Apple")).toHaveAttribute("tabindex", "-1");
  });

  it("moves focus with the arrow keys, wrapping, and jumps with Home and End", async () => {
    const { user, trigger } = setup();
    await user.click(trigger);

    await user.keyboard("{ArrowDown}");
    expect(item("Cherry")).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(item("Apple")).toHaveFocus();

    await user.keyboard("{ArrowUp}");
    expect(item("Cherry")).toHaveFocus();

    await user.keyboard("{Home}");
    expect(item("Apple")).toHaveFocus();

    await user.keyboard("{End}");
    expect(item("Cherry")).toHaveFocus();
  });

  it("opens from the trigger with the arrows, on the first or last item", async () => {
    const { user, trigger } = setup();
    trigger.focus();

    await user.keyboard("{ArrowDown}");
    expect(item("Apple")).toHaveFocus();

    await user.keyboard("{Escape}");
    await user.keyboard("{ArrowUp}");
    expect(item("Cherry")).toHaveFocus();
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const { user, trigger, onSelect } = setup();
    await user.click(trigger);

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("closes on Tab and lets focus move on", async () => {
    const { user, trigger } = setup();
    await user.click(trigger);

    await user.tab();

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "After" })).toHaveFocus();
  });

  it("selects with Enter and reports the new value", async () => {
    const { user, trigger, onSelect } = setup();
    await user.click(trigger);

    await user.keyboard("{ArrowDown}{Enter}");

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("cherry");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("selects with a click", async () => {
    const { user, trigger, onSelect } = setup();
    await user.click(trigger);

    await user.click(item("Apple"));

    expect(onSelect).toHaveBeenCalledWith("apple");
  });

  it("does not report selecting the current value", async () => {
    const { user, trigger, onSelect } = setup();
    await user.click(trigger);

    await user.keyboard(" ");

    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes on a click outside", async () => {
    const { user, trigger } = setup();
    await user.click(trigger);

    await user.click(document.body);

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
