import { Injectable } from "@nestjs/common";
import {
  SelectProductsExecutionInput,
  SelectProductsExecutor,
  SelectProductsResult,
} from "./select-products.contract";
import { normalizeGuideReply } from "../guide-reply-format";
import { ProductSnapshot } from "../guide-state";
import { normalizeProductText, productTitleMatchIndex } from "../product-text";

@Injectable()
export class SelectProductsService implements SelectProductsExecutor {
  async execute(input: SelectProductsExecutionInput): Promise<SelectProductsResult> {
    const sizeResult = buildSizeExtremeResult(input);
    if (sizeResult) return sizeResult;

    const reply = normalizeGuideReply(input.reply);
    const deliveryResult = buildDeliveryUnsupportedResult(input);
    if (deliveryResult) return deliveryResult;

    const explicitProductIds = uniqueIds(input.productIds);
    const productIds = (
      explicitProductIds.length > 0
        ? explicitProductIds
        : shouldAttachCards(input.answerType)
          ? uniqueIds(productIdsMentionedInReply(reply, input.products.items))
          : []
    ).slice(0, MAX_SELECTED_PRODUCTS);
    if (productIds.length === 0) {
      return {
        status: "empty",
        products: [],
        reply,
        productIds: [],
        answerType: emptyAnswerType(input.answerType),
        reason: "未选择任何商品",
      };
    }

    const productById = new Map(input.products.items.map((product) => [product.id, product]));
    const currentProductById = new Map(
      input.currentProducts.items.map((product) => [product.id, product]),
    );
    const selected = productIds.flatMap((id) => {
      const product = productById.get(id) || currentProductById.get(id);
      return product ? [product] : [];
    });
    const invalidProductIds = productIds.filter((id) =>
      !productById.has(id) && !currentProductById.has(id)
    );

    if (selected.length === 0) {
      return {
        status: "invalid",
        products: [],
        reply: "我暂时没能确认到可展示的商品，可以换个口味、预算或商品类型再试试。",
        productIds: [],
        answerType: "no_match",
        invalidProductIds,
        reason: "选择的商品ID不在当前商品池中",
      };
    }

    return {
      status: invalidProductIds.length > 0 ? "invalid" : "success",
      products: selected,
      reply,
      productIds: selected.map((product) => product.id),
      answerType: input.answerType,
      invalidProductIds: invalidProductIds.length > 0 ? invalidProductIds : undefined,
      reason: input.reason,
    };
  }
}

const MAX_SELECTED_PRODUCTS = 5;
const MAX_DELIVERY_FALLBACK_PRODUCTS = 3;

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

function shouldAttachCards(input: SelectProductsExecutionInput["answerType"]): boolean {
  return (
    input === "recommendation" ||
    input === "product_detail" ||
    input === "unsupported_fact"
  );
}

function emptyAnswerType(
  input: SelectProductsExecutionInput["answerType"],
): SelectProductsResult["answerType"] {
  if (input === "clarification" || input === "product_overview") return input;
  return "no_match";
}

function productIdsMentionedInReply(reply: string, products: ProductSnapshot[]): string[] {
  const normalizedReply = normalizeProductText(reply);
  return products
    .map((product) => ({
      id: product.id,
      index: productTitleMatchIndex(normalizedReply, product.title),
    }))
    .filter((item) => item.index < Number.POSITIVE_INFINITY)
    .sort((left, right) => left.index - right.index)
    .map((item) => item.id);
}

function buildDeliveryUnsupportedResult(
  input: SelectProductsExecutionInput,
): SelectProductsResult | undefined {
  const question = input.question?.trim() || "";
  if (!isDeliveryQuestion(question) || input.productIds.length > 0) return undefined;

  const preferredProducts = selectProductsByPreference(
    question,
    input.products.items,
    MAX_DELIVERY_FALLBACK_PRODUCTS,
  );
  const products = preferredProducts.length > 0
    ? preferredProducts
    : input.currentProducts.items.slice(0, MAX_DELIVERY_FALLBACK_PRODUCTS);
  if (products.length === 0) return undefined;

  return {
    status: "success",
    products,
    reply: buildDeliveryUnsupportedReply(products, preferredProducts.length > 0),
    productIds: products.map((product) => product.id),
    answerType: "unsupported_fact",
    reason: "配送或送达能力暂时无法确认，保留相关商品供用户查看",
  };
}

function isDeliveryQuestion(question: string): boolean {
  return /(送过来|送来|配送|送货|外送|送到|送达|能送|可以送|邮寄|快递|到家)/.test(question);
}

function selectProductsByPreference(
  question: string,
  products: ProductSnapshot[],
  limit: number,
): ProductSnapshot[] {
  const keywords = preferenceKeywords(question);
  if (keywords.length === 0) return [];
  return products
    .map((product) => ({ product, score: productPreferenceScore(product, keywords) }))
    .filter((item) => item.score > 0)
    .sort((left, right) =>
      right.score - left.score ||
      (right.product.minPrice || 0) - (left.product.minPrice || 0)
    )
    .slice(0, limit)
    .map((item) => item.product);
}

function preferenceKeywords(question: string): string[] {
  const groups: Array<[RegExp, string[]]> = [
    [/巧克力|黑巧|生巧|可可|梦龙/, ["巧克力", "黑巧", "生巧", "可可", "梦龙"]],
    [/水果|果味|草莓|杨梅|树莓|覆盆子|荔枝|芒果|柚子/, ["水果", "果", "草莓", "杨梅", "树莓", "覆盆子", "荔枝", "芒果", "柚子"]],
    [/抹茶/, ["抹茶"]],
    [/奥利奥/, ["奥利奥"]],
    [/奶油/, ["奶油"]],
    [/榴莲/, ["榴莲"]],
    [/长辈|老人|父母|爸妈|妈妈|爸爸/, ["送长辈", "长辈", "老人", "父母", "爸妈", "妈妈", "爸爸"]],
    [/女友|女生|女士/, ["女友", "女生", "女士", "送女神"]],
    [/男友|男生|男士/, ["男友", "男生", "男士"]],
    [/儿童|宝宝|孩子|小孩/, ["儿童", "宝宝", "孩子", "小孩"]],
  ];
  return uniqueIds(groups.flatMap(([pattern, keywords]) => pattern.test(question) ? keywords : []));
}

function productPreferenceScore(product: ProductSnapshot, keywords: string[]): number {
  const title = normalizeProductText(product.title);
  const category = normalizeProductText(product.category || "");
  const tags = normalizeProductText((product.tags || []).join(" "));
  const details = normalizeProductText([product.summary, product.details].filter(Boolean).join(" "));
  return keywords.reduce((score, keyword) => {
    const normalized = normalizeProductText(keyword);
    if (!normalized) return score;
    if (title.includes(normalized)) return score + 6;
    if (category.includes(normalized)) return score + 4;
    if (tags.includes(normalized)) return score + 3;
    if (details.includes(normalized)) return score + 1;
    return score;
  }, 0);
}

function buildDeliveryUnsupportedReply(products: ProductSnapshot[], matchedPreference: boolean): string {
  const intro = "配送/送达我这边暂时无法确认，建议在商品详情页查看下单和配送信息。";
  const productIntro = matchedPreference ? "你这个口味方向可以先看：" : "你刚才看的商品可以先确认：";
  const lines = products.map((product, index) => {
    const price = product.priceText ? ` ${product.priceText}` : "";
    return `${index + 1}. ${product.title}${price}`;
  });
  return `${intro}\n${productIntro}\n${lines.join("\n")}`;
}

type SizeMode = "max" | "min";

interface ProductSize {
  product: ProductSnapshot;
  size: number;
  price?: number;
}

function buildSizeExtremeResult(input: SelectProductsExecutionInput): SelectProductsResult | undefined {
  const question = input.question?.trim() || "";
  const mode = getSizeExtremeMode(question);
  if (!mode) return undefined;

  const sourceProducts = getSizeSearchScope(question, input);
  const ranked = sourceProducts
    .flatMap((product) => productSizeRecords(product))
    .sort((left, right) =>
      mode === "max"
        ? right.size - left.size || comparePrice(left.price, right.price)
        : left.size - right.size || comparePrice(left.price, right.price)
    );
  const best = ranked[0];
  if (!best) return undefined;

  const bestProducts = ranked
    .filter((record) => record.size === best.size)
    .filter((record, index, records) =>
      records.findIndex((item) => item.product.id === record.product.id) === index
    )
    .slice(0, 3);

  return {
    status: "success",
    products: bestProducts.map((record) => record.product),
    reply: buildSizeExtremeReply(mode, best.size, bestProducts),
    productIds: bestProducts.map((record) => record.product.id),
    answerType: "product_detail",
    reason: mode === "max" ? "按商品规格计算最大尺寸" : "按商品规格计算最小尺寸",
  };
}

function getSizeExtremeMode(question: string): SizeMode | undefined {
  if (!/(几寸|尺寸|规格|蛋糕)/.test(question)) return undefined;
  if (/最大|最大的|最大尺寸|大尺寸|最大规格/.test(question)) return "max";
  if (/最小|最小的|最小尺寸|小尺寸|最小规格/.test(question)) return "min";
  return undefined;
}

function getSizeSearchScope(
  question: string,
  input: SelectProductsExecutionInput,
): ProductSnapshot[] {
  const asksStoreWide = /你家|店里|门店|商家|全店|最大.*蛋糕|最小.*蛋糕|最大的蛋糕|最小的蛋糕/.test(question);
  const hasContextReference = /这个|这款|它|刚才|上面|前面|第\s*[一二三四五六七八九十\d]+\s*[个款]/.test(question);
  if (!asksStoreWide && hasContextReference && input.currentProducts.items.length > 0) {
    return input.currentProducts.items;
  }
  return input.products.items.length > 0 ? input.products.items : input.currentProducts.items;
}

function productSizeRecords(product: ProductSnapshot): ProductSize[] {
  const optionSizes = (product.priceOptions || []).flatMap((option) => {
    const size = parseSize(option.label);
    return size === null ? [] : [{ product, size, price: option.price }];
  });
  if (optionSizes.length > 0) return optionSizes;

  const text = [
    product.title,
    product.summary,
    product.details,
    product.tags?.join(" "),
  ].filter(Boolean).join(" ");
  const sizes = parseSizes(text);
  return sizes.map((size) => ({ product, size }));
}

function parseSize(value: string): number | null {
  const match = value.match(/(\d+(?:\.\d+)?)\s*寸/);
  if (!match) return null;
  const size = Number(match[1]);
  return Number.isFinite(size) ? size : null;
}

function parseSizes(value: string): number[] {
  const sizes: number[] = [];
  for (const match of value.matchAll(/(\d+(?:\.\d+)?)\s*寸/g)) {
    const size = Number(match[1]);
    if (Number.isFinite(size) && !sizes.includes(size)) sizes.push(size);
  }
  return sizes;
}

function comparePrice(left?: number, right?: number): number {
  if (left === undefined && right === undefined) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  return left - right;
}

function buildSizeExtremeReply(mode: SizeMode, size: number, records: ProductSize[]): string {
  const label = mode === "max" ? "最大" : "最小";
  const productText = records
    .map((record) => {
      const priceText = record.price !== undefined ? `，${formatSize(size)}寸约¥${formatPrice(record.price)}` : "";
      return `「${record.product.title}」${priceText}`;
    })
    .join("、");
  return `店里目前可选的${label}尺寸是${formatSize(size)}寸，可以看看${productText}。`;
}

function formatSize(size: number): string {
  return Number.isInteger(size) ? String(size) : size.toFixed(1);
}

function formatPrice(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
