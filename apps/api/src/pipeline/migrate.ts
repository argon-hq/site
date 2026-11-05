import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { Injectable, Logger } from "@nestjs/common";

const run = promisify(execFile);

// `prisma migrate deploy` from the image the deploy is about to roll out, as deploy.sh ran it on the
// EC2 before a new API container started. The deploy workflow moves the jobs function to the new
// image, runs this job and only then moves the API function, so the code never runs against a
// schema older than itself. The CLI and the migrations are in the image (apps/api/Dockerfile).
//
// Lambda's file system is read-only but for /tmp: the CLI's home goes there, and the update check
// stays off. A migration that fails throws, the job answers with an error, and the deploy stops
// before the API moves.
@Injectable()
export class MigrateJob {
  private readonly logger = new Logger(MigrateJob.name);

  async run(): Promise<void> {
    const { stdout } = await run("./node_modules/.bin/prisma", ["migrate", "deploy"], {
      env: { ...process.env, HOME: tmpdir(), CHECKPOINT_DISABLE: "1", PRISMA_HIDE_UPDATE_MESSAGE: "1" },
      timeout: 10 * 60_000,
    });
    this.logger.log({ msg: "migrations applied", output: stdout.trim().split("\n").slice(-3).join(" ") });
  }
}
