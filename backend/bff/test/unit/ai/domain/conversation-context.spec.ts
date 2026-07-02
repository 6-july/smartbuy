import { describe, expect, it } from "vitest";
import {
  isContextualFollowUp,
  isProductDetailFollowUp,
  resolveReferencedProductIds,
} from "../../../../src/ai/domain/conversation-context";

describe("conversation product context", () => {
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
});
