import { Injectable } from "@nestjs/common";
import { ProductCandidate, SearchIntent } from "@smartbuy/ai";
import { DatabaseService } from "../database/database.service";
import { EmbeddingService } from "../products/embedding.service";
import { ProductRow } from "../products/products.service";

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

  async search(merchantId: string, intent: SearchIntent): Promise<RetrievedProduct[]> {
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

    const result = await this.database.query<ProductRow & { retrieval_score: string }>(
      `SELECT *,
         (
           similarity(title, $${keywordParameter}) * 0.45
           + CASE WHEN title ILIKE '%' || $${keywordParameter} || '%' THEN 0.30 ELSE 0 END
           + ${vectorExpression} * 0.20
           + CASE WHEN is_recommended THEN 0.03 ELSE 0 END
           + LEAST(sales, 1000)::numeric / 1000 * 0.02
         ) AS retrieval_score
       FROM products
       WHERE ${conditions.join(" AND ")}
       ORDER BY retrieval_score DESC, sales DESC, updated_at DESC
       LIMIT 20`,
      values,
    );

    const minimumScore = intent.needRecommendation ? 0 : 0.08;
    return result.rows.filter((row) => Number(row.retrieval_score) >= minimumScore).map((row) => ({
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
        score: Number(row.retrieval_score),
      },
    }));
  }
}
