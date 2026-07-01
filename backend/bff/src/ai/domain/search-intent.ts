import { SearchIntent } from "./types";

const STOP_WORDS = new Set([
  "我",
  "想",
  "要",
  "有",
  "没有",
  "什么",
  "推荐",
  "一下",
  "一个",
  "一些",
  "的",
  "吗",
  "呢",
  "可以",
  "看看",
  "商品",
]);

function parseAmount(raw: string): number | null {
  if (!raw.trim()) return null;
  const amount = Number(raw);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

export function parseSearchIntent(queryText: string): SearchIntent {
  const normalized = queryText.trim();
  const maxMatch = normalized.match(
    /(?:不超过|最多|低于)\s*(\d+(?:\.\d+)?)\s*元?|(?:\d+(?:\.\d+)?)\s*元?\s*(?:以内|以下)/,
  );
  const minMatch = normalized.match(
    /(?:不少于|至少|高于)\s*(\d+(?:\.\d+)?)\s*元?|(?:\d+(?:\.\d+)?)\s*元?\s*以上/,
  );
  const maxAmount = maxMatch?.[1] ?? maxMatch?.[0]?.match(/\d+(?:\.\d+)?/)?.[0];
  const minAmount = minMatch?.[1] ?? minMatch?.[0]?.match(/\d+(?:\.\d+)?/)?.[0];
  const budgetMatch = normalized.match(/(\d+(?:\.\d+)?)\s*元\s*(?:左右|预算)/);
  const priceMax = parseAmount(maxAmount ?? budgetMatch?.[1] ?? "");
  const priceMin = parseAmount(minAmount ?? "");

  const withoutPrices = normalized
    .replace(/\d+(?:\.\d+)?\s*元?/g, " ")
    .replace(/不超过|以内|以下|最多|低于|不少于|以上|至少|高于|左右|预算/g, " ")
    .replace(/推荐一下|推荐|有什么|有没有|想要|我想|可以|看看|吗|呢/g, " ")
    .replace(/的/g, " ")
    .replace(/[，。！？、,.!?]/g, " ");
  const keywords = withoutPrices
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2 && !STOP_WORDS.has(word));

  return {
    queryText: normalized,
    keywords: [...new Set(keywords)],
    priceMin,
    priceMax,
    needRecommendation: /推荐|哪个好|有什么|怎么选/.test(normalized),
  };
}
