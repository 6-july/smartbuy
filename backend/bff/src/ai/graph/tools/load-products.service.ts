import { Injectable } from "@nestjs/common";
import { RetrievalService } from "../../retrieval.service";
import {
  LoadProductsExecutionInput,
  LoadProductsExecutor,
  LoadProductsResult,
} from "./load-products.contract";
import { toProductSnapshot } from "./product-snapshot";

@Injectable()
export class LoadProductsService implements LoadProductsExecutor {
  constructor(private readonly retrieval: RetrievalService) {}

  async execute(input: LoadProductsExecutionInput): Promise<LoadProductsResult> {
    try {
      const products = await this.retrieval.findAllForMerchant(input.merchantId);
      const snapshots = products.map(toProductSnapshot);
      if (snapshots.length === 0) {
        return {
          status: "empty",
          products: [],
          reason: EMPTY_PRODUCTS_REASON,
        };
      }
      return {
        status: "success",
        products: snapshots,
        reason: input.reason,
      };
    } catch (error) {
      return {
        status: "error",
        products: [],
        reason: error instanceof Error ? error.message : "商品池加载失败",
      };
    }
  }
}

const EMPTY_PRODUCTS_REASON = "当前商家暂无可咨询商品";
