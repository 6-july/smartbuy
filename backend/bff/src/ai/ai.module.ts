import { Module } from "@nestjs/common";
import { ProductsModule } from "../products/products.module";
import { AiOrchestratorService } from "./ai-orchestrator.service";
import { ChatModelService } from "./chat-model.service";
import { GuideGraphService } from "./graph/guide-graph.service";
import { QueryMerchantInfoService } from "./graph/tools/query-merchant-info.service";
import { QueryProductsService } from "./graph/tools/query-products.service";
import { RetrievalService } from "./retrieval.service";

@Module({
  imports: [ProductsModule],
  providers: [
    AiOrchestratorService,
    ChatModelService,
    RetrievalService,
    GuideGraphService,
    QueryMerchantInfoService,
    QueryProductsService,
  ],
  exports: [AiOrchestratorService],
})
export class AiModule {}
