import { describe, expect, it } from "vitest";
import { normalizeGuideReply } from "./chat-model.service";

describe("normalizeGuideReply", () => {
  it("filters malformed product ids and removes markdown", () => {
    expect(
      normalizeGuideReply({
        reply: "**推荐这款**",
        productIds: ["product-1", 2, "product-1", null],
      }),
    ).toEqual({ reply: "推荐这款", productIds: ["product-1"] });
  });

  it("accepts a valid reply when productIds is missing", () => {
    expect(normalizeGuideReply({ reply: "可以看看这款" })).toEqual({
      reply: "可以看看这款",
      productIds: [],
    });
  });

  it("rejects values without a usable reply", () => {
    expect(normalizeGuideReply({ productIds: [] })).toBeNull();
  });
});
