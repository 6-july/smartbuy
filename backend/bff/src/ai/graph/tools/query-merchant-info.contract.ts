import { z } from "zod";
import { MerchantContext } from "../guide-state";

export const QUERY_MERCHANT_INFO_TOOL_NAME = "query_merchant_info";

export const QueryMerchantInfoInputSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1)
    .describe("完整商家信息咨询需求，例如：商家联系电话是多少"),
});

export type QueryMerchantInfoInput = z.infer<typeof QueryMerchantInfoInputSchema>;

export type MerchantInfoStatus = "success" | "empty" | "unsupported" | "error";

export interface MerchantInfoItem {
  field: "phone";
  label: string;
  value: string;
}

export interface QueryMerchantInfoResult {
  status: MerchantInfoStatus;
  infos: MerchantInfoItem[];
  reason?: string;
}

export interface QueryMerchantInfoExecutionInput {
  merchant: MerchantContext;
  query: string;
}

export interface QueryMerchantInfoExecutor {
  execute(input: QueryMerchantInfoExecutionInput): Promise<QueryMerchantInfoResult>;
}

export const queryMerchantInfoToolDefinition = {
  type: "function" as const,
  function: {
    name: QUERY_MERCHANT_INFO_TOOL_NAME,
    description:
      "查询当前商家的基础信息。商家电话、地址、营业时间等咨询使用这个工具；目前只接入商家电话，地址和营业时间未接入时会返回 unsupported。",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "完整商家信息咨询需求。例如用户问“商家电话是多少”，应传“查询商家联系电话”。",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
};
