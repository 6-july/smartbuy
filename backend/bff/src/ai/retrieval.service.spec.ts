import { describe, expect, it, vi } from "vitest";
import { RetrievalService } from "./retrieval.service";

describe("RetrievalService", () => {
  it("boosts a product referenced by the previous response", async () => {
    const preferredId = "7df2309a-918c-4b23-bc79-e03fb6801368";
    const query = vi.fn().mockResolvedValue({
      rows: [{
        id: preferredId,
        title: "伯爵红茶奶油蛋糕",
        category: "蛋糕",
        description: null,
        display_price: "128",
        min_price: "128",
        max_price: "258",
        tags: [],
        options: [],
        ai_text: "伯爵红茶奶油蛋糕",
        retrieval_score: "1",
      }],
    });
    const service = new RetrievalService(
      { query } as never,
      { embed: vi.fn().mockResolvedValue(null) } as never,
    );

    const result = await service.search(
      "merchant-id",
      {
        queryText: "伯爵红茶奶油蛋糕有什么尺寸",
        keywords: ["伯爵红茶奶油蛋糕", "尺寸"],
        priceMin: null,
        priceMax: null,
        needRecommendation: false,
      },
      [preferredId],
    );

    expect(result[0].row.id).toBe(preferredId);
    expect(query.mock.calls[0][0]).toContain("id = ANY");
    expect(query.mock.calls[0][1]).toContainEqual([preferredId]);
  });

  it("sorts cheapest-product questions by minimum price", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const service = new RetrievalService(
      { query } as never,
      { embed: vi.fn().mockResolvedValue(null) } as never,
    );

    await service.search("merchant-id", {
      queryText: "店里最便宜的蛋糕是哪款",
      keywords: ["蛋糕"],
      priceMin: null,
      priceMax: null,
      needRecommendation: false,
    });

    expect(query.mock.calls[0][0]).toContain("ORDER BY min_price ASC");
  });
});
