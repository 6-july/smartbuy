import { describe, expect, it, vi } from "vitest";
import { LoadProductsService } from "../../../../../src/ai/graph/tools/load-products.service";
import { SelectProductsInputSchema } from "../../../../../src/ai/graph/tools/select-products.contract";
import { SelectProductsService } from "../../../../../src/ai/graph/tools/select-products.service";

describe("product loop tools", () => {
  it("loads all merchant products into product snapshots", async () => {
    const service = new LoadProductsService({
      findAllForMerchant: vi.fn().mockResolvedValue([
        retrievedProduct({
          id: "271a7ad7-8722-45e8-b37c-19370070b438",
          title: "海盐奥利奥",
          optionsText: "海盐奥利奥 4寸¥128 5寸¥188",
          minPrice: 128,
          maxPrice: 188,
        }),
      ]),
    } as never);

    const result = await service.execute({
      merchantId: "merchant-id",
      reason: "用户咨询最便宜的蛋糕",
    });

    expect(result.status).toBe("success");
    expect(result.products[0]).toEqual(expect.objectContaining({
      id: "271a7ad7-8722-45e8-b37c-19370070b438",
      title: "海盐奥利奥",
      priceText: "¥128-¥188",
      minPrice: 128,
      maxPrice: 188,
    }));
  });

  it("selects only products that exist in the product pool", async () => {
    const service = new SelectProductsService();

    const result = await service.execute({
      productIds: [
        "271a7ad7-8722-45e8-b37c-19370070b438",
        "missing-product",
      ],
      reply: "可以看看海盐奥利奥。",
      answerType: "recommendation",
      products: {
        items: [{
          id: "271a7ad7-8722-45e8-b37c-19370070b438",
          title: "海盐奥利奥",
          priceText: "¥128",
        }],
      },
      currentProducts: { items: [] },
      reason: "用户选择第一款",
    });

    expect(result.status).toBe("invalid");
    expect(result.products).toEqual([
      expect.objectContaining({
        id: "271a7ad7-8722-45e8-b37c-19370070b438",
      }),
    ]);
    expect(result.invalidProductIds).toEqual(["missing-product"]);
    expect(result.reply).toBe("可以看看海盐奥利奥。");
    expect(result.productIds).toEqual(["271a7ad7-8722-45e8-b37c-19370070b438"]);
  });

  it("allows a final no-match reply without product cards", async () => {
    const service = new SelectProductsService();

    const result = await service.execute({
      productIds: [],
      reply: "暂时没找到完全匹配的商品，可以换个口味或预算试试。",
      answerType: "no_match",
      products: { items: [] },
      currentProducts: { items: [] },
    });

    expect(result).toEqual({
      status: "empty",
      products: [],
      reply: "暂时没找到完全匹配的商品，可以换个口味或预算试试。",
      productIds: [],
      answerType: "no_match",
      reason: "未选择任何商品",
    });
  });

  it("normalizes html and markdown in final product replies", async () => {
    const service = new SelectProductsService();

    const result = await service.execute({
      productIds: ["271a7ad7-8722-45e8-b37c-19370070b438"],
      reply: "可以看看** 抹茶栗子 **：<br><br>1. 4寸 ¥128<br>2. 5寸 ¥198",
      answerType: "recommendation",
      products: {
        items: [{
          id: "271a7ad7-8722-45e8-b37c-19370070b438",
          title: "抹茶栗子",
          priceText: "¥128-¥378",
        }],
      },
      currentProducts: { items: [] },
    });

    expect(result.reply).toBe("可以看看抹茶栗子：\n\n1. 4寸 ¥128\n2. 5寸 ¥198");
  });

  it("normalizes escaped newlines without adding unselected product cards", async () => {
    const service = new SelectProductsService();

    const result = await service.execute({
      productIds: ["p1"],
      reply: "推荐这款：\\n\\n1. 法芙娜梦龙牛巧巧克力脆脆\\n这款也有海盐奥利奥口味可选。",
      answerType: "recommendation",
      products: {
        items: [
          { id: "p1", title: "法芙娜梦龙牛巧巧克力脆脆", priceText: "¥158-¥398" },
          { id: "p2", title: "海盐奥利奥", priceText: "¥128-¥258" },
        ],
      },
      currentProducts: { items: [] },
    });

    expect(result.reply).toBe("推荐这款：\n\n1. 法芙娜梦龙牛巧巧克力脆脆\n这款也有海盐奥利奥口味可选。");
    expect(result.productIds).toEqual(["p1"]);
  });

  it("adds product cards mentioned in the reply only when no explicit ids are selected", async () => {
    const service = new SelectProductsService();

    const result = await service.execute({
      productIds: [],
      reply: "推荐这几款：\\n\\n1. 法芙娜梦龙牛巧巧克力脆脆\\n2. 真莓季",
      answerType: "recommendation",
      products: {
        items: [
          { id: "p1", title: "法芙娜梦龙牛巧巧克力脆脆", priceText: "¥158-¥398" },
          { id: "p2", title: "真莓季", priceText: "¥138" },
        ],
      },
      currentProducts: { items: [] },
    });

    expect(result.productIds).toEqual(["p1", "p2"]);
  });

  it("accepts more than five selected product ids instead of failing schema validation", async () => {
    const parsed = SelectProductsInputSchema.parse({
      productIds: ["p1", "p2", "p3", "p4", "p5", "p6", "p7"],
      reply: "推荐这几款平价蛋糕。",
      answerType: "recommendation",
    });

    expect(parsed.productIds).toHaveLength(7);
  });

  it("does not add product cards for assortment overview replies", async () => {
    const service = new SelectProductsService();

    const result = await service.execute({
      productIds: [],
      reply: "店里除了蛋糕，也有法芙娜梦龙牛巧巧克力脆脆、真莓季这些甜品方向。",
      answerType: "product_overview",
      products: {
        items: [
          { id: "p1", title: "法芙娜梦龙牛巧巧克力脆脆", priceText: "¥158-¥398" },
          { id: "p2", title: "真莓季", priceText: "¥138" },
        ],
      },
      currentProducts: { items: [] },
    });

    expect(result).toEqual({
      status: "empty",
      products: [],
      reply: "店里除了蛋糕，也有法芙娜梦龙牛巧巧克力脆脆、真莓季这些甜品方向。",
      productIds: [],
      answerType: "product_overview",
      reason: "未选择任何商品",
    });
  });

  it("overrides a wrong model choice when the user asks for the largest size", async () => {
    const service = new SelectProductsService();
    const tenInchProduct = {
      id: "271a7ad7-8722-45e8-b37c-19370070b438",
      title: "草莓抹茶蛋糕",
      priceText: "¥138-¥338",
      priceOptions: [
        { label: "4寸", price: 138 },
        { label: "8寸", price: 268 },
        { label: "10寸", price: 338 },
      ],
    };
    const eightInchProduct = {
      id: "7df2309a-918c-4b23-bc79-e03fb6801368",
      title: "8寸修形小动物公交车",
      priceText: "¥458",
      priceOptions: [{ label: "8寸", price: 458 }],
    };

    const result = await service.execute({
      productIds: [eightInchProduct.id],
      reply: "店里目前最大的蛋糕是8寸。",
      answerType: "product_detail",
      question: "你家最大的蛋糕是几寸的",
      products: { items: [tenInchProduct, eightInchProduct] },
      currentProducts: { items: [] },
    });

    expect(result.productIds).toEqual([tenInchProduct.id]);
    expect(result.products).toEqual([tenInchProduct]);
    expect(result.reply).toContain("10寸");
    expect(result.reply).toContain("草莓抹茶蛋糕");
  });
});

function retrievedProduct(input: {
  id: string;
  title: string;
  optionsText: string;
  minPrice: number;
  maxPrice: number;
}) {
  const candidate = {
    id: input.id,
    title: input.title,
    category: "蛋糕",
    description: null,
    displayPrice: input.minPrice,
    minPrice: input.minPrice,
    maxPrice: input.maxPrice,
    tags: [],
    options: [],
    optionsText: input.optionsText,
    score: 1,
  };
  return {
    row: {
      id: input.id,
      title: input.title,
      category: "蛋糕",
      description: null,
      display_price: String(input.minPrice),
      min_price: String(input.minPrice),
      max_price: String(input.maxPrice),
      tags: [],
      options: [],
      options_text: input.optionsText,
    },
    candidate,
  };
}
