import { Injectable } from "@nestjs/common";
import {
  buildDeterministicReply,
  ChatMessage,
  parseSearchIntent,
  sanitizeGuideReply,
} from "@smartbuy/ai";
import { ChatModelService } from "./chat-model.service";
import { RetrievalService, RetrievedProduct } from "./retrieval.service";

@Injectable()
export class AiOrchestratorService {
  constructor(
    private readonly retrieval: RetrievalService,
    private readonly chat: ChatModelService,
  ) {}

  async guide(input: {
    merchant: { id: string; name: string; description: string | null };
    question: string;
    history: ChatMessage[];
  }): Promise<{ reply: string; products: RetrievedProduct[] }> {
    const intent = parseSearchIntent(input.question);
    const [retrieved, totalProducts] = await Promise.all([
      this.retrieval.search(input.merchant.id, intent),
      this.retrieval.countProducts(input.merchant.id),
    ]);
    const candidates = retrieved.map((item) => item.candidate);
    let rawReply;
    try {
      rawReply = await this.chat.reply(
        input.merchant,
        input.question,
        input.history,
        candidates,
        totalProducts,
        intent,
      );
    } catch (err) {
      console.error("[AiOrchestrator] chat.reply failed:", err);
      rawReply = candidates.length > 0
        ? buildDeterministicReply(candidates, intent)
        : { reply: "不好意思，我刚刚走了一下神～您想了解什么蛋糕呢？可以告诉我口味、预算或者用途，我来帮您推荐哦！😊", productIds: [] };
    }
    const reply = sanitizeGuideReply(rawReply, candidates);
    if (reply.productIds.length === 0 && candidates.length > 0) {
      const mentioned = candidates.filter((c) => isMentioned(c.title, reply.reply));
      if (mentioned.length > 0) {
        reply.productIds = mentioned.slice(0, 5).map((c) => c.id);
      }
    }
    const selected = new Set(reply.productIds);
    const selectedCandidates = candidates.filter((candidate) => selected.has(candidate.id));
    const finalReply = isGenericReply(reply.reply) && selectedCandidates.length > 0
      ? buildDeterministicReply(selectedCandidates, intent).reply
      : reply.reply;
    return {
      reply: finalReply,
      products: retrieved.filter((item) => selected.has(item.row.id)),
    };
  }
}

function coreName(title: string): string {
  return title
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/【[^】]*】/g, "")
    .trim();
}

function isMentioned(title: string, text: string): boolean {
  if (text.includes(title)) return true;
  const core = coreName(title);
  return core.length >= 4 && text.includes(core);
}

function isGenericReply(reply: string): boolean {
  const normalized = reply.replace(/\s/g, "");
  return (
    normalized.length <= 28 ||
    /找到.*匹配.*商品/.test(normalized) ||
    /可以看看/.test(normalized) ||
    /下面这些商品/.test(normalized)
  );
}
