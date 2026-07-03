import { describe, expect, it, vi } from "vitest";
import { LoadProductsService } from "../../../../../src/ai/graph/tools/load-products.service";
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
      products: { items: [] },
      currentProducts: { items: [] },
    });

    expect(result).toEqual({
      status: "empty",
      products: [],
      reply: "暂时没找到完全匹配的商品，可以换个口味或预算试试。",
      productIds: [],
      reason: "未选择任何商品",
    });
  });

  it("normalizes html and markdown in final product replies", async () => {
    const service = new SelectProductsService();

    const result = await service.execute({
      productIds: ["271a7ad7-8722-45e8-b37c-19370070b438"],
      reply: "可以看看** 抹茶栗子 **：<br><br>1. 4寸 ¥128<br>2. 5寸 ¥198",
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

  it("keeps explicit product ids even when the reply names fewer products", async () => {
    const service = new SelectProductsService();

    const result = await service.execute({
      productIds: ["p1", "p2", "p3"],
      reply: "推荐这两款：\n1. 草莓蛋糕\n2. 巧克力蛋糕",
      products: {
        items: [
          { id: "p1", title: "草莓蛋糕", priceText: "¥128" },
          { id: "p2", title: "巧克力蛋糕", priceText: "¥158" },
          { id: "p3", title: "芒果蛋糕", priceText: "¥138" },
        ],
      },
      currentProducts: { items: [] },
    });

    expect(result.productIds).toEqual(["p1", "p2", "p3"]);
  });

  it("shows cards for ordinary product attribute questions", async () => {
    const service = new SelectProductsService();

    const result = await service.execute({
      productIds: ["p1"],
      reply: "这款有 4寸、5寸、6寸可选。",
      question: "这款有几寸",
      products: {
        items: [{ id: "p1", title: "草莓蛋糕", priceText: "¥128-¥278" }],
      },
      currentProducts: { items: [{ id: "p1", title: "草莓蛋糕", priceText: "¥128-¥278" }] },
    });

    expect(result.productIds).toEqual(["p1"]);
    expect(result.products).toEqual([
      expect.objectContaining({ id: "p1" }),
    ]);
  });

  it("shows cards for flavor questions after a product is focused", async () => {
    const service = new SelectProductsService();

    const result = await service.execute({
      productIds: ["p1"],
      reply: "抹茶栗子是抹茶搭配栗子的口味，茶香和栗子香融合在一起。",
      question: "这个是什么味道的",
      products: {
        items: [{ id: "p1", title: "抹茶栗子", priceText: "¥128-¥378" }],
      },
      currentProducts: {
        focusedId: "p1",
        items: [{ id: "p1", title: "抹茶栗子", priceText: "¥128-¥378" }],
      },
    });

    expect(result.productIds).toEqual(["p1"]);
    expect(result.products).toEqual([
      expect.objectContaining({ id: "p1" }),
    ]);
  });

  it("shows cards when asking what flavors the focused product has", async () => {
    const service = new SelectProductsService();

    const result = await service.execute({
      productIds: ["p1"],
      reply: "这款芝米凤梨米布丁是固定口味，主要是芝米香搭配凤梨的清甜。",
      question: "这个有什么口味",
      products: {
        items: [{ id: "p1", title: "芝米凤梨米布丁", priceText: "¥158-¥268" }],
      },
      currentProducts: {
        focusedId: "p1",
        items: [{ id: "p1", title: "芝米凤梨米布丁", priceText: "¥158-¥268" }],
      },
    });

    expect(result.productIds).toEqual(["p1"]);
    expect(result.products).toEqual([
      expect.objectContaining({ id: "p1" }),
    ]);
  });

  it("shows cards for taste evaluation questions after a product is focused", async () => {
    const service = new SelectProductsService();

    const result = await service.execute({
      productIds: ["p1"],
      reply: "这款抹茶栗子口感清爽，甜度不高，喜欢抹茶和栗子的话挺合适。",
      question: "这个味的好吃吗",
      products: {
        items: [{ id: "p1", title: "抹茶栗子", priceText: "¥128-¥378" }],
      },
      currentProducts: {
        focusedId: "p1",
        items: [{ id: "p1", title: "抹茶栗子", priceText: "¥128-¥378" }],
      },
    });

    expect(result.productIds).toEqual(["p1"]);
    expect(result.products).toEqual([
      expect.objectContaining({ id: "p1" }),
    ]);
  });

  it("shows cards for appearance evaluation questions after a product is focused", async () => {
    const service = new SelectProductsService();

    const result = await service.execute({
      productIds: ["p1"],
      reply: "这款抹茶栗子造型简洁清爽，拍照也比较上镜，送人或过生日都挺好看。",
      question: "好看吗",
      products: {
        items: [{ id: "p1", title: "抹茶栗子", priceText: "¥128-¥378" }],
      },
      currentProducts: {
        focusedId: "p1",
        items: [{ id: "p1", title: "抹茶栗子", priceText: "¥128-¥378" }],
      },
    });

    expect(result.productIds).toEqual(["p1"]);
    expect(result.products).toEqual([
      expect.objectContaining({ id: "p1" }),
    ]);
  });

  it("shows a card when the user selects a specific product", async () => {
    const service = new SelectProductsService();

    const result = await service.execute({
      productIds: ["p1"],
      reply: "你选的是第3款草莓蛋糕。",
      question: "第三款",
      products: {
        items: [{ id: "p1", title: "草莓蛋糕", priceText: "¥128-¥278" }],
      },
      currentProducts: { items: [] },
    });

    expect(result.productIds).toEqual(["p1"]);
  });

  it("infers product cards when the reply recommends specific products", async () => {
    const service = new SelectProductsService();

    const result = await service.execute({
      productIds: [],
      reply: "有的，给你挑几款水果口味：\n1. 杨梅季 杨梅冷萃酸奶蛋糕\n2. 百香芒芒冷萃",
      question: "有水果的吗",
      products: {
        items: [
          { id: "p1", title: "杨梅季 杨梅冷萃酸奶蛋糕", priceText: "¥138-¥258" },
          { id: "p2", title: "百香芒芒冷萃", priceText: "¥138" },
        ],
      },
      currentProducts: { items: [] },
    });

    expect(result.productIds).toEqual(["p1", "p2"]);
  });

  it("keeps product cards for flavor preference plus delivery questions", async () => {
    const service = new SelectProductsService();

    const result = await service.execute({
      productIds: [],
      reply: "我暂时没能确认到可展示的商品，可以换个口味、预算或商品类型再试试。",
      question: "要巧克力的吧，你能给我送过来吗",
      products: {
        items: [
          {
            id: "chocolate-product",
            title: "法芙娜梦龙生巧/巧克力脑袋",
            category: "男士蛋糕",
            priceText: "¥158-¥398",
            tags: ["巧克力"],
            details: "巧克力爱好者狂喜",
            minPrice: 158,
          },
          {
            id: "matcha-product",
            title: "抹茶栗子",
            category: "送长辈",
            priceText: "¥128-¥378",
            tags: ["抹茶"],
          },
        ],
      },
      currentProducts: { items: [] },
    });

    expect(result.status).toBe("success");
    expect(result.productIds).toEqual(["chocolate-product"]);
    expect(result.reply).toContain("配送/送达我这边暂时无法确认");
    expect(result.reply).toContain("法芙娜梦龙生巧/巧克力脑袋");
  });

  it("caps selected product ids to five in the internal finalizer", async () => {
    const service = new SelectProductsService();
    const productIds = ["p1", "p2", "p3", "p4", "p5", "p6", "p7"];

    const result = await service.execute({
      productIds: ["p1", "p2", "p3", "p4", "p5", "p6", "p7"],
      reply: "推荐这几款平价蛋糕。",
      products: {
        items: productIds.map((id, index) => ({
          id,
          title: `蛋糕${index + 1}`,
          priceText: `¥10${index + 1}`,
        })),
      },
      currentProducts: { items: [] },
    });

    expect(result.productIds).toEqual(["p1", "p2", "p3", "p4", "p5"]);
  });

  it("orders inferred product cards by the reply mention order and caps them to five", async () => {
    const service = new SelectProductsService();

    const result = await service.execute({
      productIds: [],
      reply: "推荐这几款：\n1. 蛋糕三\n2. 蛋糕一\n3. 蛋糕六\n4. 蛋糕二\n5. 蛋糕四\n6. 蛋糕五",
      products: {
        items: [
          { id: "p1", title: "蛋糕一", priceText: "¥101" },
          { id: "p2", title: "蛋糕二", priceText: "¥102" },
          { id: "p3", title: "蛋糕三", priceText: "¥103" },
          { id: "p4", title: "蛋糕四", priceText: "¥104" },
          { id: "p5", title: "蛋糕五", priceText: "¥105" },
          { id: "p6", title: "蛋糕六", priceText: "¥106" },
        ],
      },
      currentProducts: { items: [] },
    });

    expect(result.productIds).toEqual(["p3", "p1", "p6", "p2", "p4"]);
  });

  it("does not add product cards for assortment overview replies", async () => {
    const service = new SelectProductsService();

    const result = await service.execute({
      productIds: [],
      reply: "店里除了蛋糕，也有法芙娜梦龙牛巧巧克力脆脆、真莓季这些甜品方向。",
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
      reason: "未选择任何商品",
    });
  });

  it("removes cards from assortment follow-ups even with explicit ids", async () => {
    const service = new SelectProductsService();

    const result = await service.execute({
      productIds: ["p1"],
      reply: "店里还有其他品类：\n- 美式巧克力坚果大曲奇\n- 4寸专区",
      question: "还有其他吗",
      products: {
        items: [
          { id: "p1", title: "美式巧克力坚果大曲奇", priceText: "¥128" },
        ],
      },
      currentProducts: { items: [] },
    });

    expect(result).toEqual({
      status: "empty",
      products: [],
      reply: "店里还有其他品类：\n- 美式巧克力坚果大曲奇\n- 4寸专区",
      productIds: [],
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
