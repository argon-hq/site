import { ConsoleLogger } from "@nestjs/common";

// Every log in the API is an object: `{ msg, ...fields }`. In AWS that is written as JSON, because
// CloudWatch indexes the fields. On a terminal the same line is unreadable, so here the object is
// flattened into `message field=value`, keeping the colours, the timestamp and the context that
// ConsoleLogger already prints.
export class PrettyLogger extends ConsoleLogger {
  log(message: unknown, ...rest: unknown[]): void {
    super.log(flatten(message), ...(rest as [string?]));
  }

  warn(message: unknown, ...rest: unknown[]): void {
    super.warn(flatten(message), ...(rest as [string?]));
  }

  error(message: unknown, ...rest: unknown[]): void {
    super.error(flatten(message), ...(rest as [string?]));
  }

  debug(message: unknown, ...rest: unknown[]): void {
    super.debug(flatten(message), ...(rest as [string?]));
  }

  verbose(message: unknown, ...rest: unknown[]): void {
    super.verbose(flatten(message), ...(rest as [string?]));
  }
}

// `{ msg: "sign-up pending", subscriberId: "abc", returning: true }`
//   →  `sign-up pending subscriberId=abc returning=true`
export function flatten(message: unknown): unknown {
  if (message === null || typeof message !== "object" || Array.isArray(message)) return message;

  const { msg, message: text, ...fields } = message as Record<string, unknown>;
  const head = msg ?? text;
  const pairs = Object.entries(fields).map(([key, value]) => `${key}=${render(value)}`);

  // Not one of ours: let ConsoleLogger print the object as it always did.
  if (head === undefined) return message;
  const title = typeof head === "string" ? head : JSON.stringify(head);
  return [title, ...pairs].join(" ");
}

function render(value: unknown): string {
  if (typeof value === "string") return value.includes(" ") ? JSON.stringify(value) : value;
  if (value instanceof Date) return value.toISOString();
  if (value === null || typeof value !== "object") return String(value);
  return JSON.stringify(value);
}
