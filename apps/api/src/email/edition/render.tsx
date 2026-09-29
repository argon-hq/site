import { render } from "@react-email/render";
import type { EditionInput } from "../types";
import { EditionEmail } from "./components/EditionEmail";

// React Email renders to a string. Same input, same output: no clock, no network, no randomness.
export function renderEditionHtml(input: EditionInput): Promise<string> {
  return render(<EditionEmail input={input} />);
}
