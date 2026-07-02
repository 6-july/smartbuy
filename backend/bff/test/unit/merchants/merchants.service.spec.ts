import { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";
import { AppEnv } from "../../../src/config/env";
import { MerchantsService } from "../../../src/merchants/merchants.service";

describe("MerchantsService conversation reuse", () => {
  it("reuses the latest active conversation within the configured window", async () => {
    const { service, queries, config } = createService([
      { rows: [merchantRow()] },
      { rows: [{ id: "existing-conversation-id" }] },
      { rows: [] },
    ]);

    const result = await service.guideInfo("merchant-id", "user-id");

    expect(result.conversationId).toBe("existing-conversation-id");
    expect(config.get).toHaveBeenCalledWith("conversationReuseWindowMinutes", { infer: true });
    const reusableQuery = queries.find(([sql]) => sql.includes("FROM conversations"));
    expect(reusableQuery?.[0]).toContain("updated_at >= now() - ($3::int * interval '1 minute')");
    expect(reusableQuery?.[1]).toEqual(["user-id", "merchant-id", 30]);
    expect(queries.some(([sql]) => sql.includes("UPDATE conversations SET updated_at = now()"))).toBe(
      true,
    );
    expect(queries.some(([sql]) => sql.includes("INSERT INTO conversations"))).toBe(false);
  });

  it("creates a conversation when no active one is reusable", async () => {
    const { service, queries } = createService([
      { rows: [merchantRow()] },
      { rows: [] },
      { rows: [{ id: "new-conversation-id" }] },
    ]);

    const result = await service.guideInfo("merchant-id", "user-id");

    expect(result.conversationId).toBe("new-conversation-id");
    const insertQuery = queries.find(([sql]) => sql.includes("INSERT INTO conversations"));
    expect(insertQuery?.[1]).toEqual(["user-id", "merchant-id"]);
    expect(queries.some(([sql]) => sql.includes("UPDATE conversations SET updated_at = now()"))).toBe(
      false,
    );
  });
});

function createService(responses: Array<{ rows: unknown[] }>) {
  const queries: Array<[string, unknown[] | undefined]> = [];
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    queries.push([sql, values]);
    return responses.shift() || { rows: [] };
  });
  const config = {
    get: vi.fn().mockReturnValue(30),
  } as unknown as ConfigService<AppEnv, true> & { get: ReturnType<typeof vi.fn> };
  const service = new MerchantsService({ query } as never, config);
  return { service, queries, config };
}

function merchantRow() {
  return {
    id: "merchant-id",
    name: "吾安蛋糕店",
    logo: null,
    description: null,
    banner_image: null,
    mini_program_app_id: "wx-test",
    scene_code: "scene",
    recommend_questions: [],
    phone: null,
    address: "河南省郑州市管城回族区吾安烘焙(兴达国贸店)",
    industry: "蛋糕",
    status: "enabled",
  };
}
