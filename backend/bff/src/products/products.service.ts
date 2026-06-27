import { HttpStatus, Injectable } from "@nestjs/common";
import { PoolClient } from "pg";
import { AppException } from "../common/app-exception";
import { DatabaseService } from "../database/database.service";
import { MerchantsService } from "../merchants/merchants.service";
import { ImportProductsDto, ProductImportItemDto } from "./dto/import-products.dto";
import { ProductQueryDto } from "./dto/product-query.dto";
import { EmbeddingService } from "./embedding.service";
import { ProductLinkService } from "./product-link.service";

export interface ProductRow {
  id: string;
  merchant_id: string;
  source: string;
  source_shop_id: string | null;
  source_product_id: string;
  alias: string | null;
  category: string;
  title: string;
  description: string | null;
  display_price: string;
  min_price: string;
  max_price: string;
  images: unknown[];
  sales: string;
  is_recommended: boolean;
  options: unknown[];
  tags: unknown[];
  ai_text: string;
  sale_status: string;
  created_at: Date;
  updated_at: Date;
}

interface EmbedTarget {
  id: string;
  aiText: string;
}

const FIELD_MAP: Array<[keyof ProductImportItemDto, keyof ProductRow, string]> = [
  ["sourceShopId", "source_shop_id", "source_shop_id"],
  ["alias", "alias", "alias"],
  ["category", "category", "category"],
  ["title", "title", "title"],
  ["description", "description", "description"],
  ["displayPrice", "display_price", "display_price"],
  ["minPrice", "min_price", "min_price"],
  ["maxPrice", "max_price", "max_price"],
  ["images", "images", "images"],
  ["sales", "sales", "sales"],
  ["isRecommended", "is_recommended", "is_recommended"],
  ["options", "options", "options"],
  ["tags", "tags", "tags"],
  ["aiText", "ai_text", "ai_text"],
];

@Injectable()
export class ProductsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly merchants: MerchantsService,
    private readonly embedding: EmbeddingService,
    private readonly links: ProductLinkService,
  ) {}

  async importProducts(dto: ImportProductsDto) {
    await this.merchants.findEnabledById(dto.merchantId);
    if (dto.products.some((item) => item.minPrice > item.maxPrice)) {
      throw new AppException(
        "PRODUCT_IMPORT_INVALID",
        "商品最低价不能大于最高价",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const keys = new Set<string>();
    for (const item of dto.products) {
      const key = `${item.source}\u0000${item.sourceProductId}`;
      if (keys.has(key)) {
        throw new AppException(
          "PRODUCT_IMPORT_INVALID",
          `商品重复: ${item.source}/${item.sourceProductId}`,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      keys.add(key);
    }

    const result = await this.database.transaction(async (client) => {
      let created = 0;
      let updated = 0;
      let unchanged = 0;
      const embedTargets: EmbedTarget[] = [];

      for (const item of dto.products) {
        const currentResult = await client.query<ProductRow>(
          `SELECT * FROM products
           WHERE merchant_id = $1 AND source = $2 AND source_product_id = $3
           FOR UPDATE`,
          [dto.merchantId, item.source, item.sourceProductId],
        );
        const current = currentResult.rows[0];
        if (!current) {
          const inserted = await this.insertProduct(client, dto.merchantId, item);
          created += 1;
          embedTargets.push({ id: inserted.id, aiText: inserted.ai_text });
          continue;
        }

        const changes = this.getChanges(current, item);
        if (changes.length === 0) {
          unchanged += 1;
          continue;
        }
        const aiTextChanged = changes.some(([column]) => column === "ai_text");
        await this.updateProduct(client, current.id, changes, aiTextChanged);
        updated += 1;
        if (aiTextChanged) embedTargets.push({ id: current.id, aiText: item.aiText });
      }

      if (dto.deactivateMissing && dto.products.length > 0) {
        await client.query(
          `UPDATE products
           SET sale_status = 'off_sale'
           WHERE merchant_id = $1
             AND (source, source_product_id) NOT IN (
               SELECT * FROM unnest($2::text[], $3::text[])
             )`,
          [
            dto.merchantId,
            dto.products.map((item) => item.source),
            dto.products.map((item) => item.sourceProductId),
          ],
        );
      }
      return { created, updated, unchanged, embedTargets };
    });

    let embeddingReady = 0;
    let embeddingFailed = 0;
    let embeddingSkipped = 0;
    for (const target of result.embedTargets) {
      if (!this.embedding.isConfigured()) {
        embeddingSkipped += 1;
        continue;
      }
      try {
        const vector = await this.embedding.embed(target.aiText);
        if (!vector) {
          embeddingSkipped += 1;
          continue;
        }
        await this.database.query(
          `UPDATE products SET embedding = $1::vector
           WHERE id = $2 AND ai_text = $3`,
          [`[${vector.join(",")}]`, target.id, target.aiText],
        );
        embeddingReady += 1;
      } catch {
        embeddingFailed += 1;
      }
    }

    return {
      created: result.created,
      updated: result.updated,
      unchanged: result.unchanged,
      embeddingReady,
      embeddingFailed,
      embeddingSkipped,
    };
  }

  async list(query: ProductQueryDto) {
    const conditions = ["merchant_id = $1"];
    const values: unknown[] = [query.merchantId];
    if (query.saleStatus) {
      values.push(query.saleStatus);
      conditions.push(`sale_status = $${values.length}`);
    }
    if (query.keyword) {
      values.push(query.keyword);
      conditions.push(`(title % $${values.length} OR title ILIKE '%' || $${values.length} || '%')`);
    }
    values.push(query.pageSize, (query.page - 1) * query.pageSize);
    const result = await this.database.query<ProductRow & { total_count: string }>(
      `SELECT *, count(*) OVER() AS total_count
       FROM products
       WHERE ${conditions.join(" AND ")}
       ORDER BY updated_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return {
      list: result.rows.map((row) => this.toProduct(row)),
      total: Number(result.rows[0]?.total_count || 0),
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async getById(id: string): Promise<ProductRow> {
    const result = await this.database.query<ProductRow>(
      `SELECT * FROM products WHERE id = $1`,
      [id],
    );
    if (!result.rows[0]) {
      throw new AppException("PRODUCT_NOT_FOUND", "商品不存在", HttpStatus.NOT_FOUND);
    }
    return result.rows[0];
  }

  async updateStatus(id: string, saleStatus: string) {
    const result = await this.database.query<ProductRow>(
      `UPDATE products SET sale_status = $2 WHERE id = $1 RETURNING *`,
      [id, saleStatus],
    );
    if (!result.rows[0]) {
      throw new AppException("PRODUCT_NOT_FOUND", "商品不存在", HttpStatus.NOT_FOUND);
    }
    return this.toProduct(result.rows[0]);
  }

  toProduct(row: ProductRow) {
    const jump = this.links.build(row.source, row.alias);
    return {
      id: row.id,
      merchantId: row.merchant_id,
      source: row.source,
      sourceShopId: row.source_shop_id,
      sourceProductId: row.source_product_id,
      alias: row.alias,
      category: row.category,
      title: row.title,
      description: row.description,
      displayPrice: Number(row.display_price),
      minPrice: Number(row.min_price),
      maxPrice: Number(row.max_price),
      images: row.images,
      sales: Number(row.sales),
      isRecommended: row.is_recommended,
      options: row.options,
      tags: row.tags,
      aiText: row.ai_text,
      saleStatus: row.sale_status,
      ...jump,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private async insertProduct(
    client: PoolClient,
    merchantId: string,
    item: ProductImportItemDto,
  ): Promise<ProductRow> {
    const result = await client.query<ProductRow>(
      `INSERT INTO products (
         merchant_id, source, source_shop_id, source_product_id, alias,
         category, title, description, display_price, min_price, max_price,
         images, sales, is_recommended, options, tags, ai_text
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
         $12::jsonb, $13, $14, $15::jsonb, $16::jsonb, $17
       ) RETURNING *`,
      [
        merchantId,
        item.source,
        item.sourceShopId || null,
        item.sourceProductId,
        item.alias || null,
        item.category,
        item.title,
        item.description || null,
        item.displayPrice,
        item.minPrice,
        item.maxPrice,
        JSON.stringify(item.images),
        item.sales,
        item.isRecommended,
        JSON.stringify(item.options),
        JSON.stringify(item.tags),
        item.aiText,
      ],
    );
    return result.rows[0];
  }

  private getChanges(
    current: ProductRow,
    item: ProductImportItemDto,
  ): Array<[string, unknown, boolean]> {
    const changes: Array<[string, unknown, boolean]> = [];
    for (const [inputKey, rowKey, column] of FIELD_MAP) {
      const input = item[inputKey] ?? null;
      const stored = current[rowKey] ?? null;
      const isJson = ["images", "options", "tags"].includes(column);
      const isNumber = ["display_price", "min_price", "max_price", "sales"].includes(column);
      const same = isJson
        ? JSON.stringify(input) === JSON.stringify(stored)
        : isNumber
          ? Number(input) === Number(stored)
          : input === stored;
      if (!same) changes.push([column, isJson ? JSON.stringify(input) : input, isJson]);
    }
    return changes;
  }

  private async updateProduct(
    client: PoolClient,
    id: string,
    changes: Array<[string, unknown, boolean]>,
    clearEmbedding: boolean,
  ): Promise<void> {
    const values: unknown[] = [];
    const sets = changes.map(([column, value, isJson]) => {
      values.push(value);
      return `${column} = $${values.length}${isJson ? "::jsonb" : ""}`;
    });
    if (clearEmbedding) sets.push("embedding = NULL");
    values.push(id);
    await client.query(
      `UPDATE products SET ${sets.join(", ")} WHERE id = $${values.length}`,
      values,
    );
  }
}
