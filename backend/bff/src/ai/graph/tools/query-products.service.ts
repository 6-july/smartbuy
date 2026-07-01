import { Injectable } from "@nestjs/common";
import {
  getCandidatePriceOptions,
  isContextualFollowUp,
  isProductDetailFollowUp,
  parseSearchIntent,
  RecentProductReference,
  resolveReferencedProductIds,
} from "../../domain";
import { RetrievedProduct, RetrievalService } from "../../retrieval.service";
import { ProductContext } from "../guide-state";
import {
  QueryProductItem,
  QueryProductsExecutionInput,
  QueryProductsExecutor,
  QueryProductsResult,
} from "./query-products.contract";

const MAX_TOOL_PRODUCTS = 5;

@Injectable()
export class QueryProductsService implements QueryProductsExecutor {
  constructor(private readonly retrieval: RetrievalService) {}

  async execute(input: QueryProductsExecutionInput): Promise<QueryProductsResult> {
    return this.executeInternal(input);
  }

  private async executeInternal(input: QueryProductsExecutionInput): Promise<QueryProductsResult> {
    const query = input.query.trim();
    if (!query) {
      return {
        status: "need_clarification",
        products: [],
        reason: "查询需求为空",
        clarification: { question: "你想看哪类商品呢？" },
      };
    }

    const references = toRecentProductReferences(input.products);
    const hasProducts = references.length > 0;
    const contextualFollowUp = isContextualFollowUp(query, hasProducts);
    const detailFollowUp = isProductDetailFollowUp(query, hasProducts);
    const referencedIds = contextualFollowUp
      ? resolveReferencedProductIds(query, references)
      : [];

    if (detailFollowUp && referencedIds.length > 1) {
      return {
        status: "need_clarification",
        products: [],
        reason: "商品指代不清",
        clarification: { question: "你说的是上面第几款商品呢？" },
      };
    }

    try {
      if (isUnsupportedRealtimeFact(query)) {
        const referenced = referencedIds.length > 0
          ? await this.retrieval.findByIds(input.merchantId, referencedIds)
          : [];
        return {
          status: "unsupported_fact",
          products: referenced.slice(0, MAX_TOOL_PRODUCTS).map(toQueryProductItem),
          reason: buildUnsupportedRealtimeReason(query, referencedIds[0], input.products),
        };
      }

      const retrieved = detailFollowUp && referencedIds.length === 1
        ? await this.retrieval.findByIds(input.merchantId, referencedIds)
        : await this.searchProducts(input, query, contextualFollowUp, referencedIds);
      if (retrieved.length === 0) {
        const budgetFallback = await this.buildBudgetFallbackResult(
          input,
          query,
          referencedIds,
        );
        if (budgetFallback) return budgetFallback;
      }

      const pool = shouldExcludeShown(query)
        ? retrieved.filter((item) => !input.products.shown.some((product) => product.id === item.row.id))
        : retrieved;
      const checked = applyHardConstraintGuard(query, pool);
      if (!checked.ok) return checked.result;

      const products = checked.products
        .slice(0, MAX_TOOL_PRODUCTS)
        .map(toQueryProductItem);
      if (products.length === 0) {
        return {
          status: "empty",
          products: [],
          reason: "没有找到符合条件的商品",
        };
      }

      return { status: "success", products };
    } catch (error) {
      return {
        status: "error",
        products: [],
        reason: error instanceof Error ? error.message : "商品查询失败",
      };
    }
  }

  private async searchProducts(
    input: QueryProductsExecutionInput,
    query: string,
    contextualFollowUp: boolean,
    referencedIds: string[],
  ) {
    let queryText = query;
    if (contextualFollowUp) {
      const references = toRecentProductReferences(input.products);
      const names = references
        .filter((product) => referencedIds.includes(product.id))
        .map((product) => product.name);
      if (names.length > 0) {
        queryText = [...names, query].join(" ");
      }
    }
    const intent = parseSearchIntent(queryText);
    return this.retrieval.search(input.merchantId, intent, referencedIds);
  }

  private async buildBudgetFallbackResult(
    input: QueryProductsExecutionInput,
    query: string,
    referencedIds: string[],
  ): Promise<QueryProductsResult | undefined> {
    const intent = parseSearchIntent(query);
    if (intent.priceMax === null) return undefined;

    const queryKeywords = intent.keywords.join(" ");
    const fallbackIntent = {
      ...intent,
      queryText: `最低价 ${queryKeywords || "商品"}`,
      priceMax: null,
      needRecommendation: true,
    };
    let alternatives = await this.retrieval.search(
      input.merchantId,
      fallbackIntent,
      referencedIds,
    );
    if (alternatives.length === 0) {
      alternatives = await this.retrieval.findCheapest(input.merchantId, MAX_TOOL_PRODUCTS);
    }

    const pool = shouldExcludeShown(query)
      ? alternatives.filter((item) => !input.products.shown.some((product) => product.id === item.row.id))
      : alternatives;
    const checked = applyHardConstraintGuard(query, pool);
    if (!checked.ok) return checked.result;

    const products = checked.products
      .slice(0, MAX_TOOL_PRODUCTS)
      .map(toQueryProductItem);
    if (products.length === 0) return undefined;

    const minPrice = Math.min(...products.map((product) => product.minPrice));
    return {
      status: "success",
      products,
      reason: `没有找到${formatPrice(intent.priceMax)}元以内的商品，店内价格较低的商品约${formatPrice(minPrice)}元起`,
    };
  }
}

function toRecentProductReferences(products: ProductContext): RecentProductReference[] {
  return products.shown.map((product) => ({
    id: product.id,
    name: product.title,
  }));
}

function isUnsupportedRealtimeFact(query: string): boolean {
  return /优惠|折扣|促销|活动|库存|有货|现货/.test(query);
}

function buildUnsupportedRealtimeReason(
  query: string,
  productId: string | undefined,
  products: ProductContext,
): string {
  const productName = productId
    ? products.shown.find((product) => product.id === productId)?.title
    : undefined;
  const subject = productName ? `「${productName}」` : "该商品";
  const fact = /库存|有货|现货/.test(query) ? "实时库存" : "实时优惠";
  return `${subject}的${fact}当前没有接入数据源，无法确认`;
}

function shouldExcludeShown(query: string): boolean {
  return /还有|换一?[个款]|换别的|其他|其它|另外|重新推荐|不要这|不喜欢/.test(query);
}

function applyHardConstraintGuard(
  query: string,
  retrieved: RetrievedProduct[],
): { ok: true; products: RetrievedProduct[] } | { ok: false; result: QueryProductsResult } {
  const constraints = extractHardConstraints(query);
  if (constraints.length === 0) return { ok: true, products: retrieved };

  const filtered = retrieved.filter((item) => {
    const text = productSearchText(item);
    return constraints.every((constraint) =>
      constraint.alternatives.some((alternative) => text.includes(alternative))
    );
  });
  if (filtered.length > 0) return { ok: true, products: filtered };

  const labels = constraints.map((constraint) => constraint.label);
  const reason = `没有找到明确满足${labels.join("、")}条件的商品`;
  return {
    ok: false,
    result: {
      status: constraints.length > 1 ? "constraint_conflict" : "empty",
      products: [],
      reason,
      clarification: constraints.length > 1
        ? {
            question: `暂时没有完全满足${labels.join("、")}的商品，你更想优先保留哪个条件？`,
            options: labels.map((label) => ({
              label: `${label}优先`,
              query: `${label}商品`,
            })),
          }
        : undefined,
    },
  };
}

interface HardConstraint {
  label: string;
  alternatives: string[];
}

function extractHardConstraints(query: string): HardConstraint[] {
  const constraints: HardConstraint[] = [];
  const flavors: HardConstraint[] = [
    { label: "草莓", alternatives: ["草莓"] },
    { label: "巧克力", alternatives: ["巧克力", "黑巧", "生巧", "可可", "奥利奥"] },
    { label: "芒果", alternatives: ["芒果"] },
    { label: "榴莲", alternatives: ["榴莲"] },
    { label: "抹茶", alternatives: ["抹茶"] },
    { label: "奶油", alternatives: ["奶油"] },
    { label: "水果", alternatives: ["水果"] },
  ];
  for (const flavor of flavors) {
    if (flavor.alternatives.some((alternative) => query.includes(alternative))) {
      constraints.push(flavor);
    }
  }
  const sizeMatches = query.match(/\d+\s*寸/g) || [];
  for (const size of sizeMatches) {
    const label = size.replace(/\s+/g, "");
    constraints.push({ label, alternatives: [label] });
  }
  return uniqueConstraints(constraints);
}

function uniqueConstraints(constraints: HardConstraint[]): HardConstraint[] {
  const seen = new Set<string>();
  return constraints.filter((constraint) => {
    if (seen.has(constraint.label)) return false;
    seen.add(constraint.label);
    return true;
  });
}

function productSearchText(item: RetrievedProduct): string {
  const candidate = item.candidate;
  return [
    candidate.title,
    candidate.category,
    candidate.description,
    candidate.aiText,
    JSON.stringify(candidate.tags || []),
    JSON.stringify(candidate.options || []),
  ].join(" ");
}

function toQueryProductItem(item: RetrievedProduct): QueryProductItem {
  const candidate = item.candidate;
  return {
    id: candidate.id,
    title: candidate.title,
    category: candidate.category,
    priceText: formatPriceText(candidate.minPrice, candidate.maxPrice),
    minPrice: candidate.minPrice,
    maxPrice: candidate.maxPrice,
    description: candidate.description,
    tags: candidate.tags,
    details: trimText(candidate.aiText, 900),
    priceOptions: getCandidatePriceOptions(candidate).slice(0, 6),
  };
}

function formatPriceText(minPrice: number, maxPrice: number): string {
  if (minPrice === maxPrice) return `¥${formatPrice(minPrice)}`;
  return `¥${formatPrice(minPrice)}-¥${formatPrice(maxPrice)}`;
}

function formatPrice(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function trimText(value: string, maxLength: number): string {
  const normalized = value.trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}...`
    : normalized;
}
