import { z } from "zod";
import { GuideAnswerType } from "../guide-output";
import { CurrentProductContext, ProductContext, ProductSnapshot } from "../guide-state";

export const SELECT_PRODUCTS_TOOL_NAME = "select_products";

export const SelectProductsInputSchema = z.object({
  productIds: z
    .array(z.string().trim().min(1))
    .max(5)
    .describe("从商品池中选中的商品ID列表，最多5个。推荐/详情/实时信息回复必须传商品ID；no_match/clarification 可传空数组。数量和顺序必须与 reply 中实际推荐的商品完全一致"),
  reply: z
    .string()
    .trim()
    .min(1)
    .describe("准备直接回复给用户的最终纯文本文案；不要包含商品ID、工具名、HTML标签、<br>、Markdown加粗符号"),
  answerType: z
    .enum(["recommendation", "product_detail", "unsupported_fact", "product_overview", "no_match", "clarification"])
    .describe("本次商品回复类型"),
  reason: z
    .string()
    .trim()
    .optional()
    .describe("选择这些商品的原因，例如：用户询问最便宜的蛋糕"),
});

export type SelectProductsStatus = "success" | "empty" | "invalid" | "error";

export interface SelectProductsResult {
  status: SelectProductsStatus;
  products: ProductSnapshot[];
  reply: string;
  productIds: string[];
  answerType: Extract<
    GuideAnswerType,
    "recommendation" | "product_detail" | "unsupported_fact" | "product_overview" | "no_match" | "clarification"
  >;
  reason?: string;
  invalidProductIds?: string[];
}

export interface SelectProductsExecutionInput {
  productIds: string[];
  reply: string;
  answerType: Extract<
    GuideAnswerType,
    "recommendation" | "product_detail" | "unsupported_fact" | "product_overview" | "no_match" | "clarification"
  >;
  question?: string;
  products: ProductContext;
  currentProducts: CurrentProductContext;
  reason?: string;
}

export interface SelectProductsExecutor {
  execute(input: SelectProductsExecutionInput): Promise<SelectProductsResult>;
}

export const selectProductsToolDefinition = {
  type: "function" as const,
  function: {
    name: SELECT_PRODUCTS_TOOL_NAME,
    description:
      "最终提交商品回复：从已加载的商品池中选择本轮要回复和展示的商品，同时提交最终回复文案。执行后本轮会直接结束，不会再回到模型总结。",
    parameters: {
      type: "object",
      properties: {
        productIds: {
          type: "array",
          items: { type: "string" },
          maxItems: 5,
          description:
            "要展示的商品ID列表，最多5个。正文介绍几款商品，这里就传几款商品；数量和顺序必须与正文完全一致。只传1个ID时正文只能介绍这1款。没有匹配或需要追问时传空数组。",
        },
        reply: {
          type: "string",
          description:
            "最终回复给用户的中文纯文本文案。最多推荐5款商品；必须只描述 productIds 对应商品，且顺序一致，不要提未选择商品，不要暴露商品ID；不要使用 HTML、<br>、Markdown 加粗、标题、表格或字面量 \\n。多规格/多商品请用真实换行和 1. 2. 3. 编号。",
        },
        answerType: {
          type: "string",
          enum: ["recommendation", "product_detail", "unsupported_fact", "product_overview", "no_match", "clarification"],
          description: "本次商品回复类型。",
        },
        reason: {
          type: "string",
          description: "选择这些商品的原因，简短说明即可。",
        },
      },
      required: ["productIds", "reply", "answerType"],
      additionalProperties: false,
    },
  },
};
