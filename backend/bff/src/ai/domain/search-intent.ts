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
  "蛋糕",
  "口味",
  "味道",
  "风味",
  "款",
]);

const FLAVOR_KEYWORDS = ["草莓", "巧克力", "芒果", "榴莲", "抹茶", "奶油", "水果"];
const MONEY_AMOUNT_PATTERN = "(\\d+(?:\\.\\d+)?)\\s*(?:元|块钱?|块)";

function parseAmount(raw: string): number | null {
  if (!raw.trim()) return null;
  const amount = Number(raw);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function firstAmount(match: RegExpMatchArray | null): string {
  return match?.slice(1).find(Boolean) ?? "";
}

export function parseSearchIntent(queryText: string): SearchIntent {
  const normalized = queryText.trim();
  const maxMatch = normalized.match(
    new RegExp(
      `(?:不超过|最多|低于|不高于)\\s*${MONEY_AMOUNT_PATTERN}`
      + `|${MONEY_AMOUNT_PATTERN}\\s*(?:以内|以下)`
      + `|(?:预算|只有|只剩)\\s*${MONEY_AMOUNT_PATTERN}`,
    ),
  );
  const minMatch = normalized.match(
    new RegExp(
      `(?:不少于|至少|高于|不低于)\\s*${MONEY_AMOUNT_PATTERN}`
      + `|${MONEY_AMOUNT_PATTERN}\\s*以上`,
    ),
  );
  const budgetMatch = normalized.match(
    new RegExp(
      `${MONEY_AMOUNT_PATTERN}\\s*(?:左右|预算)`
      + `|预算\\s*(\\d+(?:\\.\\d+)?)`,
    ),
  );
  const priceMax = parseAmount(firstAmount(maxMatch) || firstAmount(budgetMatch));
  const priceMin = parseAmount(firstAmount(minMatch));

  const withoutPrices = normalized
    .replace(/\d+(?:\.\d+)?\s*(?:元|块钱?|块)/g, " ")
    .replace(/不超过|以内|以下|最多|低于|不高于|不少于|以上|至少|高于|不低于|左右|预算|只有|只剩/g, " ")
    .replace(/推荐一下|推荐|有什么|有没有|想要|我想|可以|看看|吗|呢/g, " ")
    .replace(/口味|味道|风味/g, " ")
    .replace(/的/g, " ")
    .replace(/[，。！？、,.!?]/g, " ");
  const flavorKeywords = FLAVOR_KEYWORDS.filter((flavor) => normalized.includes(flavor));
  const looseKeywords = withoutPrices
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2 && !STOP_WORDS.has(word))
    .filter((word) => !flavorKeywords.some((flavor) => word.includes(flavor)));
  const keywords = [...flavorKeywords, ...looseKeywords];

  return {
    queryText: normalized,
    keywords: [...new Set(keywords)],
    priceMin,
    priceMax,
    needRecommendation: /推荐|哪个好|有什么|怎么选/.test(normalized),
  };
}
