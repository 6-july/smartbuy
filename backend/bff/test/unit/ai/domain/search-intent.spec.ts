import { describe, expect, it } from "vitest";
import {
  isContextualFollowUp,
  isProductDetailFollowUp,
  resolveReferencedProductIds,
} from "../../../../src/ai/domain/conversation-context";
import { parseSearchIntent } from "../../../../src/ai/domain/search-intent";

describe("parseSearchIntent", () => {
  it("extracts an upper price boundary", () => {
    expect(parseSearchIntent("200元以内的抹茶蛋糕").priceMax).toBe(200);
  });

  it("extracts budget expressions with kuai as yuan", () => {
    expect(parseSearchIntent("只有10块").priceMax).toBe(10);
    expect(parseSearchIntent("128块以内的蛋糕").priceMax).toBe(128);
  });

  it("recognizes recommendation intent", () => {
    expect(parseSearchIntent("生日蛋糕推荐一下").needRecommendation).toBe(true);
  });

  it("uses recent products to recognize a contextual follow-up", () => {
    expect(isContextualFollowUp("第二个呢？", true)).toBe(true);
    expect(isContextualFollowUp("感觉有点贵啊，有优惠吗？", true)).toBe(true);
    expect(isContextualFollowUp("第二个呢？", false)).toBe(false);
  });

  it("separates product details from requests to switch products", () => {
    expect(isProductDetailFollowUp("这个适合几个人吃？", true)).toBe(true);
    expect(isProductDetailFollowUp("感觉有点贵啊，有优惠吗？", true)).toBe(true);
    expect(isProductDetailFollowUp("换一个适合儿童的", true)).toBe(false);
    expect(isProductDetailFollowUp("还有吗？", true)).toBe(false);
  });

  it("resolves an ordinal reference to the displayed product order", () => {
    const products = [
      { id: "first", name: "商品一" },
      { id: "second", name: "商品二" },
    ];
    expect(resolveReferencedProductIds("第二个呢？", products)).toEqual(["second"]);
    expect(resolveReferencedProductIds("这个呢？", products)).toEqual(["first", "second"]);
  });

  it("parses keyword and price intent", () => {
    const intent = parseSearchIntent("200元以内的抹茶蛋糕");
    expect(intent.keywords).toContain("抹茶");
    expect(intent.priceMax).toBe(200);
  });

  it("normalizes flavor wording to the core flavor keyword", () => {
    const intent = parseSearchIntent("我想要巧克力味道的蛋糕");
    expect(intent.keywords).toContain("巧克力");
    expect(intent.keywords).not.toContain("巧克力味道");
  });
});
