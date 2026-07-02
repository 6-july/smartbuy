import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it, vi } from "vitest";
import { GuideGraphService } from "../../../../src/ai/graph/guide-graph.service";

describe("GuideGraphService", () => {
  it("runs a load-products/select-products loop and returns validated product ids", async () => {
    const productId = "271a7ad7-8722-45e8-b37c-19370070b438";
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
          content: "",
          tool_calls: [{
            id: "call-select",
            name: "select_products",
            args: {
              productIds: [productId, "not-from-pool"],
              reply: "可以看看这款草莓蛋糕。",
              answerType: "recommendation",
              reason: "选择草莓蛋糕推荐给用户",
            },
            type: "tool_call",
          }],
        });
      });
    const loadProducts = {
      execute: vi.fn().mockResolvedValue({
        status: "success",
        products: [{
          id: productId,
          title: "草莓蛋糕",
          category: "蛋糕",
          priceText: "¥128",
          minPrice: 128,
          maxPrice: 128,
          tags: ["草莓"],
          priceOptions: [],
        }],
      }),
    };
    const selectProducts = {
      execute: vi.fn().mockResolvedValue({
        status: "invalid",
        invalidProductIds: ["not-from-pool"],
        products: [{
          id: productId,
          title: "草莓蛋糕",
          category: "蛋糕",
          priceText: "¥128",
          minPrice: 128,
          maxPrice: 128,
          tags: ["草莓"],
          priceOptions: [],
        }],
        reply: "可以看看这款草莓蛋糕。",
        productIds: [productId],
        answerType: "recommendation",
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
    expect(invokeAgentTurn.mock.calls[1]?.[2]).toEqual({
      toolChoice: {
        type: "function",
        function: { name: "select_products" },
      },
    });
    expect(loadProducts.execute).toHaveBeenCalledWith({
      merchantId: "merchant-id",
      reason: "用户想看蛋糕",
    });
    expect(selectProducts.execute).toHaveBeenCalledWith({
      productIds: [productId, "not-from-pool"],
      reply: "可以看看这款草莓蛋糕。",
      answerType: "recommendation",
      question: "我想要蛋糕",
      products: expect.objectContaining({
        items: [expect.objectContaining({ id: productId })],
      }),
      currentProducts: { items: [] },
      reason: "选择草莓蛋糕推荐给用户",
    });
    expect(result).toEqual({
      reply: "可以看看这款草莓蛋糕。",
      productIds: [productId],
    });
    expect(invokeAgentTurn).toHaveBeenCalledTimes(2);
  });

  it("reuses products from graph state within the same conversation thread", async () => {
    const productId = "271a7ad7-8722-45e8-b37c-19370070b438";
    const product = {
      id: productId,
      title: "草莓蛋糕",
      category: "蛋糕",
      priceText: "¥128",
      minPrice: 128,
      maxPrice: 128,
      tags: ["草莓"],
      priceOptions: [],
    };
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
          content: "",
          tool_calls: [{
            id: "call-select-first",
            name: "select_products",
            args: {
              productIds: [productId],
              reply: "可以看看这款草莓蛋糕。",
              answerType: "recommendation",
            },
            type: "tool_call",
          }],
        }),
      )
      .mockImplementationOnce(async () =>
        new AIMessage({
          content: "",
          tool_calls: [{
            id: "call-select-second",
            name: "select_products",
            args: {
              productIds: [productId],
              reply: "这款草莓蛋糕是¥128。",
              answerType: "product_detail",
            },
            type: "tool_call",
          }],
        }),
      );
    const loadProducts = {
      execute: vi.fn().mockResolvedValue({
        status: "success",
        products: [product],
      }),
    };
    const selectProducts = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({
          status: "success",
          products: [product],
          reply: "可以看看这款草莓蛋糕。",
          productIds: [productId],
          answerType: "recommendation",
        })
        .mockResolvedValueOnce({
          status: "success",
          products: [product],
          reply: "这款草莓蛋糕是¥128。",
          productIds: [productId],
          answerType: "product_detail",
        }),
    };

    const service = createService({ invokeAgentTurn, loadProducts, selectProducts });

    await service.guide({
      merchant: { id: "merchant-id", name: "测试店铺" },
      question: "推荐蛋糕",
      history: [],
      trace: { sessionId: "conversation-id" },
    });
    const second = await service.guide({
      merchant: { id: "merchant-id", name: "测试店铺" },
      question: "这款多少钱",
      history: [{ role: "assistant", content: "可以看看这款草莓蛋糕。" }],
      trace: { sessionId: "conversation-id" },
    });

    expect(loadProducts.execute).toHaveBeenCalledTimes(1);
    expect(invokeAgentTurn.mock.calls[2]?.[2]).toEqual({
      toolChoice: {
        type: "function",
        function: { name: "select_products" },
      },
    });
    expect(selectProducts.execute).toHaveBeenNthCalledWith(2, {
      productIds: [productId],
      reply: "这款草莓蛋糕是¥128。",
      answerType: "product_detail",
      question: "这款多少钱",
      products: expect.objectContaining({
        items: [expect.objectContaining({ id: productId })],
      }),
      currentProducts: { items: [], focusedId: productId },
      reason: undefined,
    });
    expect(second).toEqual({
      reply: "这款草莓蛋糕是¥128。",
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
            answerType: "merchant_info",
          }),
        });
      });
    const queryMerchantInfo = {
      execute: vi.fn().mockResolvedValue({
        status: "success",
        infos: [{ field: "phone", label: "联系电话", value: "18600000000" }],
      }),
    };

    const service = createService({ invokeAgentTurn, queryMerchantInfo });

    const result = await service.guide({
      merchant: { id: "merchant-id", name: "测试店铺", phone: "18600000000" },
      question: "商家电话是多少？",
      history: [],
    });

    expect(queryMerchantInfo.execute).toHaveBeenCalledWith({
      merchant: { id: "merchant-id", name: "测试店铺", phone: "18600000000" },
      query: "查询商家联系电话",
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
            answerType: "merchant_info",
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

  it("returns non-product chitchat without calling tools", async () => {
    const invokeAgentTurn = vi.fn().mockResolvedValue(
      new AIMessage({
        content: JSON.stringify({
          reply: "天气我这边暂时看不了哦，不过可以帮你看看店里的蛋糕，想按口味还是预算来挑？",
          productIds: [],
          answerType: "chitchat",
        }),
      }),
    );
    const loadProducts = { execute: vi.fn() };
    const selectProducts = { execute: vi.fn() };
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
    expect(selectProducts.execute).not.toHaveBeenCalled();
    expect(queryMerchantInfo.execute).not.toHaveBeenCalled();
    expect(result).toEqual({
      reply: "天气我这边暂时看不了哦，不过可以帮你看看店里的蛋糕，想按口味还是预算来挑？",
      productIds: [],
    });
  });

  it("attaches the focused product card for product detail follow-ups", async () => {
    const productId = "271a7ad7-8722-45e8-b37c-19370070b438";
    const invokeAgentTurn = vi.fn().mockResolvedValue(
      new AIMessage({
        content: JSON.stringify({
          reply: "6寸规格比较适合3个人吃。",
          productIds: [],
          answerType: "product_detail",
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

  it("does not attach product cards for assortment overview questions", async () => {
    const productId = "271a7ad7-8722-45e8-b37c-19370070b438";
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
          content: "",
          tool_calls: [{
            id: "call-select",
            name: "select_products",
            args: {
              productIds: [productId],
              reply: "店里除了蛋糕，也有甜品、饮品和小食，可以按口味或预算继续挑。",
              answerType: "recommendation",
            },
            type: "tool_call",
          }],
        }),
      );
    const loadProducts = {
      execute: vi.fn().mockResolvedValue({
        status: "success",
        products: [{
          id: productId,
          title: "蜡笔小新蛋糕",
          category: "蛋糕",
          priceText: "¥308-¥378",
          priceOptions: [],
        }],
      }),
    };
    const selectProducts = {
      execute: vi.fn().mockResolvedValue({
        status: "success",
        products: [{ id: productId, title: "蜡笔小新蛋糕", priceText: "¥308-¥378" }],
        reply: "店里除了蛋糕，也有甜品、饮品和小食，可以按口味或预算继续挑。",
        productIds: [productId],
        answerType: "recommendation",
      }),
    };

    const service = createService({ invokeAgentTurn, loadProducts, selectProducts });

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
  selectProducts?: { execute: ReturnType<typeof vi.fn> };
  queryMerchantInfo?: { execute: ReturnType<typeof vi.fn> };
}) {
  return new GuideGraphService(
    { isConfigured: () => true, invokeAgentTurn: input.invokeAgentTurn } as never,
    (input.loadProducts || { execute: vi.fn() }) as never,
    (input.selectProducts || { execute: vi.fn() }) as never,
    (input.queryMerchantInfo || { execute: vi.fn() }) as never,
  );
}
