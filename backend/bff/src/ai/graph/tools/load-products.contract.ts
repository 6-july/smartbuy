import { z } from "zod";
import { ProductSnapshot } from "../guide-state";

export const LOAD_PRODUCTS_TOOL_NAME = "load_products";

export const LoadProductsInputSchema = z.object({
  reason: z
    .string()
    .trim()
    .optional()
    .describe("本次加载商品池的原因，例如：用户想看最便宜的蛋糕"),
});

export type LoadProductsInput = z.infer<typeof LoadProductsInputSchema>;

export type LoadProductsStatus = "success" | "empty" | "error";

export interface LoadProductsResult {
  status: LoadProductsStatus;
  products: ProductSnapshot[];
  reason?: string;
}

export interface LoadProductsExecutionInput {
  merchantId: string;
  reason?: string;
}

export interface LoadProductsExecutor {
  execute(input: LoadProductsExecutionInput): Promise<LoadProductsResult>;
}

export const loadProductsToolDefinition = {
  type: "function" as const,
  function: {
    name: LOAD_PRODUCTS_TOOL_NAME,
    description:
      "加载当前商家的全部可售商品到商品池。只负责读取真实商品数据，不负责筛选、推荐、下单、支付或库存扣减。",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "本次加载商品池的原因，简短描述用户正在咨询什么。",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
};
