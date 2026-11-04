import { describe, expect, it } from "vitest";
import { BACKUP_PREFIX, backupKey } from "./backup";

describe("the backup key", () => {
  it("keeps the prefix and the stamp the EC2 script used", () => {
    expect(backupKey(new Date("2026-11-05T06:30:22.123Z"))).toBe(`${BACKUP_PREFIX}/2026-11-05T06-30-22Z.dump`);
    expect(BACKUP_PREFIX).toBe("postgres/argon_prod");
  });
});
