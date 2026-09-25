import { describe, expect, it } from "vitest";
import { patchBody } from "./settings.controller";

const issues = (body: unknown) => {
  const result = patchBody.safeParse(body);
  return result.success ? [] : result.error.issues.map((i) => i.path.join("."));
};

describe("the settings body", () => {
  it("takes a value the key's own schema accepts", () => {
    expect(patchBody.safeParse({ key: "score_cutoff", value: 2.5 }).success).toBe(true);
    expect(patchBody.safeParse({ key: "sending_paused", value: true }).success).toBe(true);
  });

  it("refuses a value the key's own schema rejects, and says it was the value", () => {
    expect(issues({ key: "score_cutoff", value: 9 })).toEqual(["value"]);
    expect(issues({ key: "min_articles", value: 0 })).toEqual(["value"]);
    expect(issues({ key: "owner_emails", value: ["not an address"] })).toEqual(["value.0"]);
  });

  it("refuses a key that is not a setting", () => {
    expect(issues({ key: "database_url", value: "postgres://" })).toEqual(["key"]);
  });
});
