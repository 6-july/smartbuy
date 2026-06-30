import { Injectable } from "@nestjs/common";
import {
  buildDeterministicReply,
  ChatMessage,
  sanitizeGuideReply,
} from "@smartbuy/ai";
import { ChatModelService } from "./chat-model.service";
import { IntentParserService } from "./intent-parser.service";
import { RetrievalService, RetrievedProduct } from "./retrieval.service";

@Injectable()
export class AiOrchestratorService {
  constructor(
    private readonly retrieval: RetrievalService,
    private readonly chat: ChatModelService,
    private readonly intentParser: IntentParserService,
  ) {}

  async guide(input: {
    merchant: { id: string; name: string; description: string | null; phone?: string | null; industry?: string };
    question: string;
    history: ChatMessage[];
  }): Promise<{ reply: string; products: RetrievedProduct[] }> {
    const intentType = classifyIntent(input.question);

    if (intentType === "chitchat") {
      const totalProducts = await this.retrieval.countProducts(input.merchant.id);
      const categories = await this.retrieval.listCategories(input.merchant.id);
      try {
        const rawReply = await this.chat.reply(
          input.merchant,
          input.question,
          input.history,
          [],
          totalProducts,
          undefined,
          categories,
        );
        return { reply: rawReply.reply, products: [] };
      } catch {
        return { reply: "有什么可以帮您的呢？可以告诉我想找什么类型的商品哦～😊", products: [] };
      }
    }

    const intent = await this.intentParser.parse(input.question);
    const [retrieved, totalProducts, categories] = await Promise.all([
      this.retrieval.search(input.merchant.id, intent),
      this.retrieval.countProducts(input.merchant.id),
      this.retrieval.listCategories(input.merchant.id),
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
        categories,
      );
    } catch (err) {
      console.error("[AiOrchestrator] chat.reply failed:", err);
      const industry = input.merchant.industry || "商品";
      rawReply = candidates.length > 0
        ? buildDeterministicReply(candidates, intent)
        : { reply: `不好意思，我刚刚走了一下神～您想了解什么${industry}呢？可以告诉我口味、预算或者用途，我来帮您推荐哦！😊`, productIds: [] };
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

type IntentType = "chitchat" | "product_inquiry";

function classifyIntent(question: string): IntentType {
  const q = question.trim();
  if (q.length <= 1) return "chitchat";

  if (/推荐|有什么|有没有|多少钱|价格|便宜|贵|预算|想买|想要|下单|购买|哪[个款种]|什么口味|什么类型|什么样|规格|尺[寸码]|几[寸磅层]|配送|发货|库存/.test(q)) {
    return "product_inquiry";
  }

  if (/^(你好|hi|hello|嗨|哈喽|在吗|在不在|你是谁|谢谢|感谢|好的|嗯|ok|再见|拜拜|晚安|早安|你们?[几什]么时候|电话|联系方式|地址|营业|客服|怎么联系)[\s？?！!。.~～]*$/i.test(q)) {
    return "chitchat";
  }

  if (q.length <= 4 && !/[蛋糕花果肉鱼菜饭面奶茶酒]/.test(q)) {
    return "chitchat";
  }

  return "product_inquiry";
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
