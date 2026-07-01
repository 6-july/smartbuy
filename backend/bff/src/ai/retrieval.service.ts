import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { EmbeddingService } from "../products/embedding.service";
import { ProductRow } from "../products/products.service";
import { ProductCandidate, SearchIntent } from "./domain";

export interface RetrievedProduct {
  row: ProductRow;
  candidate: ProductCandidate;
}

@Injectable()
export class RetrievalService {
  constructor(
    private readonly database: DatabaseService,
    private readonly embedding: EmbeddingService,
  ) {}

  async countProducts(merchantId: string): Promise<number> {
    const result = await this.database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM products
       WHERE merchant_id = $1 AND sale_status = 'on_sale'
         AND title NOT ILIKE '%非下单%' AND title NOT ILIKE '%单拍不送%'`,
      [merchantId],
    );
    return Number(result.rows[0]?.count || 0);
  }

  async listCategories(merchantId: string): Promise<string[]> {
    const result = await this.database.query<{ category: string }>(
      `SELECT DISTINCT category FROM products
       WHERE merchant_id = $1 AND sale_status = 'on_sale'
         AND category IS NOT NULL AND category != ''
       ORDER BY category`,
      [merchantId],
    );
    return result.rows.map((r) => r.category);
  }

  async search(
    merchantId: string,
    intent: SearchIntent,
    preferredProductIds: string[] = [],
  ): Promise<RetrievedProduct[]> {
    const values: unknown[] = [merchantId];
    const conditions = [
      "merchant_id = $1",
      "sale_status = 'on_sale'",
      "title NOT ILIKE '%非下单%'",
      "title NOT ILIKE '%单拍不送%'",
    ];
    if (intent.priceMax !== null) {
      values.push(intent.priceMax);
      conditions.push(`min_price <= $${values.length}`);
    }
    if (intent.priceMin !== null) {
      values.push(intent.priceMin);
      conditions.push(`max_price >= $${values.length}`);
    }

    const keyword = intent.keywords.join(" ") || intent.queryText;
    values.push(keyword);
    const keywordParameter = values.length;
    let contextBoostExpression = "0";
    if (preferredProductIds.length > 0) {
      values.push(preferredProductIds);
      contextBoostExpression = `CASE WHEN id = ANY($${values.length}::uuid[]) THEN 1 ELSE 0 END`;
    }
    let vectorExpression = "0";
    try {
      const vector = await this.embedding.embed(intent.queryText);
      if (vector) {
        values.push(`[${vector.join(",")}]`);
        vectorExpression =
          `(CASE WHEN embedding IS NULL THEN 0 ` +
          `ELSE GREATEST(0, 1 - (embedding <=> $${values.length}::vector)) END)`;
      }
    } catch {
      // Keyword retrieval remains available when query embedding fails.
    }

    const priceSort = getPriceSort(intent.queryText);
    const orderBy = priceSort
      ? `${priceSort}, retrieval_score DESC, sales DESC, updated_at DESC`
      : "retrieval_score DESC, sales DESC, updated_at DESC";
    const result = await this.database.query<ProductRow & { retrieval_score: string }>(
      `SELECT *,
         (
           similarity(title, $${keywordParameter}) * 0.45
           + CASE WHEN title ILIKE '%' || $${keywordParameter} || '%' THEN 0.30 ELSE 0 END
           + ${vectorExpression} * 0.20
           + ${contextBoostExpression}
           + CASE WHEN is_recommended THEN 0.03 ELSE 0 END
           + LEAST(sales, 1000)::numeric / 1000 * 0.02
         ) AS retrieval_score
       FROM products
       WHERE ${conditions.join(" AND ")}
       ORDER BY ${orderBy}
       LIMIT 20`,
      values,
    );

    const minimumScore = intent.needRecommendation || priceSort ? 0 : 0.08;
    return result.rows
      .filter((row) => Number(row.retrieval_score) >= minimumScore)
      .map((row) => toRetrievedProduct(row, Number(row.retrieval_score)));
  }

  async findByIds(merchantId: string, productIds: string[]): Promise<RetrievedProduct[]> {
    if (productIds.length === 0) return [];
    const result = await this.database.query<ProductRow>(
      `SELECT * FROM products
       WHERE merchant_id = $1
         AND id = ANY($2::uuid[])
         AND sale_status = 'on_sale'
         AND title NOT ILIKE '%非下单%'
         AND title NOT ILIKE '%单拍不送%'`,
      [merchantId, productIds],
    );
    const byId = new Map(result.rows.map((row) => [row.id, row]));
    return productIds.flatMap((id) => {
      const row = byId.get(id);
      return row ? [toRetrievedProduct(row, 1)] : [];
    });
  }
}

function toRetrievedProduct(row: ProductRow, score: number): RetrievedProduct {
  return {
    row,
    candidate: {
      id: row.id,
      title: row.title,
      category: row.category,
      description: row.description,
      displayPrice: Number(row.display_price),
      minPrice: Number(row.min_price),
      maxPrice: Number(row.max_price),
      tags: row.tags,
      options: row.options,
      aiText: row.ai_text,
      score,
    },
  };
}

function getPriceSort(queryText: string): string | null {
  if (/最便宜|价格最低|最低价/.test(queryText)) return "min_price ASC";
  if (/最贵|价格最高|最高价/.test(queryText)) return "max_price DESC";
  return null;
}
