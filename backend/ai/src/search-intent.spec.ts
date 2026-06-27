import { describe, expect, it } from "vitest";
import { parseSearchIntent } from "./search-intent";
import { sanitizeGuideReply } from "./reply";
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
