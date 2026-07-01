import { describe, expect, it } from "vitest";
import {
  isContextualFollowUp,
  isProductDetailFollowUp,
  resolveReferencedProductIds,
  shouldUseIntentModel,
} from "./conversation-context";
import { buildDeterministicReply, sanitizeGuideReply } from "./reply";
import { parseSearchIntent } from "./search-intent";
import { ProductCandidate } from "./types";

describe("parseSearchIntent", () => {
  it("extracts an upper price boundary", () => {
    expect(parseSearchIntent("200元以内的抹茶蛋糕").priceMax).toBe(200);
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

  it("skips intent-model calls for a clear standalone request", () => {
    const intent = parseSearchIntent("200元以内的抹茶蛋糕");
    expect(shouldUseIntentModel("200元以内的抹茶蛋糕", intent, false)).toBe(false);
    expect(shouldUseIntentModel("第二个呢", parseSearchIntent("第二个呢"), true)).toBe(true);
  });
});

describe("sanitizeGuideReply", () => {
  it("removes product ids outside the candidate set", () => {
    const candidate = { id: "allowed" } as ProductCandidate;
    expect(
      sanitizeGuideReply(
        { reply: "ok", productIds: ["allowed", "invented"] },
        [candidate],
      ).productIds,
    ).toEqual(["allowed"]);
  });
});

describe("buildDeterministicReply", () => {
  it("mentions concrete spec prices when the user has a budget", () => {
    const candidate = {
      id: "cake",
      title: "伯爵红茶奶油蛋糕",
      displayPrice: 128,
      minPrice: 128,
      maxPrice: 378,
      options: [
        {
          type: "price",
          name: "尺寸",
          options: [
            { name: "4寸", price: 128 },
            { name: "5寸", price: 188 },
            { name: "6寸", price: 258 },
          ],
        },
      ],
    } as ProductCandidate;

    const reply = buildDeterministicReply(
      [candidate],
      parseSearchIntent("200元以内有什么蛋糕"),
    );

    expect(reply.reply).toContain("200");
    expect(reply.reply).toContain("4寸 ¥128");
    expect(reply.reply).toContain("5寸 ¥188");
    expect(reply.reply).not.toContain("6寸");
  });
});
