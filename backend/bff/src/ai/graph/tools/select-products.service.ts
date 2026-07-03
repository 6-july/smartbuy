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
    const mentionedProductIds = productIdsMentionedInReplyContext(input, reply);
    if (isProductOverviewQuestion(input.question || "") || looksLikeAssortmentOverviewReply(reply)) {
      return {
        status: "empty",
        products: [],
        reply,
        productIds: [],
        reason: "未选择任何商品",
      };
    }

    if (
      explicitProductIds.length > 0 &&
      mentionedProductIds.length === 0 &&
      !looksLikeProductCardReply(reply, input.question || "")
    ) {
      return {
        status: "empty",
        products: [],
        reply,
        productIds: [],
        reason: "回复未表达具体商品推荐或商品详情",
      };
    }

    const productIds = resolveProductIds(input, reply, explicitProductIds, mentionedProductIds)
      .slice(0, maxSelectedProducts(input, reply));
    if (productIds.length === 0) {
      return {
        status: "empty",
        products: [],
        reply,
        productIds: [],
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
    const invalidProductIds = uniqueIds([...productIds, ...explicitProductIds].filter((id) =>
      !productById.has(id) && !currentProductById.has(id)
    ));

    if (selected.length === 0) {
      return {
        status: "invalid",
        products: [],
        reply: "我暂时没能确认到可展示的商品，可以换个口味、预算或商品类型再试试。",
        productIds: [],
        invalidProductIds,
        reason: "选择的商品ID不在当前商品池中",
      };
    }

    const orderedSelected = explicitProductIds.length > 0
      ? selected
      : orderProductsByReply(reply, selected);

    return {
      status: invalidProductIds.length > 0 ? "invalid" : "success",
      products: orderedSelected,
      reply,
      productIds: orderedSelected.map((product) => product.id),
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

function productIdsMentionedInReplyContext(
  input: SelectProductsExecutionInput,
  reply: string,
): string[] {
  return uniqueIds([
    ...productIdsMentionedInReply(reply, input.products.items),
    ...productIdsMentionedInReply(reply, input.currentProducts.items),
  ]);
}

function inferProductIds(
  input: SelectProductsExecutionInput,
  reply: string,
  mentionedProductIds = productIdsMentionedInReplyContext(input, reply),
): string[] {
  const ids = uniqueIds(mentionedProductIds);
  if (ids.length > 0) return ids;
  if (input.currentProducts.focusedId && shouldUseFocusedProduct(input.question || "", reply)) {
    return [input.currentProducts.focusedId];
  }
  return [];
}

function resolveProductIds(
  input: SelectProductsExecutionInput,
  reply: string,
  explicitProductIds: string[],
  mentionedProductIds: string[],
): string[] {
  return explicitProductIds.length > 0
    ? explicitProductIds
    : inferProductIds(input, reply, mentionedProductIds);
}

function maxSelectedProducts(
  input: SelectProductsExecutionInput,
  _reply: string,
): number {
  if (isSingleProductCardQuestion(input.question || "")) return 1;
  return asksForSingleProduct(input.question || "") ? 1 : MAX_SELECTED_PRODUCTS;
}

function asksForSingleProduct(question: string): boolean {
  return /(?:推荐|选|挑|找|看)?\s*(?:一|1)\s*[个款]|就\s*(?:一|1)\s*[个款]|只要\s*(?:一|1)\s*[个款]|一个就行|一款就行|这个就行|这款就行/.test(question);
}

function shouldUseFocusedProduct(question: string, reply: string): boolean {
  return isProductCardTriggerQuestion(question) ||
    isProductAttributeQuestion(question) ||
    looksLikeProductCardReply(reply, question);
}

function isProductAttributeQuestion(question: string): boolean {
  const normalized = question.trim();
  if (!normalized) return false;
  if (isProductSelectionQuestion(normalized) || isProductEntryQuestion(normalized)) return false;
  return /(?:这个|这款|它|刚才|上面|前面|当前)?\s*(?:有几寸|几寸|尺寸|规格|够吃|够几个人|几个人吃|几人吃|适合几个人|多少钱|价格|什么价|有什么口味|有哪些口味|什么口味|口味|什么味|什么味道|味道|好吃吗|好不好吃|好吃不|好看吗|好不好看|颜值|外观|造型|拍照|上镜|甜不甜|腻不腻|口感|怎么样|推荐吗|有哪些规格)/.test(normalized) ||
    /^\d+(?:\.\d+)?\s*寸(?:吧|的|呢|吗)?$/.test(normalized);
}

function isSingleProductCardQuestion(question: string): boolean {
  return isProductSelectionQuestion(question) || isProductEntryQuestion(question);
}

function isProductCardTriggerQuestion(question: string): boolean {
  return isRecommendationQuestion(question) ||
    isProductSelectionQuestion(question) ||
    isProductEntryQuestion(question);
}

function isRecommendationQuestion(question: string): boolean {
  return /推荐|帮我.*(?:选|找|看|挑)|看看(?:商品|蛋糕|甜品)?|有没有|有.*(?:口味|水果|草莓|杨梅|芒果|荔枝|蛋糕)|哪(?:个|款)|哪个好|怎么选|想要|想买|来一?[个款份]|预算|便宜|贵|实惠|划算|送(?:长辈|老人|父母|爸妈|妈妈|爸爸|女友|男友|朋友|同事|客户|孩子|宝宝|小孩|女生|男生|女士|男士)|生日|纪念日/.test(question);
}

function isProductSelectionQuestion(question: string): boolean {
  return /第\s*[一二三四五六七八九十\d]+\s*[个款]?|[一二三四五六七八九十\d]+\s*款|就\s*(?:这个|这款|它)|(?:这个|这款)\s*就行|还是\s*(?:这个|这款|刚才那个|那款)|刚才那个|我要\s*(?:这个|这款)|要\s*(?:这个|这款)|选\s*(?:这个|这款|第\s*[一二三四五六七八九十\d]+)/.test(question);
}

function isProductEntryQuestion(question: string): boolean {
  return /商品卡片|卡片|看详情|查看详情|商品详情|看商品|查看商品|怎么买|购买|下单|我要了|要了/.test(question);
}

function looksLikeProductCardReply(reply: string, question: string): boolean {
  return /推荐|给你(?:挑|选|找)|可以看看|优先看|这几款|这款|人气|适合|限时价|爆款|商品详情|查看商品|\n\s*\d+[.、]/.test(reply) ||
    isProductCardTriggerQuestion(question);
}

function isProductOverviewQuestion(question: string): boolean {
  return /(?:除了.+还(?:有|卖)什么|还(?:有|卖)什么|还有(?:其他|别的)(?:吗|么)?|其他(?:还有)?(?:什么|品类|种类|类型)|都(?:有|卖)什么|卖什么|有哪些(?:品类|种类|类型)|有什么(?:品类|种类|类型))/.test(question) &&
    !/(推荐|帮我.*(?:选|找|看|挑)|哪个好|哪款|多少钱|价格|尺寸|适合|口味)/.test(question);
}

function looksLikeAssortmentOverviewReply(reply: string): boolean {
  return /(?:还有|除了|店里|本店|商品|品类|类型|种类).*(?:品类|类型|种类|专区|系列|方向)|(?:按|从).*(?:口味|预算|人群|场景).*(?:挑|选|看)/.test(reply) &&
    !/(推荐|给你(?:挑|选|找)|可以看看|优先看|这几款|\n\s*\d+[.、])/.test(reply);
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

function orderProductsByReply(reply: string, products: ProductSnapshot[]): ProductSnapshot[] {
  if (products.length <= 1) return products;
  const normalizedReply = normalizeProductText(reply);
  const indexed = products.map((product, index) => ({
    product,
    sourceIndex: index,
    replyIndex: productTitleMatchIndex(normalizedReply, product.title),
  }));
  if (!indexed.some((item) => item.replyIndex < Number.POSITIVE_INFINITY)) {
    return products;
  }
  return indexed
    .sort((left, right) =>
      compareReplyIndex(left.replyIndex, right.replyIndex) ||
      left.sourceIndex - right.sourceIndex
    )
    .map((item) => item.product);
}

function compareReplyIndex(left: number, right: number): number {
  if (left === right) return 0;
  if (left === Number.POSITIVE_INFINITY) return 1;
  if (right === Number.POSITIVE_INFINITY) return -1;
  return left - right;
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
