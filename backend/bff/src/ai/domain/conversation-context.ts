const CONTEXT_REFERENCE_PATTERN =
  /(这个|那个|这款|那款|它|上面|前面|刚才|之前|其中|第\s*[一二三四五六七八九十\d]+\s*[个款]|前一个|后一个)/;

const SHORT_DETAIL_PATTERN =
  /^(多少钱|价格呢|什么价格|什么规格|有哪些规格|有什么规格|什么尺寸|有哪些尺寸|有什么尺寸|有几寸|适合几个人|几个人吃|多少人吃|有优惠吗|有折扣吗|有活动吗|有货吗|怎么选|哪个好|还有吗)[？?！!。.~～]*$/;

const PRODUCT_DETAIL_PATTERN =
  /(优惠|折扣|活动|价格|多少钱|规格|尺寸|几寸|适合.{0,8}(?:人|儿童|老人|生日)|几个人|多少人|有货|库存|现货|配送|发货|原料|成分|过敏|保质期|口味|甜不甜|好吃吗|怎么样)/;

const PRODUCT_SWITCH_PATTERN =
  /(换一?[个款]|换成|换别的|其他款|其它款|另外一款|重新推荐|不要这|不喜欢这|类似的|便宜点的|贵一点的|还有吗|还有别的|再来一?[个款])/;

export function isContextualFollowUp(question: string, hasRecentProducts: boolean): boolean {
  if (!hasRecentProducts) return false;
  const normalized = question.trim();
  return (
    CONTEXT_REFERENCE_PATTERN.test(normalized) ||
    SHORT_DETAIL_PATTERN.test(normalized) ||
    PRODUCT_DETAIL_PATTERN.test(normalized) ||
    PRODUCT_SWITCH_PATTERN.test(normalized)
  );
}

export function isProductDetailFollowUp(
  question: string,
  hasRecentProducts: boolean,
): boolean {
  if (!hasRecentProducts) return false;
  const normalized = question.trim();
  if (PRODUCT_SWITCH_PATTERN.test(normalized)) return false;
  return (
    CONTEXT_REFERENCE_PATTERN.test(normalized) ||
    SHORT_DETAIL_PATTERN.test(normalized) ||
    PRODUCT_DETAIL_PATTERN.test(normalized)
  );
}

export interface RecentProductReference {
  id: string;
  name: string;
}

const CHINESE_INDEXES: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

export function resolveReferencedProductIds(
  question: string,
  recentProducts: RecentProductReference[],
): string[] {
  const indexMatch = question.match(/第\s*([一二三四五六七八九十]|\d+)\s*[个款]/);
  if (indexMatch) {
    const index = CHINESE_INDEXES[indexMatch[1]] || Number(indexMatch[1]);
    const selected = recentProducts[index - 1];
    return selected ? [selected.id] : [];
  }
  return recentProducts.map((product) => product.id);
}
