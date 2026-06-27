import { GuideReply, ProductCandidate } from "./types";

export function buildDeterministicReply(candidates: ProductCandidate[]): GuideReply {
  if (candidates.length === 0) {
    return {
      reply: "暂时没有找到相关商品，你可以换个关键词试试。",
      productIds: [],
    };
  }

  return {
    reply: "找到了一些比较匹配的商品，你可以看看：",
    productIds: candidates.slice(0, 3).map((item) => item.id),
  };
}

export function sanitizeGuideReply(
  reply: GuideReply,
  candidates: ProductCandidate[],
): GuideReply {
  const allowed = new Set(candidates.map((item) => item.id));
  return {
    reply: reply.reply.trim() || "下面这些商品可以看看：",
    productIds: [...new Set(reply.productIds)].filter((id) => allowed.has(id)).slice(0, 5),
  };
}
