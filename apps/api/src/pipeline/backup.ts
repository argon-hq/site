import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { CloudWatchClient, PutMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Injectable, Logger } from "@nestjs/common";
import { Effect } from "effect";
import type { Config } from "../config";
import { OwnerAlert } from "./owner-alert";

// The nightly dump of the production database, as a job of the Lambda that runs the day's jobs
// (deploy/aws/lambda.tf) — what deploy/backup-db.sh did on the EC2. Production lives on Neon, whose
// own restore reaches 6 hours back on the Free plan; this covers a bad migration or a wrong delete
// noticed the next day, and the Neon project going away. Same key prefix and same metric as the
// script, so the bucket's lifecycle rule, the restore drill and the argon-backup-missing alarm stay
// as they are.
//
// pg_dump comes from the image (postgresql16-client, apps/api/Dockerfile), the major Neon runs.
// Only the function whose environment sets BACKUP_BUCKET dumps anything.

const run = promisify(execFile);
export const BACKUP_PREFIX = "postgres/argon_prod";

export function backupKey(now: Date): string {
  const stamp = now
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/:/g, "-");
  return `${BACKUP_PREFIX}/${stamp}.dump`;
}

@Injectable()
export class BackupJob {
  private readonly logger = new Logger(BackupJob.name);
  private readonly s3 = new S3Client({});
  private readonly cloudwatch = new CloudWatchClient({});

  constructor(
    private readonly config: Pick<Config, "BACKUP_BUCKET" | "DATABASE_URL">,
    private readonly alert: OwnerAlert,
  ) {}

  // A failure alerts the owners and leaves no metric, so the alarm notices too. The dump lands in
  // /tmp first: a pg_dump that dies halfway uploads nothing, instead of a truncated object that
  // looks like a backup until the day someone restores it.
  async run(now: Date = new Date()): Promise<void> {
    const bucket = this.config.BACKUP_BUCKET;
    if (!bucket) {
      this.logger.error({ msg: "backup failed", reason: "BACKUP_BUCKET is not set here" });
      return;
    }
    const dir = await mkdtemp(path.join(tmpdir(), "backup-"));
    const file = path.join(dir, "argon_prod.dump");
    const key = backupKey(now);
    try {
      await run("pg_dump", ["--format=custom", `--file=${file}`, `--dbname=${this.config.DATABASE_URL}`], {
        timeout: 10 * 60_000,
      });
      const { size } = await stat(file);
      await this.s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: await readFile(file) }));
      await this.cloudwatch.send(
        new PutMetricDataCommand({ Namespace: "Argon", MetricData: [{ MetricName: "BackupOk", Value: 1 }] }),
      );
      this.logger.log({ msg: "backup finished", key, bytes: size });
    } catch (error) {
      const reason = error instanceof Error ? error.message.replace(this.config.DATABASE_URL, "<url>") : String(error);
      this.logger.error({ msg: "backup failed", key, reason });
      await Effect.runPromise(this.alert.send("backup", reason));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
