import { describe, expect, it, vi } from "vitest";
import { ProductsService } from "../../../src/products/products.service";

describe("ProductsService", () => {
  it("syncs products by merchant and source_product_id, then deactivates missing merchant products", async () => {
    const queries: Array<[string, unknown[] | undefined]> = [];
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        queries.push([sql, values]);
        if (sql.includes("SELECT * FROM products")) {
          return {
            rows: values?.[1] === "3911803637"
              ? [productRow({ sourceProductId: "3911803637", saleStatus: "off_sale" })]
              : [],
          };
        }
        if (sql.includes("UPDATE products") && sql.includes("source_product_id <> ALL")) {
          return { rows: [], rowCount: 2 };
        }
        if (sql.includes("INSERT INTO products")) {
          return { rows: [productRow({ sourceProductId: "4078941629", saleStatus: "on_sale" })] };
        }
        return { rows: [], rowCount: 1 };
      }),
    };
    const database = {
      transaction: vi.fn((callback) => callback(client)),
    };
    const service = new ProductsService(
      database as never,
      { findEnabledById: vi.fn().mockResolvedValue({ id: "merchant-id" }) } as never,
      { build: vi.fn().mockReturnValue({ miniProgramPath: null, miniProgramParams: {} }) } as never,
    );

    const result = await service.importProducts({
      merchantId: "merchant-id",
      deactivateMissing: true,
      products: [
        productInput({ sourceProductId: "3911803637", title: "抹茶芭乐提" }),
        productInput({ sourceProductId: "4078941629", title: "杨梅季 杨梅冷萃酸奶蛋糕" }),
      ],
    });

    expect(result).toEqual({ created: 1, updated: 1, unchanged: 0, deactivated: 2 });
    const selectSql = queries.find(([sql]) => sql.includes("SELECT * FROM products"))?.[0];
    expect(selectSql).toContain("WHERE merchant_id = $1 AND source_product_id = $2");
    const updateSql = queries.find(([sql]) => sql.includes("UPDATE products SET") && sql.includes("WHERE id"))?.[0];
    expect(updateSql).toContain("sale_status");
    const deactivate = queries.find(([sql]) => sql.includes("source_product_id <> ALL"));
    expect(deactivate?.[0]).toContain("WHERE merchant_id = $1");
    expect(deactivate?.[1]).toEqual(["merchant-id", ["3911803637", "4078941629"]]);
  });
});

function productInput(input: { sourceProductId: string; title: string }) {
  return {
    source: "youzan",
    sourceShopId: "113996920",
    sourceProductId: input.sourceProductId,
    alias: "alias",
    category: "热销口味",
    title: input.title,
    description: "",
    displayPrice: 138,
    minPrice: 138,
    maxPrice: 258,
    images: [],
    sales: 0,
    isRecommended: false,
    options: [],
    tags: [],
    optionsText: "尺寸（必须）：4寸138元、6寸258元",
  };
}

function productRow(input: { sourceProductId: string; saleStatus: string }) {
  return {
    id: `id-${input.sourceProductId}`,
    merchant_id: "merchant-id",
    source: "youzan",
    source_shop_id: "113996920",
    source_product_id: input.sourceProductId,
    alias: "old-alias",
    category: "旧分类",
    title: "旧标题",
    description: "",
    display_price: "138",
    min_price: "138",
    max_price: "258",
    images: [],
    sales: "0",
    is_recommended: false,
    options: [],
    tags: [],
    options_text: "旧规格",
    sale_status: input.saleStatus,
    created_at: new Date(),
    updated_at: new Date(),
  };
}
