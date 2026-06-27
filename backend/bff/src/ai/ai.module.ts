import { Module } from "@nestjs/common";
import { ProductsModule } from "../products/products.module";
import { AiOrchestratorService } from "./ai-orchestrator.service";
import { ChatModelService } from "./chat-model.service";
import { RetrievalService } from "./retrieval.service";

@Module({
  imports: [ProductsModule],
  providers: [AiOrchestratorService, ChatModelService, RetrievalService],
  exports: [AiOrchestratorService],
})
export class AiModule {}
