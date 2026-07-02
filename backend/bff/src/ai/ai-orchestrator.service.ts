import { Injectable } from "@nestjs/common";
import { ChatMessage, RecentProductReference } from "./domain";
import { GuideGraphService, GuideTraceContext } from "./graph/guide-graph.service";
import { RetrievalService, RetrievedProduct } from "./retrieval.service";

const GUIDE_UNAVAILABLE_REPLY = "智能导购服务暂时不可用，请稍后再试。";
const GUIDE_ERROR_REPLY = "我暂时没能完成这次查询，可以换个口味、预算或商品类型再试试。";
const PRODUCT_ACTION_HINT = "有需要可以点击下方商品卡片的「查看商品」按钮查看详情并购买。";

@Injectable()
export class AiOrchestratorService {
  constructor(
    private readonly retrieval: RetrievalService,
    private readonly guideGraph: GuideGraphService,
  ) {}

  async guide(input: {
    merchant: {
      id: string;
      name: string;
      description: string | null;
      phone?: string | null;
      address?: string | null;
      industry?: string;
    };
    question: string;
    history: ChatMessage[];
    recentProducts?: RecentProductReference[];
    trace?: GuideTraceContext;
  }): Promise<{ reply: string; products: RetrievedProduct[] }> {
    if (!this.guideGraph.canRun()) {
      return { reply: GUIDE_UNAVAILABLE_REPLY, products: [] };
    }

    try {
      const graphReply = await this.guideGraph.guide(input);
      const products = graphReply.productIds.length > 0
        ? await this.retrieval.findByIds(input.merchant.id, graphReply.productIds)
        : [];
      return {
        reply: products.length > 0
          ? withProductCardActionHint(graphReply.reply)
          : stripProductCardActionHint(graphReply.reply),
        products,
      };
    } catch (error) {
      console.error("[AiOrchestrator] LangGraph guide failed:", error);
      return { reply: GUIDE_ERROR_REPLY, products: [] };
    }
  }
}

function withProductCardActionHint(reply: string): string {
  if (/查看商品|商品卡片|下方卡片/.test(reply)) return reply;
  return `${reply}\n\n${PRODUCT_ACTION_HINT}`;
}

function stripProductCardActionHint(reply: string): string {
  return reply
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && !/查看商品|商品卡片|下方卡片/.test(line))
    .join("\n")
    .trim() || reply;
}
