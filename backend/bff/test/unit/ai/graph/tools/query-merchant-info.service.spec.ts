import { describe, expect, it } from "vitest";
import { QueryMerchantInfoService } from "../../../../../src/ai/graph/tools/query-merchant-info.service";

describe("QueryMerchantInfoService", () => {
  it("returns the configured merchant phone", async () => {
    const service = new QueryMerchantInfoService();

    const result = await service.execute({
      merchant: { id: "merchant-id", name: "测试店铺", phone: "18600000000" },
      query: "商家电话是多少？",
    });

    expect(result).toEqual({
      status: "success",
      infos: [{ field: "phone", label: "联系电话", value: "18600000000" }],
      reason: undefined,
    });
  });

  it("returns unsupported for address before address data is connected", async () => {
    const service = new QueryMerchantInfoService();

    const result = await service.execute({
      merchant: { id: "merchant-id", name: "测试店铺", phone: "18600000000" },
      query: "商家地址在哪里？",
    });

    expect(result).toEqual({
      status: "unsupported",
      infos: [],
      reason: "当前暂未提供商家地址信息",
    });
  });

  it("does not invent a phone when merchant phone is missing", async () => {
    const service = new QueryMerchantInfoService();

    const result = await service.execute({
      merchant: { id: "merchant-id", name: "测试店铺", phone: null },
      query: "商家联系方式是什么？",
    });

    expect(result).toEqual({
      status: "empty",
      infos: [],
      reason: "当前暂未提供商家联系电话",
    });
  });
});
