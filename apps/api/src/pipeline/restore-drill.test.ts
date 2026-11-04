import { describe, expect, it } from "vitest";
import { BACKUP_PREFIX } from "./backup";
import { DRILL_DATABASE, drillUrl, latestKey } from "./restore-drill";

describe("the restore drill", () => {
  it("restores into its own database on the same server", () => {
    expect(drillUrl("postgresql://owner:secret@ep-x.sa-east-1.aws.neon.tech/argon?sslmode=require")).toBe(
      `postgresql://owner:secret@ep-x.sa-east-1.aws.neon.tech/${DRILL_DATABASE}?sslmode=require`,
    );
  });

  it("never takes the database it drops from DATABASE_URL", () => {
    expect(() => drillUrl(`postgresql://owner:secret@host/${DRILL_DATABASE}`)).toThrow();
  });

  it("picks the newest production dump by its stamp", () => {
    expect(
      latestKey([
        `${BACKUP_PREFIX}/2026-11-04T06-30-22Z.dump`,
        `${BACKUP_PREFIX}/2026-11-05T06-30-02Z.dump`,
        `${BACKUP_PREFIX}/2026-10-31T06-30-11Z.dump`,
        "postgres/argon_dev/2026-12-01T00-00-00Z.dump",
      ]),
    ).toBe(`${BACKUP_PREFIX}/2026-11-05T06-30-02Z.dump`);
    expect(latestKey([])).toBeUndefined();
  });
});
