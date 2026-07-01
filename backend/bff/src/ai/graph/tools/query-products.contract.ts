import { z } from "zod";
import { ProductContext } from "../guide-state";

export const QUERY_PRODUCTS_TOOL_NAME = "query_products";

export const QueryProductsInputSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1)
    .describe("完整商品查询需求，例如：推荐三款200元以内、不太甜的生日蛋糕"),
});

export type QueryProductsInput = z.infer<typeof QueryProductsInputSchema>;

export type QueryProductsStatus =
  | "success"
  | "empty"
  | "need_clarification"
  | "constraint_conflict"
  | "unsupported_fact"
  | "error";

export interface QueryProductItem {
  id: string;
  title: string;
  category: string;
  priceText: string;
  minPrice: number;
  maxPrice: number;
  description?: string | null;
  tags: unknown[];
  details?: string;
  priceOptions: Array<{
    label: string;
    price: number;
  }>;
}

export interface QueryProductsResult {
  status: QueryProductsStatus;
  products: QueryProductItem[];
  reason?: string;
  clarification?: {
    question: string;
    options?: Array<{
      label: string;
      query: string;
    }>;
  };
}

export interface QueryProductsExecutionInput {
  merchantId: string;
  query: string;
  products: ProductContext;
}

export interface QueryProductsExecutor {
  execute(input: QueryProductsExecutionInput): Promise<QueryProductsResult>;
}

export const queryProductsToolDefinition = {
  type: "function" as const,
  function: {
    name: QUERY_PRODUCTS_TOOL_NAME,
    description:
      "查询当前商家的商品。商品推荐、商品详情、品类咨询和多轮条件追加都使用这个工具。只读工具，不执行下单、支付或库存扣减。",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "完整商品查询需求。需要结合上下文补全，例如用户说“我要草莓的”且上一轮是10寸蛋糕，应传“查询同时满足10寸和草莓味的蛋糕”。",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
};

