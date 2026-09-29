import { render } from "@react-email/render";
import type { ConfirmationInput } from "../types";
import { ConfirmationEmail } from "./components/ConfirmationEmail";

// React Email renders to a string. Same input, same output: no clock, no network, no randomness.
export function renderConfirmationHtml(input: ConfirmationInput): Promise<string> {
  return render(<ConfirmationEmail input={input} />);
}
