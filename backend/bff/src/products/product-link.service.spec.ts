import { describe, expect, it } from "vitest";
import { ProductLinkService } from "./product-link.service";

describe("ProductLinkService", () => {
  const service = new ProductLinkService({
    get: () => "/pages/goods/detail/index?alias={alias}",
  } as never);

  it("builds a Youzan path from the stored alias", () => {
    expect(service.build("youzan", "abc 123")).toEqual({
      miniProgramPath: "/pages/goods/detail/index?alias=abc%20123",
      miniProgramParams: { alias: "abc 123" },
    });
  });

  it("does not invent a link for unsupported sources", () => {
    expect(service.build("unknown", "abc")).toEqual({
      miniProgramPath: null,
      miniProgramParams: {},
    });
  });
});
