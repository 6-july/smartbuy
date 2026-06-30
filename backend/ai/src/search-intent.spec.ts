import { describe, expect, it } from "vitest";
import { parseSearchIntent } from "./search-intent";
import { buildDeterministicReply, sanitizeGuideReply } from "./reply";
import { ProductCandidate } from "./types";

describe("parseSearchIntent", () => {
  it("extracts an upper price boundary", () => {
    expect(parseSearchIntent("200元以内的抹茶蛋糕").priceMax).toBe(200);
  });

  it("recognizes recommendation intent", () => {
    expect(parseSearchIntent("生日蛋糕推荐一下").needRecommendation).toBe(true);
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
