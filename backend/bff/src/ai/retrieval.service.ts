import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { ProductRow } from "../products/products.service";
import { ProductCandidate } from "./domain";

export interface RetrievedProduct {
  row: ProductRow;
  candidate: ProductCandidate;
}

@Injectable()
export class RetrievalService {
  constructor(private readonly database: DatabaseService) {}

  async findAllForMerchant(merchantId: string): Promise<RetrievedProduct[]> {
    const result = await this.database.query<ProductRow>(
      `SELECT * FROM products
       WHERE merchant_id = $1
         AND sale_status = 'on_sale'
         AND title NOT ILIKE '%非下单%'
         AND title NOT ILIKE '%单拍不送%'
       ORDER BY is_recommended DESC, sales DESC, updated_at DESC`,
      [merchantId],
    );
    return result.rows.map((row) => toRetrievedProduct(row, 1));
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
      optionsText: row.options_text,
      score,
    },
  };
}
