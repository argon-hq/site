import { Module } from "@nestjs/common";
import { OwnerAlert } from "./owner-alert";
import { PipelineController } from "./pipeline.controller";
import { PipelineService } from "./pipeline.service";

@Module({ controllers: [PipelineController], providers: [PipelineService, OwnerAlert] })
export class PipelineModule {}
