import { CurrentProductContext, ProductContext, ProductSnapshot } from "../guide-state";

export type SelectProductsStatus = "success" | "empty" | "invalid" | "error";

export interface SelectProductsResult {
  status: SelectProductsStatus;
  products: ProductSnapshot[];
  reply: string;
  productIds: string[];
  reason?: string;
  invalidProductIds?: string[];
}

export interface SelectProductsExecutionInput {
  productIds: string[];
  reply: string;
  question?: string;
  products: ProductContext;
  currentProducts: CurrentProductContext;
  reason?: string;
}

export interface SelectProductsExecutor {
  execute(input: SelectProductsExecutionInput): Promise<SelectProductsResult>;
}
