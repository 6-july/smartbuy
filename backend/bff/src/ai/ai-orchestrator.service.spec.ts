import { describe, expect, it, vi } from "vitest";
import { AiOrchestratorService } from "./ai-orchestrator.service";

describe("AiOrchestratorService", () => {
  it("keeps an ordinal follow-up bound to the referenced product", async () => {
    const firstId = "271a7ad7-8722-45e8-b37c-19370070b438";
    const secondId = "7df2309a-918c-4b23-bc79-e03fb6801368";
    const candidate = {
      id: secondId,
      title: "伯爵红茶奶油蛋糕",
      category: "蛋糕",
      description: null,
      displayPrice: 128,
      minPrice: 128,
      maxPrice: 258,
      tags: [],
      options: [],
      aiText: "伯爵红茶奶油蛋糕",
      score: 1,
    };
    const findByIds = vi.fn().mockResolvedValue([
      { row: { id: secondId }, candidate },
    ]);
    const retrieval = {
      findByIds,
      countProducts: vi.fn().mockResolvedValue(2),
      listCategories: vi.fn().mockResolvedValue(["蛋糕"]),
    };
    const parse = vi.fn().mockResolvedValue({
      queryText: "伯爵红茶奶油蛋糕有什么尺寸",
      keywords: ["伯爵红茶奶油蛋糕", "尺寸"],
      priceMin: null,
      priceMax: null,
      needRecommendation: false,
    });
    const reply = vi.fn().mockResolvedValue({
      reply: "伯爵红茶奶油蛋糕有多个尺寸可选",
      productIds: [secondId],
    });
    const service = new AiOrchestratorService(
      retrieval as never,
      { reply } as never,
      { parse } as never,
    );

    const result = await service.guide({
      merchant: { id: "merchant-id", name: "测试店铺", description: null },
      question: "第二个有什么尺寸？",
      history: [{ role: "assistant", content: "为你找到了两款商品" }],
      recentProducts: [
        { id: firstId, name: "草莓蛋糕" },
        { id: secondId, name: "伯爵红茶奶油蛋糕" },
      ],
    });

    expect(findByIds).toHaveBeenCalledWith("merchant-id", [secondId]);
    expect(reply.mock.calls[0][1]).toBe("伯爵红茶奶油蛋糕有什么尺寸");
    expect(result.reply).toContain("伯爵红茶奶油蛋糕");
    expect(result.products).toEqual([]);
  });

  it("returns a deterministic response when no product matches the budget", async () => {
    const reply = vi.fn();
    const service = new AiOrchestratorService(
      {
        search: vi.fn().mockResolvedValue([]),
        countProducts: vi.fn().mockResolvedValue(42),
        listCategories: vi.fn().mockResolvedValue(["蛋糕"]),
      } as never,
      { reply } as never,
      {
        parse: vi.fn().mockResolvedValue({
          queryText: "100元以内有什么蛋糕",
          keywords: ["蛋糕"],
          priceMin: null,
          priceMax: 100,
          needRecommendation: false,
        }),
      } as never,
    );

    const result = await service.guide({
      merchant: { id: "merchant-id", name: "测试店铺", description: null, industry: "蛋糕" },
      question: "100元以内有什么蛋糕？",
      history: [],
    });

    expect(result).toEqual({
      reply: "暂时没有找到100元以内符合要求的蛋糕，可以提高预算或换个关键词试试哦。",
      products: [],
    });
    expect(reply).not.toHaveBeenCalled();
  });

  it("keeps operational questions on the customer-service fallback", async () => {
    const reply = vi.fn();
    const service = new AiOrchestratorService(
      {
        search: vi.fn().mockResolvedValue([]),
        countProducts: vi.fn().mockResolvedValue(42),
        listCategories: vi.fn().mockResolvedValue(["蛋糕"]),
      } as never,
      { reply } as never,
      {
        parse: vi.fn().mockResolvedValue({
          queryText: "今天可以配送到朝阳区吗",
          keywords: ["配送", "朝阳区"],
          priceMin: null,
          priceMax: null,
          needRecommendation: false,
        }),
      } as never,
    );

    const result = await service.guide({
      merchant: {
        id: "merchant-id",
        name: "测试店铺",
        description: null,
        industry: "蛋糕",
        phone: "18600000000",
      },
      question: "今天可以配送到朝阳区吗？",
      history: [],
    });

    expect(result.reply).toContain("18600000000");
    expect(result.products).toEqual([]);
    expect(reply).not.toHaveBeenCalled();
  });

  it("returns the configured phone without running product retrieval", async () => {
    const search = vi.fn();
    const reply = vi.fn();
    const service = new AiOrchestratorService(
      {
        search,
        countProducts: vi.fn(),
        listCategories: vi.fn(),
      } as never,
      { reply } as never,
      { parse: vi.fn() } as never,
    );

    const result = await service.guide({
      merchant: {
        id: "merchant-id",
        name: "测试店铺",
        description: null,
        phone: "18600000000",
      },
      question: "你们客服电话是多少？",
      history: [],
    });

    expect(result.reply).toContain("18600000000");
    expect(result.products).toEqual([]);
    expect(search).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  it("keeps weather conversation in the chitchat path", async () => {
    const search = vi.fn();
    const reply = vi.fn().mockResolvedValue({ reply: "是呀，心情也变好啦～", productIds: [] });
    const service = new AiOrchestratorService(
      {
        search,
        countProducts: vi.fn().mockResolvedValue(42),
        listCategories: vi.fn().mockResolvedValue(["蛋糕"]),
      } as never,
      { reply } as never,
      { parse: vi.fn() } as never,
    );

    const result = await service.guide({
      merchant: { id: "merchant-id", name: "测试店铺", description: null },
      question: "今天天气真不错",
      history: [],
    });

    expect(result).toEqual({ reply: "是呀，心情也变好啦～", products: [] });
    expect(search).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledOnce();
  });

  it("limits candidates when the user asks for one recommendation", async () => {
    const products = ["第一款", "第二款", "第三款"].map((title, index) => ({
      row: { id: `product-${index + 1}` },
      candidate: {
        id: `product-${index + 1}`,
        title,
        category: "蛋糕",
        description: null,
        displayPrice: 128 + index,
        minPrice: 128 + index,
        maxPrice: 128 + index,
        tags: [],
        options: [],
        aiText: title,
        score: 1,
      },
    }));
    const reply = vi.fn().mockResolvedValue({ reply: "推荐第一款", productIds: ["product-1"] });
    const service = new AiOrchestratorService(
      {
        search: vi.fn().mockResolvedValue(products),
        countProducts: vi.fn().mockResolvedValue(3),
        listCategories: vi.fn().mockResolvedValue(["蛋糕"]),
      } as never,
      { reply } as never,
      {
        parse: vi.fn().mockResolvedValue({
          queryText: "推荐一款抹茶蛋糕",
          keywords: ["抹茶蛋糕"],
          priceMin: null,
          priceMax: null,
          needRecommendation: true,
        }),
      } as never,
    );

    const result = await service.guide({
      merchant: { id: "merchant-id", name: "测试店铺", description: null },
      question: "推荐一款抹茶蛋糕",
      history: [],
    });

    expect(reply.mock.calls[0][3]).toHaveLength(1);
    expect(result.products).toHaveLength(1);
  });

  it("answers a discount follow-up without searching or repeating the product card", async () => {
    const search = vi.fn();
    const findByIds = vi.fn();
    const reply = vi.fn();
    const parse = vi.fn();
    const service = new AiOrchestratorService(
      {
        search,
        findByIds,
        countProducts: vi.fn(),
        listCategories: vi.fn(),
      } as never,
      { reply } as never,
      { parse } as never,
    );

    const result = await service.guide({
      merchant: {
        id: "merchant-id",
        name: "测试店铺",
        description: null,
        phone: "18600000000",
      },
      question: "感觉有点贵啊，有优惠吗？",
      history: [],
      recentProducts: [{ id: "product-id", name: "复古棕花kitty" }],
    });

    expect(result.reply).toContain("实时优惠活动");
    expect(result.reply).toContain("18600000000");
    expect(result.products).toEqual([]);
    expect(search).not.toHaveBeenCalled();
    expect(findByIds).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
  });

  it("answers a serving-count follow-up from the exact product without repeating its card", async () => {
    const productId = "271a7ad7-8722-45e8-b37c-19370070b438";
    const candidate = {
      id: productId,
      title: "复古棕花kitty",
      category: "蛋糕",
      description: null,
      displayPrice: 268,
      minPrice: 268,
      maxPrice: 338,
      tags: [],
      options: [
        {
          type: "price",
          name: "尺寸",
          options: [
            { name: "5寸", price: 268 },
            { name: "6寸", price: 338 },
          ],
        },
      ],
      aiText: "复古棕花kitty 5寸 268元 6寸 338元",
      score: 1,
    };
    const findByIds = vi.fn().mockResolvedValue([
      { row: { id: productId }, candidate },
    ]);
    const reply = vi.fn();
    const service = new AiOrchestratorService(
      {
        search: vi.fn(),
        findByIds,
        countProducts: vi.fn().mockResolvedValue(1),
        listCategories: vi.fn().mockResolvedValue(["蛋糕"]),
      } as never,
      { reply } as never,
      {
        parse: vi.fn().mockResolvedValue({
          queryText: "复古棕花kitty适合几个人吃",
          keywords: ["复古棕花kitty"],
          priceMin: null,
          priceMax: null,
          needRecommendation: false,
        }),
      } as never,
    );

    const result = await service.guide({
      merchant: {
        id: "merchant-id",
        name: "测试店铺",
        description: null,
        phone: "18600000000",
      },
      question: "这个适合几个人吃？",
      history: [],
      recentProducts: [{ id: productId, name: "复古棕花kitty" }],
    });

    expect(findByIds).toHaveBeenCalledWith("merchant-id", [productId]);
    expect(result.reply).toContain("5寸、6寸");
    expect(result.reply).toContain("没有标注具体适用人数");
    expect(result.products).toEqual([]);
    expect(reply).not.toHaveBeenCalled();
  });

  it("returns product cards in the same order as they appear in the reply", async () => {
    const products = [
      { id: "first", title: "伯爵红茶奶油蛋糕" },
      { id: "second", title: "覆盆子玫瑰荔枝" },
    ].map(({ id, title }) => ({
      row: { id },
      candidate: {
        id,
        title,
        category: "蛋糕",
        description: null,
        displayPrice: 128,
        minPrice: 128,
        maxPrice: 128,
        tags: [],
        options: [],
        aiText: title,
        score: 1,
      },
    }));
    const service = new AiOrchestratorService(
      {
        search: vi.fn().mockResolvedValue(products),
        countProducts: vi.fn().mockResolvedValue(2),
        listCategories: vi.fn().mockResolvedValue(["蛋糕"]),
      } as never,
      {
        reply: vi.fn().mockResolvedValue({
          reply: "第一款是覆盆子玫瑰荔枝，第二款是伯爵红茶奶油蛋糕。",
          productIds: ["first", "second"],
        }),
      } as never,
      {
        parse: vi.fn().mockResolvedValue({
          queryText: "推荐两款蛋糕",
          keywords: ["蛋糕"],
          priceMin: null,
          priceMax: null,
          needRecommendation: true,
        }),
      } as never,
    );

    const result = await service.guide({
      merchant: { id: "merchant-id", name: "测试店铺", description: null },
      question: "推荐两款蛋糕",
      history: [],
    });

    expect(result.products.map((product) => product.row.id)).toEqual(["second", "first"]);
  });
});
