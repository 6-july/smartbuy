import { describe, expect, it, vi } from "vitest";
import { RetrievalService } from "../../../src/ai/retrieval.service";

describe("RetrievalService", () => {
  it("loads all saleable merchant products without vector search", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [productRow({
        id: "271a7ad7-8722-45e8-b37c-19370070b438",
        title: "海盐奥利奥",
        minPrice: 128,
        maxPrice: 258,
      })],
    });
    const service = new RetrievalService({ query } as never);

    const result = await service.findAllForMerchant("merchant-id");

    expect(result).toHaveLength(1);
    expect(result[0]?.candidate.title).toBe("海盐奥利奥");
    expect(query.mock.calls[0][0]).toContain("WHERE merchant_id = $1");
    expect(query.mock.calls[0][0]).toContain("ORDER BY is_recommended DESC");
  });

  it("finds products by ids and preserves requested order", async () => {
    const firstId = "271a7ad7-8722-45e8-b37c-19370070b438";
    const secondId = "7df2309a-918c-4b23-bc79-e03fb6801368";
    const query = vi.fn().mockResolvedValue({
      rows: [
        productRow({ id: secondId, title: "草莓蛋糕", minPrice: 138, maxPrice: 258 }),
        productRow({ id: firstId, title: "海盐奥利奥", minPrice: 128, maxPrice: 258 }),
      ],
    });
    const service = new RetrievalService({ query } as never);

    const result = await service.findByIds("merchant-id", [firstId, secondId]);

    expect(result.map((item) => item.row.id)).toEqual([firstId, secondId]);
    expect(query.mock.calls[0][0]).toContain("id = ANY");
  });
});

function productRow(input: {
  id: string;
  title: string;
  minPrice: number;
  maxPrice: number;
}) {
  return {
    id: input.id,
    merchant_id: "merchant-id",
    source: "manual",
    source_shop_id: null,
    source_product_id: input.id,
    alias: null,
    category: "蛋糕",
    title: input.title,
    description: null,
    display_price: String(input.minPrice),
    min_price: String(input.minPrice),
    max_price: String(input.maxPrice),
    images: [],
    sales: "0",
    is_recommended: false,
    options: [],
    tags: [],
    options_text: input.title,
    sale_status: "on_sale",
    created_at: new Date(),
    updated_at: new Date(),
  };
}
