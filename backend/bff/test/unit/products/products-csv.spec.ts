import { describe, expect, it } from "vitest";
import { parseProductImportCsv } from "../../../src/products/products-csv";

describe("parseProductImportCsv", () => {
  it("maps the generated Chinese CSV columns into product import items", () => {
    const options = JSON.stringify([
      {
        name: "尺寸",
        type: "price",
        required: true,
        options: [{ name: "4寸", price: 138 }, { name: "6寸", price: 258 }],
      },
    ]);
    const images = JSON.stringify([{ url: "https://example.com/cake.jpg", size: "728*728" }]);
    const csv = [
      "商家id,商品id,别名alias,商品链接,商品名称,分类,展示价格,最低价,最高价,商品图,规格信息,热门,推荐,标签,销量,上架状态",
      [
        "113996920",
        "3911803637",
        "270p6r1g4dz546z",
        "https://shop.example/goods/270p6r1g4dz546z",
        "抹茶芭乐提",
        "热销口味",
        "138.0",
        "138.0",
        "258.0",
        csvCell(images),
        csvCell(options),
        "True",
        "False",
        "本店销量榜第8;热门",
        "119",
        "0",
      ].join(","),
    ].join("\n");

    const products = parseProductImportCsv(csv);

    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      source: "youzan",
      sourceShopId: "113996920",
      sourceProductId: "3911803637",
      alias: "270p6r1g4dz546z",
      category: "热销口味",
      title: "抹茶芭乐提",
      displayPrice: 138,
      minPrice: 138,
      maxPrice: 258,
      sales: 119,
      isRecommended: false,
      tags: ["本店销量榜第8", "热门"],
      optionsText: "尺寸（必须）：4寸138元、6寸258元",
    });
  });
});

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
