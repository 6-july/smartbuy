import { describe, expect, it, vi } from "vitest";
import { QueryProductsService } from "../../../../../src/ai/graph/tools/query-products.service";

describe("QueryProductsService", () => {
  it("does not return chocolate products for a strawberry hard condition", async () => {
    const service = new QueryProductsService(
      {
        search: vi.fn().mockResolvedValue([
          retrievedProduct({
            id: "271a7ad7-8722-45e8-b37c-19370070b438",
            title: "浓情巧克力蛋糕",
            aiText: "巧克力风味蛋糕",
          }),
        ]),
      } as never,
    );

    const result = await service.execute({
      merchantId: "merchant-id",
      query: "推荐草莓味商品",
      products: { shown: [] },
    });

    expect(result.status).toBe("empty");
    expect(result.products).toEqual([]);
    expect(result.reason).toContain("草莓");
  });

  it("returns constraint_conflict when multiple hard conditions cannot be matched together", async () => {
    const service = new QueryProductsService(
      {
        search: vi.fn().mockResolvedValue([
          retrievedProduct({
            id: "271a7ad7-8722-45e8-b37c-19370070b438",
            title: "10寸巧克力蛋糕",
            aiText: "10寸 巧克力",
          }),
          retrievedProduct({
            id: "7df2309a-918c-4b23-bc79-e03fb6801368",
            title: "6寸草莓蛋糕",
            aiText: "6寸 草莓",
          }),
        ]),
      } as never,
    );

    const result = await service.execute({
      merchantId: "merchant-id",
      query: "查询同时满足10寸和草莓味的蛋糕",
      products: { shown: [] },
    });

    expect(result.status).toBe("constraint_conflict");
    expect(result.products).toEqual([]);
    expect(result.clarification?.question).toContain("优先保留");
  });

  it("keeps chocolate products when the user asks for chocolate flavor", async () => {
    const service = new QueryProductsService(
      {
        search: vi.fn().mockResolvedValue([
          retrievedProduct({
            id: "271a7ad7-8722-45e8-b37c-19370070b438",
            title: "伯爵红茶奶油蛋糕",
            aiText: "红茶奶油蛋糕",
          }),
          retrievedProduct({
            id: "7df2309a-918c-4b23-bc79-e03fb6801368",
            title: "法芙娜梦龙生巧/巧克力脑袋",
            aiText: "巧克力风味蛋糕",
          }),
        ]),
      } as never,
    );

    const result = await service.execute({
      merchantId: "merchant-id",
      query: "我想要巧克力味道的",
      products: { shown: [] },
    });

    expect(result.status).toBe("success");
    expect(result.products).toHaveLength(1);
    expect(result.products[0]?.title).toBe("法芙娜梦龙生巧/巧克力脑袋");
  });

  it("treats common chocolate aliases as matching chocolate flavor", async () => {
    const service = new QueryProductsService(
      {
        search: vi.fn().mockResolvedValue([
          retrievedProduct({
            id: "7df2309a-918c-4b23-bc79-e03fb6801368",
            title: "【新品】树莓可可芝士挞",
            aiText: "树莓可可芝士挞",
          }),
        ]),
      } as never,
    );

    const result = await service.execute({
      merchantId: "merchant-id",
      query: "推荐巧克力味商品",
      products: { shown: [] },
    });

    expect(result.status).toBe("success");
    expect(result.products[0]?.title).toBe("【新品】树莓可可芝士挞");
  });

  it("returns low-price alternatives when the budget is below all products", async () => {
    const search = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        retrievedProduct({
          id: "7df2309a-918c-4b23-bc79-e03fb6801368",
          title: "海盐奥利奥",
          aiText: "海盐奥利奥",
          minPrice: 128,
          maxPrice: 258,
        }),
      ]);
    const service = new QueryProductsService(
      {
        search,
        findCheapest: vi.fn(),
      } as never,
    );

    const result = await service.execute({
      merchantId: "merchant-id",
      query: "只有10块",
      products: { shown: [] },
    });

    expect(result.status).toBe("success");
    expect(result.reason).toContain("10元以内");
    expect(result.reason).toContain("128元起");
    expect(result.products[0]?.title).toBe("海盐奥利奥");
  });

  it("returns the referenced product for unsupported realtime facts", async () => {
    const productId = "7df2309a-918c-4b23-bc79-e03fb6801368";
    const service = new QueryProductsService(
      {
        findByIds: vi.fn().mockResolvedValue([
          retrievedProduct({
            id: productId,
            title: "海盐奥利奥",
            aiText: "海盐奥利奥",
          }),
        ]),
      } as never,
    );

    const result = await service.execute({
      merchantId: "merchant-id",
      query: "你家有优惠吗",
      products: { shown: [{ id: productId, title: "海盐奥利奥" }], focusedId: productId },
    });

    expect(result.status).toBe("unsupported_fact");
    expect(result.reason).toContain("无法确认");
    expect(result.products).toHaveLength(1);
    expect(result.products[0]?.title).toBe("海盐奥利奥");
  });
});

function retrievedProduct(input: {
  id: string;
  title: string;
  aiText: string;
  minPrice?: number;
  maxPrice?: number;
}) {
  const minPrice = input.minPrice ?? 128;
  const maxPrice = input.maxPrice ?? minPrice;
  const candidate = {
    id: input.id,
    title: input.title,
    category: "蛋糕",
    description: null,
    displayPrice: minPrice,
    minPrice,
    maxPrice,
    tags: [],
    options: [],
    aiText: input.aiText,
    score: 1,
  };
  return {
    row: {
      id: input.id,
      title: input.title,
      category: "蛋糕",
      description: null,
      display_price: String(minPrice),
      min_price: String(minPrice),
      max_price: String(maxPrice),
      tags: [],
      options: [],
      ai_text: input.aiText,
    },
    candidate,
  };
}
