import { Injectable } from "@nestjs/common";
import {
  buildDeterministicReply,
  ChatMessage,
  getCandidatePriceOptions,
  isContextualFollowUp,
  isProductDetailFollowUp,
  ProductCandidate,
  RecentProductReference,
  resolveReferencedProductIds,
  sanitizeGuideReply,
} from "./domain";
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
    recentProducts?: RecentProductReference[];
  }): Promise<{ reply: string; products: RetrievedProduct[] }> {
    const recentProducts = input.recentProducts || [];
    const contextualFollowUp = isContextualFollowUp(
      input.question,
      recentProducts.length > 0,
    );
    const productDetailFollowUp = isProductDetailFollowUp(
      input.question,
      recentProducts.length > 0,
    );
    const intentType = classifyIntent(input.question, contextualFollowUp);

    if (intentType === "contact") {
      return {
        reply: input.merchant.phone
          ? `我们的客服电话是 ${input.merchant.phone}，有任何问题都可以拨打咨询哦～`
          : "暂时没有配置客服电话，建议您直接联系店铺客服确认哦～",
        products: [],
      };
    }

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

    const preferredProductIds = contextualFollowUp
      ? resolveReferencedProductIds(input.question, recentProducts)
      : [];
    const referencedProducts = recentProducts.filter((product) =>
      preferredProductIds.includes(product.id),
    );
    if (productDetailFollowUp && isRealtimeProductDetail(input.question)) {
      if (referencedProducts.length > 1) {
        return {
          reply: "你指的是上面哪一款商品呢？可以告诉我是第几款，我再帮你确认。",
          products: [],
        };
      }
      return {
        reply: buildRealtimeDetailReply(
          input.question,
          referencedProducts[0]?.name,
          input.merchant.phone,
        ),
        products: [],
      };
    }
    const intent = await this.intentParser.parse(
      input.question,
      input.history,
      contextualFollowUp,
      recentProducts,
    );
    if (contextualFollowUp && intent.queryText === input.question.trim()) {
      const names = referencedProducts.map((product) => product.name);
      intent.queryText = [...names, input.question.trim()].join(" ");
      intent.keywords = [...new Set([...names, ...intent.keywords])];
    }
    const [retrieved, totalProducts, categories] = await Promise.all([
      productDetailFollowUp
        ? this.retrieval.findByIds(input.merchant.id, preferredProductIds)
        : this.retrieval.search(
            input.merchant.id,
            intent,
            preferredProductIds,
          ),
      this.retrieval.countProducts(input.merchant.id),
      this.retrieval.listCategories(input.merchant.id),
    ]);
    const requestedCount = extractRequestedProductCount(input.question);
    const candidatePool = retrieved.slice(0, requestedCount || 5);
    const candidates = candidatePool.map((item) => item.candidate);
    if (candidates.length === 0) {
      return {
        reply: buildNoCandidateReply(input.question, input.merchant, intent),
        products: [],
      };
    }
    if (productDetailFollowUp) {
      const detailReply = buildProductDetailReply(
        input.question,
        candidates,
        input.merchant.phone,
      );
      if (detailReply) return { reply: detailReply, products: [] };
    }
    let rawReply;
    try {
      rawReply = await this.chat.reply(
        input.merchant,
        contextualFollowUp ? intent.queryText : input.question,
        input.history,
        candidates,
        totalProducts,
        intent,
        categories,
      );
    } catch (err) {
      console.error("[AiOrchestrator] chat.reply failed:", err);
      const industry = input.merchant.industry || "商品";
      rawReply = productDetailFollowUp
        ? {
            reply: buildUnknownDetailReply(candidates[0]?.title, input.merchant.phone),
            productIds: [],
          }
        : candidates.length > 0
        ? buildDeterministicReply(candidates, intent)
        : { reply: `不好意思，我刚刚走了一下神～您想了解什么${industry}呢？可以告诉我口味、预算或者用途，我来帮您推荐哦！😊`, productIds: [] };
    }
    const reply = sanitizeGuideReply(rawReply, candidates);
    if (productDetailFollowUp) {
      return { reply: reply.reply, products: [] };
    }
    const mentioned = candidates
      .map((candidate) => ({
        candidate,
        index: findMentionIndex(candidate.title, reply.reply),
      }))
      .filter((item) => item.index >= 0)
      .sort((left, right) => left.index - right.index)
      .map((item) => item.candidate);
    if (mentioned.length > 0) {
      reply.productIds = mentioned.map((candidate) => candidate.id);
    }
    const selected = new Set(reply.productIds);
    const selectedCandidates = candidates.filter((candidate) => selected.has(candidate.id));
    const finalReply = isGenericReply(reply.reply) && selectedCandidates.length > 0
      ? buildDeterministicReply(selectedCandidates, intent).reply
      : reply.reply;
    const productsById = new Map(candidatePool.map((item) => [item.row.id, item]));
    return {
      reply: finalReply,
      products: reply.productIds.flatMap((id) => {
        const product = productsById.get(id);
        return product ? [product] : [];
      }),
    };
  }
}

function buildNoCandidateReply(
  question: string,
  merchant: { phone?: string | null; industry?: string },
  intent: { priceMin: number | null; priceMax: number | null },
): string {
  if (/电话|联系|客服|配送|送达|发货|库存|地址|营业|原料|成分|过敏|保质期/.test(question)) {
    return merchant.phone
      ? `这个我不太确定，建议您拨打客服电话 ${merchant.phone} 咨询哦～`
      : "这个我不太确定，建议您直接联系店铺客服确认哦～";
  }

  const industry = merchant.industry || "商品";
  if (intent.priceMin !== null && intent.priceMax !== null) {
    return `暂时没有找到${formatAmount(intent.priceMin)}到${formatAmount(intent.priceMax)}之间符合要求的${industry}，可以调整预算或换个关键词试试哦。`;
  }
  if (intent.priceMax !== null) {
    return `暂时没有找到${formatAmount(intent.priceMax)}以内符合要求的${industry}，可以提高预算或换个关键词试试哦。`;
  }
  if (intent.priceMin !== null) {
    return `暂时没有找到${formatAmount(intent.priceMin)}以上符合要求的${industry}，可以调整预算或换个关键词试试哦。`;
  }
  return `暂时没有找到符合要求的${industry}，可以换个口味、类型或关键词试试哦。`;
}

function formatAmount(value: number): string {
  return Number.isInteger(value) ? `${value}元` : `${value.toFixed(2)}元`;
}

function coreName(title: string): string {
  return title
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/【[^】]*】/g, "")
    .trim();
}

function findMentionIndex(title: string, text: string): number {
  const exactIndex = text.indexOf(title);
  if (exactIndex >= 0) return exactIndex;
  const core = coreName(title);
  return core.length >= 4 ? text.indexOf(core) : -1;
}

function isRealtimeProductDetail(question: string): boolean {
  return /优惠|折扣|促销|活动|库存|有货|现货/.test(question);
}

function buildRealtimeDetailReply(
  question: string,
  productName: string | undefined,
  phone?: string | null,
): string {
  const subject = productName ? `「${productName}」` : "这款商品";
  const detail = /库存|有货|现货/.test(question) ? "实时库存" : "实时优惠活动";
  return `${subject}的${detail}我这里暂时无法确认，${contactTip(phone)}。`;
}

function buildProductDetailReply(
  question: string,
  candidates: ProductCandidate[],
  phone?: string | null,
): string | null {
  if (candidates.length !== 1) {
    return candidates.length > 1
      ? "你指的是上面哪一款商品呢？可以告诉我是第几款，我再帮你详细看看。"
      : null;
  }

  const candidate = candidates[0];
  const priceOptions = getCandidatePriceOptions(candidate);
  if (/适合.{0,8}(?:几个人|多少人)|几个人吃|多少人吃/.test(question)) {
    const detailText = `${candidate.description || ""} ${candidate.aiText || ""}`;
    if (/\d+\s*(?:-|~|至|到)\s*\d+\s*人|适合.{0,12}\d+\s*人/.test(detailText)) {
      return null;
    }
    const specs = [...new Set(priceOptions.map((option) => option.label))];
    const specText = specs.length > 0 ? `目前可选${specs.join("、")}，但` : "";
    return `「${candidate.title}」${specText}商品资料里没有标注具体适用人数，${contactTip(phone)}。`;
  }

  if (/多少钱|价格/.test(question)) {
    if (priceOptions.length > 0) {
      return `「${candidate.title}」的价格是：${priceOptions
        .map((option) => `${option.label} ¥${formatPrice(option.price)}`)
        .join("、")}。`;
    }
    return `「${candidate.title}」参考价 ¥${formatPrice(candidate.displayPrice)}。`;
  }

  if (/规格|尺寸|几寸/.test(question) && priceOptions.length > 0) {
    return `「${candidate.title}」目前有${priceOptions
      .map((option) => `${option.label}（¥${formatPrice(option.price)}）`)
      .join("、")}可选。`;
  }

  return null;
}

function buildUnknownDetailReply(
  productName: string | undefined,
  phone?: string | null,
): string {
  const subject = productName ? `「${productName}」的这个信息` : "这个信息";
  return `${subject}我暂时无法确认，${contactTip(phone)}。`;
}

function contactTip(phone?: string | null): string {
  return phone
    ? `建议拨打客服电话 ${phone} 向店铺确认`
    : "建议直接联系店铺客服确认";
}

function formatPrice(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

type IntentType = "contact" | "chitchat" | "product_inquiry";

function classifyIntent(question: string, contextualFollowUp = false): IntentType {
  const q = question.trim();
  if (contextualFollowUp) return "product_inquiry";
  if (/电话|联系方式|客服热线|客服号码|怎么联系|如何联系|联系你们|联系店铺/.test(q)) {
    return "contact";
  }
  if (/天气|下雨|晴天|阴天|刮风|心情|聊聊天|哈哈|开心|难过/.test(q)) {
    return "chitchat";
  }
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

function extractRequestedProductCount(question: string): number | null {
  const match = question.match(/(?:只\s*)?(?:推荐|介绍|看看|来|选)\s*([一二三四五]|[1-5])\s*[款个]/);
  if (!match) return null;
  const chineseNumbers: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5 };
  return chineseNumbers[match[1]] || Number(match[1]);
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
