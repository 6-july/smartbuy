import { Injectable } from "@nestjs/common";
import {
  SelectProductsExecutionInput,
  SelectProductsExecutor,
  SelectProductsResult,
} from "./select-products.contract";
import { normalizeGuideReply } from "../guide-reply-format";
import { ProductSnapshot } from "../guide-state";

@Injectable()
export class SelectProductsService implements SelectProductsExecutor {
  async execute(input: SelectProductsExecutionInput): Promise<SelectProductsResult> {
    const sizeResult = buildSizeExtremeResult(input);
    if (sizeResult) return sizeResult;

    const reply = normalizeGuideReply(input.reply);
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

const MAX_SELECTED_PRODUCTS = 10;

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
  return products.flatMap((product) => {
    const aliases = productTitleAliases(product.title);
    const mentioned = aliases.some((alias) => alias.length >= 2 && normalizedReply.includes(alias));
    return mentioned ? [product.id] : [];
  });
}

function productTitleAliases(title: string): string[] {
  const normalized = normalizeProductText(title);
  const withoutBadges = normalizeProductText(
    title
      .replace(/【[^】]*】/g, "")
      .replace(/\[[^\]]*]/g, "")
      .replace(/（[^）]*）/g, "")
      .replace(/\([^)]*\)/g, ""),
  );
  return uniqueIds([normalized, withoutBadges]);
}

function normalizeProductText(value: string): string {
  return value.replace(/\s+/g, "").replace(/[，。！？、,.!?*#\-—~～"'“”‘’：:]/g, "");
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
