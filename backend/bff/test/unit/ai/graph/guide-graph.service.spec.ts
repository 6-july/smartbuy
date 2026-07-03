import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it, vi } from "vitest";
import { GuideGraphService } from "../../../../src/ai/graph/guide-graph.service";
import { SelectProductsService } from "../../../../src/ai/graph/tools/select-products.service";

describe("GuideGraphService", () => {
  it("loads products, accepts final JSON, and validates product ids internally", async () => {
    const productId = "271a7ad7-8722-45e8-b37c-19370070b438";
    const product = productSnapshot({
      id: productId,
      title: "草莓蛋糕",
      category: "蛋糕",
      priceText: "¥128",
      tags: ["草莓"],
    });
    const invokeAgentTurn = vi
      .fn()
      .mockImplementationOnce(async () =>
        new AIMessage({
          content: "",
          tool_calls: [{
            id: "call-load",
            name: "load_products",
            args: { reason: "用户想看蛋糕" },
            type: "tool_call",
          }],
        }),
      )
      .mockImplementationOnce(async (messages) => {
        const toolMessage = messages.find((message: unknown) =>
          ToolMessage.isInstance(message) && message.name === "load_products",
        ) as ToolMessage;
        expect(toolMessage.content).toContain(productId);
        return new AIMessage({
          content: JSON.stringify({
            reply: "可以看看这款草莓蛋糕。",
            productIds: [productId, "not-from-pool"],
          }),
        });
      });
    const loadProducts = {
      execute: vi.fn().mockResolvedValue({
        status: "success",
        products: [product],
      }),
    };
    const selectProducts = {
      execute: vi.fn().mockResolvedValue({
        status: "invalid",
        invalidProductIds: ["not-from-pool"],
        products: [product],
        reply: "可以看看这款草莓蛋糕。",
        productIds: [productId],
      }),
    };

    const service = createService({
      invokeAgentTurn,
      loadProducts,
      selectProducts,
    });

    const result = await service.guide({
      merchant: { id: "merchant-id", name: "测试店铺" },
      question: "我想要蛋糕",
      history: [],
      trace: { sessionId: "conversation-id" },
    });

    expect(invokeAgentTurn.mock.calls[0]?.[2]).toEqual({
      toolChoice: {
        type: "function",
        function: { name: "load_products" },
      },
    });
    expect(invokeAgentTurn.mock.calls[1]?.[2]).toBeUndefined();
    expect(toolNames(invokeAgentTurn.mock.calls[1]?.[1])).toEqual([
      "load_products",
      "query_merchant_info",
    ]);
    expect(loadProducts.execute).toHaveBeenCalledWith({
      merchantId: "merchant-id",
      reason: "用户想看蛋糕",
    });
    expect(selectProducts.execute).toHaveBeenCalledWith({
      productIds: [productId, "not-from-pool"],
      reply: "可以看看这款草莓蛋糕。",
      question: "我想要蛋糕",
      products: expect.objectContaining({
        items: [expect.objectContaining({ id: productId })],
      }),
      currentProducts: { items: [] },
      reason: undefined,
    });
    expect(result).toEqual({
      reply: "可以看看这款草莓蛋糕。",
      productIds: [productId],
    });
    expect(invokeAgentTurn).toHaveBeenCalledTimes(2);
  });

  it("reuses loaded products and current product state within the same conversation thread", async () => {
    const productId = "271a7ad7-8722-45e8-b37c-19370070b438";
    const product = productSnapshot({
      id: productId,
      title: "草莓蛋糕",
      category: "蛋糕",
      priceText: "¥128",
      tags: ["草莓"],
    });
    const invokeAgentTurn = vi
      .fn()
      .mockImplementationOnce(async () =>
        new AIMessage({
          content: "",
          tool_calls: [{
            id: "call-load",
            name: "load_products",
            args: { reason: "用户想看蛋糕" },
            type: "tool_call",
          }],
        }),
      )
      .mockImplementationOnce(async () =>
        new AIMessage({
          content: JSON.stringify({
            reply: "可以看看这款草莓蛋糕。",
            productIds: [productId],
          }),
        }),
      )
      .mockImplementationOnce(async () =>
        new AIMessage({
          content: JSON.stringify({
            reply: "这款草莓蛋糕是¥128。",
            productIds: [],
          }),
        }),
      );
    const loadProducts = {
      execute: vi.fn().mockResolvedValue({
        status: "success",
        products: [product],
      }),
    };

    const service = createService({ invokeAgentTurn, loadProducts });

    await service.guide({
      merchant: { id: "merchant-id", name: "测试店铺" },
      question: "推荐蛋糕",
      history: [],
      trace: { sessionId: "reuse-conversation" },
    });
    const second = await service.guide({
      merchant: { id: "merchant-id", name: "测试店铺" },
      question: "这款多少钱",
      history: [{ role: "assistant", content: "可以看看这款草莓蛋糕。" }],
      trace: { sessionId: "reuse-conversation" },
    });

    expect(loadProducts.execute).toHaveBeenCalledTimes(1);
    expect(invokeAgentTurn.mock.calls[2]?.[2]).toBeUndefined();
    expect(second).toEqual({
      reply: "这款草莓蛋糕是¥128。",
      productIds: [productId],
    });
  });

  it("continues filtering products when a follow-up adds a recipient preference", async () => {
    const productId = "271a7ad7-8722-45e8-b37c-19370070b438";
    const product = productSnapshot({
      id: productId,
      title: "覆盆子玫瑰荔枝",
      category: "送长辈",
      priceText: "¥138-¥398",
      tags: ["送长辈", "水果"],
    });
    const invokeAgentTurn = vi
      .fn()
      .mockImplementationOnce(async () =>
        new AIMessage({
          content: "",
          tool_calls: [{
            id: "call-load",
            name: "load_products",
            args: { reason: "用户想看推荐" },
            type: "tool_call",
          }],
        }),
      )
      .mockImplementationOnce(async () =>
        new AIMessage({
          content: JSON.stringify({
            reply: "可以看看这款覆盆子玫瑰荔枝。",
            productIds: [productId],
          }),
        }),
      )
      .mockImplementationOnce(async () =>
        new AIMessage({
          content: JSON.stringify({
            reply: "送长辈的话，可以优先看这款覆盆子玫瑰荔枝，口味清爽，造型也比较稳重。",
            productIds: [productId],
          }),
        }),
      );
    const loadProducts = {
      execute: vi.fn().mockResolvedValue({
        status: "success",
        products: [product],
      }),
    };

    const service = createService({ invokeAgentTurn, loadProducts });

    await service.guide({
      merchant: { id: "merchant-id", name: "测试店铺" },
      question: "帮我推荐下",
      history: [],
      trace: { sessionId: "gift-follow-up-conversation" },
    });
    const second = await service.guide({
      merchant: { id: "merchant-id", name: "测试店铺" },
      question: "我想送长辈",
      history: [{ role: "assistant", content: "可以看看这款覆盆子玫瑰荔枝。" }],
      trace: { sessionId: "gift-follow-up-conversation" },
    });

    expect(loadProducts.execute).toHaveBeenCalledTimes(1);
    expect(invokeAgentTurn.mock.calls[2]?.[2]).toBeUndefined();
    expect(second).toEqual({
      reply: "送长辈的话，可以优先看这款覆盆子玫瑰荔枝，口味清爽，造型也比较稳重。",
      productIds: [productId],
    });
  });

  it("runs the merchant-info tool for merchant phone questions", async () => {
    const invokeAgentTurn = vi
      .fn()
      .mockImplementationOnce(async () =>
        new AIMessage({
          content: "",
          tool_calls: [{
            id: "call-merchant-info",
            name: "query_merchant_info",
            args: { query: "查询商家联系电话" },
            type: "tool_call",
          }],
        }),
      )
      .mockImplementationOnce(async (messages) => {
        const toolMessage = messages.find((message: unknown) =>
          ToolMessage.isInstance(message) && message.name === "query_merchant_info",
        ) as ToolMessage;
        expect(toolMessage.content).toContain("18600000000");
        return new AIMessage({
          content: JSON.stringify({
            reply: "商家的联系电话是 18600000000。",
            productIds: [],
          }),
        });
      });
    const queryMerchantInfo = {
      execute: vi.fn().mockResolvedValue({
        status: "success",
        infos: [{ field: "phone", label: "联系电话", value: "18600000000" }],
      }),
    };
    const selectProducts = {
      execute: vi.fn(async (input: { reply: string }) => ({
        status: "empty",
        products: [],
        reply: input.reply,
        productIds: [],
      })),
    };

    const service = createService({ invokeAgentTurn, queryMerchantInfo, selectProducts });

    const result = await service.guide({
      merchant: { id: "merchant-id", name: "测试店铺", phone: "18600000000" },
      question: "商家电话是多少？",
      history: [],
    });

    expect(queryMerchantInfo.execute).toHaveBeenCalledWith({
      merchant: { id: "merchant-id", name: "测试店铺", phone: "18600000000" },
      query: "查询商家联系电话",
    });
    expect(selectProducts.execute).toHaveBeenCalledWith({
      productIds: [],
      reply: "商家的联系电话是 18600000000。",
      question: "商家电话是多少？",
      products: expect.any(Object),
      currentProducts: { items: [] },
      reason: undefined,
    });
    expect(result).toEqual({
      reply: "商家的联系电话是 18600000000。",
      productIds: [],
    });
  });

  it("uses merchant-info tool reason for unsupported merchant fields", async () => {
    const invokeAgentTurn = vi
      .fn()
      .mockImplementationOnce(async () =>
        new AIMessage({
          content: "",
          tool_calls: [{
            id: "call-merchant-info",
            name: "query_merchant_info",
            args: { query: "查询商家营业时间" },
            type: "tool_call",
          }],
        }),
      )
      .mockImplementationOnce(async () =>
        new AIMessage({
          content: JSON.stringify({
            reply: "抱歉，目前没有查到营业时间信息。",
            productIds: [],
          }),
        }),
      );
    const queryMerchantInfo = {
      execute: vi.fn().mockResolvedValue({
        status: "unsupported",
        infos: [],
        reason: "当前暂未提供商家营业时间信息",
      }),
    };

    const service = createService({ invokeAgentTurn, queryMerchantInfo });

    const result = await service.guide({
      merchant: { id: "merchant-id", name: "测试店铺", phone: "18600000000" },
      question: "你家几点营业？",
      history: [],
    });

    expect(result).toEqual({
      reply: "当前暂未提供商家营业时间信息。",
      productIds: [],
    });
  });

  it("returns non-product chitchat without calling tools or showing cards", async () => {
    const invokeAgentTurn = vi.fn().mockResolvedValue(
      new AIMessage({
        content: JSON.stringify({
          reply: "天气我这边暂时看不了哦，不过可以帮你看看店里的蛋糕，想按口味还是预算来挑？",
          productIds: [],
        }),
      }),
    );
    const loadProducts = { execute: vi.fn() };
    const selectProducts = {
      execute: vi.fn(async (input: { reply: string }) => ({
        status: "empty",
        products: [],
        reply: input.reply,
        productIds: [],
      })),
    };
    const queryMerchantInfo = { execute: vi.fn() };

    const service = createService({
      invokeAgentTurn,
      loadProducts,
      selectProducts,
      queryMerchantInfo,
    });

    const result = await service.guide({
      merchant: { id: "merchant-id", name: "测试店铺" },
      question: "今天天气？",
      history: [],
    });

    expect(loadProducts.execute).not.toHaveBeenCalled();
    expect(selectProducts.execute).toHaveBeenCalledWith({
      productIds: [],
      reply: "天气我这边暂时看不了哦，不过可以帮你看看店里的蛋糕，想按口味还是预算来挑？",
      question: "今天天气？",
      products: expect.any(Object),
      currentProducts: { items: [] },
      reason: undefined,
    });
    expect(queryMerchantInfo.execute).not.toHaveBeenCalled();
    expect(result).toEqual({
      reply: "天气我这边暂时看不了哦，不过可以帮你看看店里的蛋糕，想按口味还是预算来挑？",
      productIds: [],
    });
  });

  it("recovers cards when a product reply names products without explicit ids", async () => {
    const firstId = "271a7ad7-8722-45e8-b37c-19370070b438";
    const secondId = "7df2309a-918c-4b23-bc79-e03fb6801368";
    const products = [
      productSnapshot({
        id: firstId,
        title: "杨梅季 杨梅冷萃酸奶蛋糕",
        category: "水果蛋糕",
        priceText: "¥138-¥258",
      }),
      productSnapshot({
        id: secondId,
        title: "明媚春日系列 芒果百香果",
        category: "水果蛋糕",
        priceText: "¥138",
      }),
    ];
    const invokeAgentTurn = vi
      .fn()
      .mockImplementationOnce(async () =>
        new AIMessage({
          content: "",
          tool_calls: [{
            id: "call-load",
            name: "load_products",
            args: { reason: "用户咨询水果口味" },
            type: "tool_call",
          }],
        }),
      )
      .mockImplementationOnce(async () =>
        new AIMessage({
          content: JSON.stringify({
            reply: "有的，给你挑几款水果口味：\n1. 杨梅季 杨梅冷萃酸奶蛋糕\n2. 明媚春日系列 芒果百香果",
            productIds: [],
          }),
        }),
      );
    const loadProducts = {
      execute: vi.fn().mockResolvedValue({
        status: "success",
        products,
      }),
    };

    const service = createService({ invokeAgentTurn, loadProducts });

    const result = await service.guide({
      merchant: { id: "merchant-id", name: "测试店铺" },
      question: "有水果的吗",
      history: [],
    });

    expect(result).toEqual({
      reply: "有的，给你挑几款水果口味：\n1. 杨梅季 杨梅冷萃酸奶蛋糕\n2. 明媚春日系列 芒果百香果",
      productIds: [firstId, secondId],
    });
  });

  it("answers focused product detail follow-ups with product cards", async () => {
    const productId = "271a7ad7-8722-45e8-b37c-19370070b438";
    const invokeAgentTurn = vi.fn().mockResolvedValue(
      new AIMessage({
        content: JSON.stringify({
          reply: "6寸规格比较适合3个人吃。",
          productIds: [],
        }),
      }),
    );

    const service = createService({ invokeAgentTurn });

    const result = await service.guide({
      merchant: { id: "merchant-id", name: "测试店铺" },
      question: "6寸吧",
      history: [],
      recentProducts: [{ id: productId, name: "草莓蛋糕" }],
    });

    expect(result).toEqual({
      reply: "6寸规格比较适合3个人吃。",
      productIds: [productId],
    });
  });

  it("does not attach product cards for assortment overview replies", async () => {
    const productId = "271a7ad7-8722-45e8-b37c-19370070b438";
    const product = productSnapshot({
      id: productId,
      title: "蜡笔小新蛋糕",
      category: "蛋糕",
      priceText: "¥308-¥378",
    });
    const invokeAgentTurn = vi
      .fn()
      .mockImplementationOnce(async () =>
        new AIMessage({
          content: "",
          tool_calls: [{
            id: "call-load",
            name: "load_products",
            args: { reason: "用户询问店里商品范围" },
            type: "tool_call",
          }],
        }),
      )
      .mockImplementationOnce(async () =>
        new AIMessage({
          content: JSON.stringify({
            reply: "店里除了蛋糕，也有甜品、饮品和小食，可以按口味或预算继续挑。",
            productIds: [productId],
          }),
        }),
      );
    const loadProducts = {
      execute: vi.fn().mockResolvedValue({
        status: "success",
        products: [product],
      }),
    };

    const service = createService({ invokeAgentTurn, loadProducts });

    const result = await service.guide({
      merchant: { id: "merchant-id", name: "测试店铺" },
      question: "除了蛋糕还卖什么吗",
      history: [],
    });

    expect(result).toEqual({
      reply: "店里除了蛋糕，也有甜品、饮品和小食，可以按口味或预算继续挑。",
      productIds: [],
    });
  });

  it("removes cards from assortment follow-ups even if the model returns recommendation ids", async () => {
    const productId = "271a7ad7-8722-45e8-b37c-19370070b438";
    const product = productSnapshot({
      id: productId,
      title: "美式巧克力坚果大曲奇",
      category: "小零食",
      priceText: "¥128",
    });
    const invokeAgentTurn = vi.fn().mockResolvedValue(
      new AIMessage({
        content: JSON.stringify({
          reply: "店里还有其他品类：\n- 美式巧克力坚果大曲奇\n- 4寸专区",
          productIds: [productId],
        }),
      }),
    );

    const service = createService({
      invokeAgentTurn,
      loadProducts: { execute: vi.fn().mockResolvedValue({ status: "success", products: [product] }) },
    });

    const result = await service.guide({
      merchant: { id: "merchant-id", name: "测试店铺" },
      question: "还有其他吗",
      history: [],
      recentProducts: [{ id: productId, name: "美式巧克力坚果大曲奇" }],
    });

    expect(result).toEqual({
      reply: "店里还有其他品类：\n- 美式巧克力坚果大曲奇\n- 4寸专区",
      productIds: [],
    });
  });

  it("keeps explicit final product card order from the model output", async () => {
    const firstId = "271a7ad7-8722-45e8-b37c-19370070b438";
    const secondId = "7df2309a-918c-4b23-bc79-e03fb6801368";
    const invokeAgentTurn = vi.fn().mockResolvedValue(
      new AIMessage({
        content: JSON.stringify({
          reply: "可以这样看：\n1. 巧克力蛋糕\n2. 草莓蛋糕",
          productIds: [firstId, secondId],
        }),
      }),
    );

    const service = createService({ invokeAgentTurn });

    const result = await service.guide({
      merchant: { id: "merchant-id", name: "测试店铺" },
      question: "这两款怎么选",
      history: [],
      recentProducts: [
        { id: firstId, name: "草莓蛋糕" },
        { id: secondId, name: "巧克力蛋糕" },
      ],
    });

    expect(result).toEqual({
      reply: "可以这样看：\n1. 巧克力蛋糕\n2. 草莓蛋糕",
      productIds: [firstId, secondId],
    });
  });

  it("does not ask the model to retry when the internal product finalizer fails", async () => {
    const productId = "271a7ad7-8722-45e8-b37c-19370070b438";
    const invokeAgentTurn = vi.fn().mockResolvedValue(
      new AIMessage({
        content: JSON.stringify({
          reply: "可以看看这款草莓蛋糕。",
          productIds: [productId],
        }),
      }),
    );
    const selectProducts = {
      execute: vi.fn().mockRejectedValue(new Error("商品结果整理失败")),
    };

    const service = createService({ invokeAgentTurn, selectProducts });

    const result = await service.guide({
      merchant: { id: "merchant-id", name: "测试店铺" },
      question: "今天天气？",
      history: [],
    });

    expect(invokeAgentTurn).toHaveBeenCalledTimes(1);
    expect(selectProducts.execute).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      reply: "我暂时没能完成这次查询，可以换个口味、预算或商品类型再试试。",
      productIds: [],
    });
  });

  it("does not fail when the final model reply is plain text", async () => {
    const invokeAgentTurn = vi.fn().mockResolvedValue(
      new AIMessage("天气我这边暂时看不了哦，不过可以帮你看看店里的蛋糕。"),
    );

    const service = createService({ invokeAgentTurn });

    const result = await service.guide({
      merchant: { id: "merchant-id", name: "测试店铺" },
      question: "今天天气？",
      history: [],
    });

    expect(result).toEqual({
      reply: "天气我这边暂时看不了哦，不过可以帮你看看店里的蛋糕。",
      productIds: [],
    });
  });
});

function createService(input: {
  invokeAgentTurn: ReturnType<typeof vi.fn>;
  loadProducts?: { execute: ReturnType<typeof vi.fn> };
  selectProducts?: { execute: ReturnType<typeof vi.fn> } | SelectProductsService;
  queryMerchantInfo?: { execute: ReturnType<typeof vi.fn> };
}) {
  return new GuideGraphService(
    { isConfigured: () => true, invokeAgentTurn: input.invokeAgentTurn } as never,
    (input.loadProducts || {
      execute: vi.fn().mockResolvedValue({ status: "empty", products: [] }),
    }) as never,
    (input.selectProducts || new SelectProductsService()) as never,
    (input.queryMerchantInfo || { execute: vi.fn() }) as never,
  );
}

function productSnapshot(input: {
  id: string;
  title: string;
  category: string;
  priceText: string;
  tags?: string[];
}) {
  return {
    id: input.id,
    title: input.title,
    category: input.category,
    priceText: input.priceText,
    minPrice: 128,
    maxPrice: 128,
    tags: input.tags || [],
    priceOptions: [],
  };
}

function toolNames(value: unknown): string[] {
  const tools = Array.isArray(value) ? value : [];
  return tools
    .map((item) => {
      const tool = item as { function?: { name?: string } };
      return tool.function?.name;
    })
    .filter((name): name is string => Boolean(name));
}
