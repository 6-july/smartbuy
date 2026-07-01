import { Injectable } from "@nestjs/common";
import {
  QueryMerchantInfoExecutionInput,
  QueryMerchantInfoExecutor,
  QueryMerchantInfoResult,
} from "./query-merchant-info.contract";

@Injectable()
export class QueryMerchantInfoService implements QueryMerchantInfoExecutor {
  async execute(input: QueryMerchantInfoExecutionInput): Promise<QueryMerchantInfoResult> {
    return this.executeInternal(input);
  }

  private executeInternal(input: QueryMerchantInfoExecutionInput): QueryMerchantInfoResult {
    const query = input.query.trim();
    if (!query) {
      return {
        status: "empty",
        infos: [],
        reason: "商家信息查询需求为空",
      };
    }

    const requested = detectRequestedFields(query);
    const infos: QueryMerchantInfoResult["infos"] = [];
    const unsupported: string[] = [];

    if (requested.phone || requested.generic) {
      const phone = input.merchant.phone?.trim();
      if (phone) {
        infos.push({ field: "phone", label: "联系电话", value: phone });
      } else {
        return {
          status: "empty",
          infos: [],
          reason: "当前暂未提供商家联系电话",
        };
      }
    }

    if (requested.address) unsupported.push("地址");
    if (requested.businessHours) unsupported.push("营业时间");

    if (infos.length > 0) {
      return {
        status: "success",
        infos,
        reason: unsupported.length > 0
          ? `当前仅提供商家电话，暂未提供商家${unsupported.join("、")}信息`
          : undefined,
      };
    }

    if (unsupported.length > 0) {
      return {
        status: "unsupported",
        infos: [],
        reason: `当前暂未提供商家${unsupported.join("、")}信息`,
      };
    }

    return {
      status: "empty",
      infos: [],
      reason: "当前暂未提供该商家信息字段",
    };
  }
}

function detectRequestedFields(query: string): {
  phone: boolean;
  address: boolean;
  businessHours: boolean;
  generic: boolean;
} {
  const phone = /电话|联系|客服|手机号|号码|致电|打给/.test(query);
  const address = /地址|位置|在哪|哪里|门店|到店|导航/.test(query);
  const businessHours = /营业|开门|关门|几点|时间|休息|打烊/.test(query);
  const generic = /商家信息|店铺信息|门店信息|联系方式/.test(query) &&
    !phone &&
    !address &&
    !businessHours;
  return { phone, address, businessHours, generic };
}
