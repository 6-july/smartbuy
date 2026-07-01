import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it, vi } from "vitest";
import { GuideGraphService } from "../../../../src/ai/graph/guide-graph.service";

describe("GuideGraphService", () => {
  it("runs an agent-tool-agent loop and returns validated product ids", async () => {
    const productId = "271a7ad7-8722-45e8-b37c-19370070b438";
    const invokeAgentTurn = vi
      .fn()
      .mockImplementationOnce(async () =>
        new AIMessage({
          content: "",
          tool_calls: [{
            id: "call-1",
            name: "query_products",
            args: { query: "推荐蛋糕" },
            type: "tool_call",
          }],
        }),
      )
      .mockImplementationOnce(async (messages) => {
        const toolMessage = messages.find((message: unknown) =>
          ToolMessage.isInstance(message),
        ) as ToolMessage;
        expect(toolMessage.content).toContain(productId);
        return new AIMessage({
          content: JSON.stringify({
            reply: "可以看看这款草莓蛋糕。",
            productIds: [productId, "not-from-tool"],
            answerType: "recommendation",
          }),
        });
      });
    const queryProducts = {
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

    const service = new GuideGraphService(
      { isConfigured: () => true, invokeAgentTurn } as never,
      queryProducts as never,
      { execute: vi.fn() } as never,
    );

    const result = await service.guide({
      merchant: { id: "merchant-id", name: "测试店铺" },
      question: "我想要蛋糕",
      history: [],
    });

    expect(queryProducts.execute).toHaveBeenCalledWith({
      merchantId: "merchant-id",
      query: "推荐蛋糕",
      products: { shown: [] },
    });
    expect(result).toEqual({
      reply: "可以看看这款草莓蛋糕。",
      productIds: [productId],
    });
    expect(invokeAgentTurn).toHaveBeenCalledTimes(2);
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

    const service = new GuideGraphService(
      { isConfigured: () => true, invokeAgentTurn } as never,
      { execute: vi.fn() } as never,
      queryMerchantInfo as never,
    );

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
    expect(invokeAgentTurn).toHaveBeenCalledTimes(2);
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
            args: { query: "查询商家地址" },
            type: "tool_call",
          }],
        }),
      )
      .mockImplementationOnce(async () =>
        new AIMessage({
          content: JSON.stringify({
            reply: "抱歉，目前没有查到地址信息，你可以联系商家咨询。",
            productIds: [],
            answerType: "merchant_info",
          }),
        }),
      );
    const queryMerchantInfo = {
      execute: vi.fn().mockResolvedValue({
        status: "unsupported",
        infos: [],
        reason: "当前暂未提供商家地址信息",
      }),
    };

    const service = new GuideGraphService(
      { isConfigured: () => true, invokeAgentTurn } as never,
      { execute: vi.fn() } as never,
      queryMerchantInfo as never,
    );

    const result = await service.guide({
      merchant: { id: "merchant-id", name: "测试店铺", phone: "18600000000" },
      question: "你家地址是啥？",
      history: [],
    });

    expect(queryMerchantInfo.execute).toHaveBeenCalledWith({
      merchant: { id: "merchant-id", name: "测试店铺", phone: "18600000000" },
      query: "查询商家地址",
    });
    expect(result).toEqual({
      reply: "当前暂未提供商家地址信息。",
      productIds: [],
    });
  });

  it("executes multiple tool calls through the shared tools node", async () => {
    const productId = "271a7ad7-8722-45e8-b37c-19370070b438";
    const invokeAgentTurn = vi
      .fn()
      .mockImplementationOnce(async () =>
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "call-products",
              name: "query_products",
              args: { query: "推荐草莓蛋糕" },
              type: "tool_call",
            },
            {
              id: "call-merchant-info",
              name: "query_merchant_info",
              args: { query: "查询商家联系电话" },
              type: "tool_call",
            },
          ],
        }),
      )
      .mockImplementationOnce(async (messages) => {
        const toolMessages = messages.filter((message: unknown) =>
          ToolMessage.isInstance(message),
        ) as ToolMessage[];
        expect(toolMessages).toHaveLength(2);
        expect(toolMessages.map((message) => message.name)).toEqual([
          "query_products",
          "query_merchant_info",
        ]);
        expect(toolMessages[0].content).toContain(productId);
        expect(toolMessages[1].content).toContain("18600000000");
        return new AIMessage({
          content: JSON.stringify({
            reply: "可以看看草莓蛋糕，商家电话是 18600000000。",
            productIds: [productId],
            answerType: "recommendation",
          }),
        });
      });
    const queryProducts = {
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
    const queryMerchantInfo = {
      execute: vi.fn().mockResolvedValue({
        status: "success",
        infos: [{ field: "phone", label: "联系电话", value: "18600000000" }],
      }),
    };

    const service = new GuideGraphService(
      { isConfigured: () => true, invokeAgentTurn } as never,
      queryProducts as never,
      queryMerchantInfo as never,
    );

    const result = await service.guide({
      merchant: { id: "merchant-id", name: "测试店铺", phone: "18600000000" },
      question: "推荐草莓蛋糕，顺便告诉我电话",
      history: [],
    });

    expect(queryProducts.execute).toHaveBeenCalledWith({
      merchantId: "merchant-id",
      query: "推荐草莓蛋糕",
      products: { shown: [] },
    });
    expect(queryMerchantInfo.execute).toHaveBeenCalledWith({
      merchant: { id: "merchant-id", name: "测试店铺", phone: "18600000000" },
      query: "查询商家联系电话",
    });
    expect(result).toEqual({
      reply: "可以看看草莓蛋糕，商家电话是 18600000000。",
      productIds: [productId],
    });
  });

  it("forces product search for broad recommendation questions", async () => {
    const productId = "271a7ad7-8722-45e8-b37c-19370070b438";
    const invokeAgentTurn = vi
      .fn()
      .mockImplementationOnce(async () =>
        new AIMessage({
          content: "",
          tool_calls: [{
            id: "call-products",
            name: "query_products",
            args: { query: "推荐当前商家蛋糕" },
            type: "tool_call",
          }],
        }),
      )
      .mockImplementationOnce(async () =>
        new AIMessage({
          content: JSON.stringify({
            reply: "可以先看看这款热销蛋糕。",
            productIds: [productId],
            answerType: "recommendation",
          }),
        }),
      );
    const queryProducts = {
      execute: vi.fn().mockResolvedValue({
        status: "success",
        products: [{
          id: productId,
          title: "热销蛋糕",
          category: "蛋糕",
          priceText: "¥128",
          minPrice: 128,
          maxPrice: 128,
          tags: [],
          priceOptions: [],
        }],
      }),
    };

    const service = new GuideGraphService(
      { isConfigured: () => true, invokeAgentTurn } as never,
      queryProducts as never,
      { execute: vi.fn() } as never,
    );

    const result = await service.guide({
      merchant: { id: "merchant-id", name: "测试店铺", industry: "蛋糕" },
      question: "推荐下",
      history: [],
    });

    expect(invokeAgentTurn.mock.calls[0]?.[2]).toEqual({
      toolChoice: {
        type: "function",
        function: { name: "query_products" },
      },
    });
    expect(invokeAgentTurn.mock.calls[1]?.[2]).toBeUndefined();
    expect(queryProducts.execute).toHaveBeenCalledWith({
      merchantId: "merchant-id",
      query: "推荐当前商家蛋糕",
      products: { shown: [] },
    });
    expect(result).toEqual({
      reply: "可以先看看这款热销蛋糕。",
      productIds: [productId],
    });
  });

  it("returns non-product chitchat without calling tools", async () => {
    const invokeAgentTurn = vi.fn().mockResolvedValue(
      new AIMessage({
        content: JSON.stringify({
          reply: "我主要帮你咨询本店商品和商家信息，暂时不能查询天气。你可以继续问我蛋糕口味、价格或店铺电话。",
          productIds: [],
          answerType: "chitchat",
        }),
      }),
    );
    const queryProducts = { execute: vi.fn() };
    const queryMerchantInfo = { execute: vi.fn() };

    const service = new GuideGraphService(
      { isConfigured: () => true, invokeAgentTurn } as never,
      queryProducts as never,
      queryMerchantInfo as never,
    );

    const result = await service.guide({
      merchant: { id: "merchant-id", name: "测试店铺" },
      question: "今天天气？",
      history: [],
    });

    expect(queryProducts.execute).not.toHaveBeenCalled();
    expect(queryMerchantInfo.execute).not.toHaveBeenCalled();
    expect(result).toEqual({
      reply: "我主要帮你咨询本店商品和商家信息，暂时不能查询天气。你可以继续问我蛋糕口味、价格或店铺电话。",
      productIds: [],
    });
  });

  it("does not fail when the final model reply is plain text", async () => {
    const invokeAgentTurn = vi.fn().mockResolvedValue(
      new AIMessage("我主要帮你咨询本店商品和商家信息，暂时不能查询天气。"),
    );

    const service = new GuideGraphService(
      { isConfigured: () => true, invokeAgentTurn } as never,
      { execute: vi.fn() } as never,
      { execute: vi.fn() } as never,
    );

    const result = await service.guide({
      merchant: { id: "merchant-id", name: "测试店铺" },
      question: "今天天气？",
      history: [],
    });

    expect(result).toEqual({
      reply: "我主要帮你咨询本店商品和商家信息，暂时不能查询天气。",
      productIds: [],
    });
  });

  it("keeps product cards when a product tool succeeds but final reply is plain text", async () => {
    const productId = "271a7ad7-8722-45e8-b37c-19370070b438";
    const invokeAgentTurn = vi
      .fn()
      .mockImplementationOnce(async () =>
        new AIMessage({
          content: "",
          tool_calls: [{
            id: "call-1",
            name: "query_products",
            args: { query: "推荐蛋糕" },
            type: "tool_call",
          }],
        }),
      )
      .mockImplementationOnce(async () =>
        new AIMessage("这款草莓蛋糕比较适合，可以看看。"),
      );
    const queryProducts = {
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

    const service = new GuideGraphService(
      { isConfigured: () => true, invokeAgentTurn } as never,
      queryProducts as never,
      { execute: vi.fn() } as never,
    );

    const result = await service.guide({
      merchant: { id: "merchant-id", name: "测试店铺" },
      question: "推荐蛋糕",
      history: [],
    });

    expect(result).toEqual({
      reply: "这款草莓蛋糕比较适合，可以看看。",
      productIds: [productId],
    });
  });

  it("limits final product cards to products returned by the current tool call", async () => {
    const firstProductId = "271a7ad7-8722-45e8-b37c-19370070b438";
    const secondProductId = "7df2309a-918c-4b23-bc79-e03fb6801368";
    const invokeAgentTurn = vi
      .fn()
      .mockImplementationOnce(async () =>
        new AIMessage({
          content: "",
          tool_calls: [{
            id: "call-1",
            name: "query_products",
            args: { query: "介绍第二款" },
            type: "tool_call",
          }],
        }),
      )
      .mockImplementationOnce(async () =>
        new AIMessage({
          content: JSON.stringify({
            reply: "第二款是覆盆子玫瑰荔枝，口感清爽。",
            productIds: [firstProductId, secondProductId],
            answerType: "product_detail",
          }),
        }),
      );
    const queryProducts = {
      execute: vi.fn().mockResolvedValue({
        status: "success",
        products: [
          {
            id: firstProductId,
            title: "伯爵红茶奶油蛋糕",
            category: "蛋糕",
            priceText: "¥128-¥378",
            minPrice: 128,
            maxPrice: 378,
            tags: [],
            priceOptions: [],
          },
          {
            id: secondProductId,
            title: "【热销】覆盆子玫瑰荔枝",
            category: "蛋糕",
            priceText: "¥138-¥398",
            minPrice: 138,
            maxPrice: 398,
            tags: ["热销"],
            priceOptions: [],
          },
        ],
      }),
    };

    const service = new GuideGraphService(
      { isConfigured: () => true, invokeAgentTurn } as never,
      queryProducts as never,
      { execute: vi.fn() } as never,
    );

    const result = await service.guide({
      merchant: { id: "merchant-id", name: "测试店铺" },
      question: "给我介绍下第二款",
      history: [],
      recentProducts: [
        { id: firstProductId, name: "伯爵红茶奶油蛋糕" },
        { id: secondProductId, name: "覆盆子玫瑰荔枝" },
      ],
    });

    expect(result).toEqual({
      reply: "第二款是覆盆子玫瑰荔枝，口感清爽。",
      productIds: [secondProductId],
    });
  });

  it("keeps a referenced product card for unsupported realtime product facts", async () => {
    const productId = "271a7ad7-8722-45e8-b37c-19370070b438";
    const invokeAgentTurn = vi
      .fn()
      .mockImplementationOnce(async () =>
        new AIMessage({
          content: "",
          tool_calls: [{
            id: "call-1",
            name: "query_products",
            args: { query: "查询海盐奥利奥是否有优惠" },
            type: "tool_call",
          }],
        }),
      )
      .mockImplementationOnce(async () =>
        new AIMessage({
          content: JSON.stringify({
            reply: "这款的实时优惠当前无法确认。",
            productIds: [productId],
            answerType: "unsupported_fact",
          }),
        }),
      );
    const queryProducts = {
      execute: vi.fn().mockResolvedValue({
        status: "unsupported_fact",
        reason: "「海盐奥利奥」的实时优惠当前没有接入数据源，无法确认",
        products: [{
          id: productId,
          title: "海盐奥利奥",
          category: "蛋糕",
          priceText: "¥128-¥258",
          minPrice: 128,
          maxPrice: 258,
          tags: [],
          priceOptions: [],
        }],
      }),
    };

    const service = new GuideGraphService(
      { isConfigured: () => true, invokeAgentTurn } as never,
      queryProducts as never,
      { execute: vi.fn() } as never,
    );

    const result = await service.guide({
      merchant: { id: "merchant-id", name: "测试店铺" },
      question: "你家有优惠吗",
      history: [],
      recentProducts: [{ id: productId, name: "海盐奥利奥" }],
    });

    expect(result).toEqual({
      reply: "这款的实时优惠当前无法确认。",
      productIds: [productId],
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

    const service = new GuideGraphService(
      { isConfigured: () => true, invokeAgentTurn } as never,
      { execute: vi.fn() } as never,
      { execute: vi.fn() } as never,
    );

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

  it("keeps the referenced recent product card when the user points back to it", async () => {
    const productId = "271a7ad7-8722-45e8-b37c-19370070b438";
    const invokeAgentTurn = vi.fn().mockResolvedValue(
      new AIMessage({
        content: JSON.stringify({
          reply: "那还是推荐你之前看的这款，尺寸和价格都比较合适。",
          productIds: [],
          answerType: "chitchat",
        }),
      }),
    );

    const service = new GuideGraphService(
      { isConfigured: () => true, invokeAgentTurn } as never,
      { execute: vi.fn() } as never,
      { execute: vi.fn() } as never,
    );

    const result = await service.guide({
      merchant: { id: "merchant-id", name: "测试店铺" },
      question: "我还是觉得刚才那个好",
      history: [],
      recentProducts: [{ id: productId, name: "海盐奥利奥蛋糕" }],
    });

    expect(result).toEqual({
      reply: "那还是推荐你之前看的这款，尺寸和价格都比较合适。",
      productIds: [productId],
    });
  });

  it("does not attach a recent product card for merchant-info references", async () => {
    const productId = "271a7ad7-8722-45e8-b37c-19370070b438";
    const invokeAgentTurn = vi.fn().mockResolvedValue(
      new AIMessage({
        content: JSON.stringify({
          reply: "商家的联系电话是 18600000000。",
          productIds: [],
          answerType: "merchant_info",
        }),
      }),
    );

    const service = new GuideGraphService(
      { isConfigured: () => true, invokeAgentTurn } as never,
      { execute: vi.fn() } as never,
      { execute: vi.fn() } as never,
    );

    const result = await service.guide({
      merchant: { id: "merchant-id", name: "测试店铺", phone: "18600000000" },
      question: "这个店电话是多少？",
      history: [],
      recentProducts: [{ id: productId, name: "海盐奥利奥蛋糕" }],
    });

    expect(result).toEqual({
      reply: "商家的联系电话是 18600000000。",
      productIds: [],
    });
  });
});
