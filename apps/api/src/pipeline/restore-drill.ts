import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { CloudWatchClient, PutMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { Injectable, Logger } from "@nestjs/common";
import { Effect } from "effect";
import type { Config } from "../config";
import { BACKUP_PREFIX } from "./backup";
import { OwnerAlert } from "./owner-alert";

// The monthly proof that the backup restores, as a job of the production jobs function
// (deploy/aws/lambda.tf) — what deploy/restore-drill.sh did on the EC2 with a throwaway container.
// The latest dump goes into a database of its own on the production Neon branch, the subscribers it
// brought back are counted, and the database is dropped: the subscriber list never leaves the
// server that already holds it, and the restore is tried where a real one would land.
//
// pg_restore, createdb, dropdb and psql come from the image (postgresql16-client). Only the
// function whose environment sets BACKUP_BUCKET has dumps to read.

const run = promisify(execFile);
export const DRILL_DATABASE = "argon_restore_drill";

// The same server and credentials, another database. Refuses a URL that already names the drill's
// database, so a misconfigured DATABASE_URL can never become the database the drill drops.
export function drillUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  if (url.pathname.replace(/^\//, "") === DRILL_DATABASE) {
    throw new Error(`DATABASE_URL already names ${DRILL_DATABASE}`);
  }
  url.pathname = `/${DRILL_DATABASE}`;
  return url.toString();
}

// The newest dump by its stamp, which is its name (backupKey): ISO time sorts as text.
export function latestKey(keys: readonly string[]): string | undefined {
  return keys
    .filter((key) => key.startsWith(`${BACKUP_PREFIX}/`) && key.endsWith(".dump"))
    .sort()
    .at(-1);
}

@Injectable()
export class RestoreDrillJob {
  private readonly logger = new Logger(RestoreDrillJob.name);
  private readonly s3 = new S3Client({});
  private readonly cloudwatch = new CloudWatchClient({});

  constructor(
    private readonly config: Pick<Config, "BACKUP_BUCKET" | "DATABASE_URL">,
    private readonly alert: OwnerAlert,
  ) {}

  // A failure alerts the owners and leaves no metric. The drill's database is dropped before and
  // after, so a drill that died halfway leaves nothing behind for long and never blocks the next.
  async run(): Promise<number | undefined> {
    const bucket = this.config.BACKUP_BUCKET;
    if (!bucket) {
      this.logger.error({ msg: "restore drill failed", reason: "BACKUP_BUCKET is not set here" });
      return undefined;
    }
    const source = this.config.DATABASE_URL;
    // Both URLs carry the password: an error that quotes either is logged and mailed without it.
    const scrub = (text: string) =>
      [source, ...attempt(() => drillUrl(source))].reduce((t, url) => t.replaceAll(url, "<url>"), text);
    const dir = await mkdtemp(path.join(tmpdir(), "restore-drill-"));
    const file = path.join(dir, "argon_prod.dump");
    let key: string | undefined;
    try {
      const target = drillUrl(source);
      key = latestKey(await this.keys(bucket));
      if (!key) throw new Error(`no dump under ${BACKUP_PREFIX}/`);
      const object = await this.s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      await writeFile(
        file,
        await (object.Body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray(),
      );

      await this.drop(source);
      await run("createdb", [`--maintenance-db=${source}`, DRILL_DATABASE]);
      // Neon owns the objects with its own roles and grants to them: --no-owner and --no-privileges
      // restore everything as the connecting role, which is all a count needs.
      await run("pg_restore", ["--no-owner", "--no-privileges", "--exit-on-error", `--dbname=${target}`, file], {
        timeout: 10 * 60_000,
      });
      const { stdout } = await run("psql", [
        target,
        "-v",
        "ON_ERROR_STOP=1",
        "-tAX",
        "-c",
        "select count(*) from subscriber",
      ]);
      const count = Number(stdout.trim());
      await this.cloudwatch.send(
        new PutMetricDataCommand({ Namespace: "Argon", MetricData: [{ MetricName: "RestoreDrillOk", Value: 1 }] }),
      );
      this.logger.log({ msg: "restore drill finished", key, subscribers: count });
      return count;
    } catch (error) {
      const reason = scrub(error instanceof Error ? error.message : String(error));
      this.logger.error({ msg: "restore drill failed", key, reason });
      await Effect.runPromise(this.alert.send("restore-drill", reason));
      return undefined;
    } finally {
      await this.drop(source).catch((error: unknown) =>
        this.logger.error({
          msg: "restore drill left its database",
          reason: error instanceof Error ? error.name : "unknown",
        }),
      );
      await rm(dir, { recursive: true, force: true });
    }
  }

  private async keys(bucket: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const page = await this.s3.send(
        new ListObjectsV2Command({ Bucket: bucket, Prefix: `${BACKUP_PREFIX}/`, ContinuationToken: token }),
      );
      for (const object of page.Contents ?? []) if (object.Key) keys.push(object.Key);
      token = page.NextContinuationToken;
    } while (token);
    return keys;
  }

  // --force ends a session a dead drill left open, so the drop never waits on it.
  private async drop(source: string): Promise<void> {
    await run("dropdb", [`--maintenance-db=${source}`, "--if-exists", "--force", DRILL_DATABASE]);
  }
}

function attempt<T>(f: () => T): T[] {
  try {
    return [f()];
  } catch {
    return [];
  }
}
