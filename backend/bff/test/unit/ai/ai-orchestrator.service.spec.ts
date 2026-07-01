import { describe, expect, it, vi } from "vitest";
import { AiOrchestratorService } from "../../../src/ai/ai-orchestrator.service";

const PRODUCT_ACTION_HINT = "\n\n有需要可以点击下方商品卡片的「查看商品」按钮查看详情并购买。";

describe("AiOrchestratorService", () => {
  it("uses LangGraph and resolves returned product ids into product cards", async () => {
    const products = [
      { row: { id: "first" }, candidate: { id: "first", title: "草莓蛋糕" } },
      { row: { id: "second" }, candidate: { id: "second", title: "抹茶蛋糕" } },
    ];
    const findByIds = vi.fn().mockResolvedValue(products);
    const guide = vi.fn().mockResolvedValue({
      reply: "推荐草莓蛋糕和抹茶蛋糕",
      productIds: ["first", "second"],
    });
    const service = new AiOrchestratorService(
      { findByIds } as never,
      { canRun: () => true, guide } as never,
    );

    const result = await service.guide({
      merchant: { id: "merchant-id", name: "测试店铺", description: null },
      question: "推荐两款蛋糕",
      history: [],
      recentProducts: [{ id: "recent-id", name: "上一轮商品" }],
    });

    expect(guide).toHaveBeenCalledWith({
      merchant: { id: "merchant-id", name: "测试店铺", description: null },
      question: "推荐两款蛋糕",
      history: [],
      recentProducts: [{ id: "recent-id", name: "上一轮商品" }],
    });
    expect(findByIds).toHaveBeenCalledWith("merchant-id", ["first", "second"]);
    expect(result).toEqual({
      reply: `推荐草莓蛋糕和抹茶蛋糕${PRODUCT_ACTION_HINT}`,
      products,
    });
  });

  it("does not duplicate the product-card action hint", async () => {
    const products = [{ row: { id: "first" }, candidate: { id: "first", title: "草莓蛋糕" } }];
    const findByIds = vi.fn().mockResolvedValue(products);
    const service = new AiOrchestratorService(
      { findByIds } as never,
      {
        canRun: () => true,
        guide: vi.fn().mockResolvedValue({
          reply: "推荐这款草莓蛋糕，可以点击下方商品卡片的「查看商品」按钮查看详情。",
          productIds: ["first"],
        }),
      } as never,
    );

    const result = await service.guide({
      merchant: { id: "merchant-id", name: "测试店铺", description: null },
      question: "推荐蛋糕",
      history: [],
    });

    expect(result).toEqual({
      reply: "推荐这款草莓蛋糕，可以点击下方商品卡片的「查看商品」按钮查看详情。",
      products,
    });
  });

  it("removes product-card action hints when no product card is available", async () => {
    const findByIds = vi.fn().mockResolvedValue([]);
    const service = new AiOrchestratorService(
      { findByIds } as never,
      {
        canRun: () => true,
        guide: vi.fn().mockResolvedValue({
          reply: "这款比较适合3个人吃。\n\n可以点击下方商品卡片的「查看商品」按钮查看详情。",
          productIds: ["missing-product"],
        }),
      } as never,
    );

    const result = await service.guide({
      merchant: { id: "merchant-id", name: "测试店铺", description: null },
      question: "适合几个人吃",
      history: [],
    });

    expect(findByIds).toHaveBeenCalledWith("merchant-id", ["missing-product"]);
    expect(result).toEqual({
      reply: "这款比较适合3个人吃。",
      products: [],
    });
  });

  it("does not run product lookup when LangGraph returns no product ids", async () => {
    const findByIds = vi.fn();
    const service = new AiOrchestratorService(
      { findByIds } as never,
      {
        canRun: () => true,
        guide: vi.fn().mockResolvedValue({ reply: "可以告诉我更具体的口味吗？", productIds: [] }),
      } as never,
    );

    const result = await service.guide({
      merchant: { id: "merchant-id", name: "测试店铺", description: null },
      question: "我想要蛋糕",
      history: [],
    });

    expect(findByIds).not.toHaveBeenCalled();
    expect(result).toEqual({ reply: "可以告诉我更具体的口味吗？", products: [] });
  });

  it("returns a small unavailable reply when LangGraph cannot run", async () => {
    const findByIds = vi.fn();
    const guide = vi.fn();
    const service = new AiOrchestratorService(
      { findByIds } as never,
      { canRun: () => false, guide } as never,
    );

    const result = await service.guide({
      merchant: { id: "merchant-id", name: "测试店铺", description: null },
      question: "推荐蛋糕",
      history: [],
    });

    expect(guide).not.toHaveBeenCalled();
    expect(findByIds).not.toHaveBeenCalled();
    expect(result).toEqual({ reply: "智能导购服务暂时不可用，请稍后再试。", products: [] });
  });

  it("does not fall back to the legacy orchestrator when LangGraph fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const findByIds = vi.fn();
    const service = new AiOrchestratorService(
      { findByIds } as never,
      {
        canRun: () => true,
        guide: vi.fn().mockRejectedValue(new Error("graph failed")),
      } as never,
    );

    const result = await service.guide({
      merchant: { id: "merchant-id", name: "测试店铺", description: null, phone: "18600000000" },
      question: "你们客服电话是多少？",
      history: [],
    });

    expect(findByIds).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    expect(result).toEqual({
      reply: "我暂时没能完成这次查询，可以换个口味、预算或商品类型再试试。",
      products: [],
    });
    errorSpy.mockRestore();
  });
});
