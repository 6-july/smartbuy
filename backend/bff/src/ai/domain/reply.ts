import { GuideReply, ProductCandidate, SearchIntent } from "./types";

export interface CandidatePriceOption {
  label: string;
  price: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function getCandidatePriceOptions(candidate: ProductCandidate): CandidatePriceOption[] {
  if (!Array.isArray(candidate.options)) return [];
  return candidate.options.flatMap((group) => {
    if (!isRecord(group) || group.type !== "price" || !Array.isArray(group.options)) return [];
    return group.options.flatMap((option) => {
      if (!isRecord(option)) return [];
      const label = String(option.name || option.label || "").trim();
      const price = toFiniteNumber(option.price);
      return label && price !== null ? [{ label, price }] : [];
    });
  });
}

function formatPrice(value: number): string {
  return Number.isInteger(value) ? `¥${value}` : `¥${value.toFixed(2)}`;
}

function matchesPriceIntent(price: number, intent: SearchIntent): boolean {
  if (intent.priceMin !== null && price < intent.priceMin) return false;
  if (intent.priceMax !== null && price > intent.priceMax) return false;
  return true;
}

function formatBudgetText(intent: SearchIntent): string {
  if (intent.priceMin !== null && intent.priceMax !== null) {
    return `${formatPrice(intent.priceMin)}-${formatPrice(intent.priceMax)}`;
  }
  if (intent.priceMax !== null) return `${formatPrice(intent.priceMax)} 以内`;
  if (intent.priceMin !== null) return `${formatPrice(intent.priceMin)} 以上`;
  return "";
}

function buildPriceAwareReply(candidates: ProductCandidate[], intent: SearchIntent): GuideReply | null {
  if (intent.priceMin === null && intent.priceMax === null) return null;
  const selected = candidates.slice(0, 3);
  if (selected.length === 0) return null;

  const lines = selected.map((candidate, index) => {
    const matchedOptions = getCandidatePriceOptions(candidate)
      .filter((option) => matchesPriceIntent(option.price, intent))
      .slice(0, 4);
    if (matchedOptions.length > 0) {
      return `${index + 1}. ${candidate.title}：${matchedOptions
        .map((option) => `${option.label} ${formatPrice(option.price)}`)
        .join("、")}`;
    }
    if (matchesPriceIntent(candidate.displayPrice, intent)) {
      return `${index + 1}. ${candidate.title}：参考价 ${formatPrice(candidate.displayPrice)}`;
    }
    return `${index + 1}. ${candidate.title}：价格区间 ${formatPrice(candidate.minPrice)}-${formatPrice(candidate.maxPrice)}，可以点商品卡查看具体规格`;
  });

  return {
    reply: `按你的${formatBudgetText(intent)}预算，可以优先看这些选择：\n${lines.join("\n")}`,
    productIds: selected.map((item) => item.id),
  };
}

export function buildDeterministicReply(
  candidates: ProductCandidate[],
  intent?: SearchIntent,
): GuideReply {
  if (candidates.length === 0) {
    return {
      reply: "暂时没有找到相关商品，你可以换个关键词试试。",
      productIds: [],
    };
  }

  const priceAwareReply = intent ? buildPriceAwareReply(candidates, intent) : null;
  if (priceAwareReply) return priceAwareReply;

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
