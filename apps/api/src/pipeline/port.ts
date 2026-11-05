import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { bindPipeline, type PipelinePort } from "../mastra/workflows/context";
import { PrismaService } from "../prisma/prisma.service";
import { deliveryStatus } from "./delivery-status";
import { editionHtml } from "./edition-html";
import { OwnerAlert } from "./owner-alert";
import { PipelineService, type SendRun, type StepRun } from "./pipeline.service";
import { WriteDataset } from "./write-dataset";

// The application as the Mastra side sees it: the workflows' steps and the Studio's tools call
// these, and nothing else. Bound when the module starts, so a run the Studio starts finds the same
// services a run from the jobs route does.
@Injectable()
export class PipelinePortAdapter implements PipelinePort, OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly pipeline: PipelineService,
    private readonly owners: OwnerAlert,
    private readonly prisma: PrismaService,
    private readonly dataset: WriteDataset,
  ) {}

  onModuleInit(): void {
    bindPipeline(this);
  }

  onModuleDestroy(): void {
    bindPipeline(undefined);
  }

  ingest = (run: StepRun) => this.pipeline.ingest(run);
  write = (run: StepRun) => this.pipeline.write(run);
  build = (run: StepRun) => this.pipeline.build(run);
  send = (run: SendRun) => this.pipeline.send(run);
  alert = (step: string, reason: string) => this.owners.send(step, reason);
  deliveryStatus = (date: string | undefined) => deliveryStatus(this.prisma, date);
  editionHtml = (date: string | undefined) => editionHtml(this.prisma, date);
  addToWriteDataset = (date: string | undefined) => this.dataset.addDay(date);
}
