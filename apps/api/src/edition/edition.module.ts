import { Module } from "@nestjs/common";
import { EditionController } from "./edition.controller";
import { EditionService } from "./edition.service";

@Module({ controllers: [EditionController], providers: [EditionService] })
export class EditionModule {}
