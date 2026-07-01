import { ConfigService } from "@nestjs/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppEnv } from "../config/env";
import { IntentParserService } from "./intent-parser.service";

function configuredService() {
  const values: Partial<Record<keyof AppEnv, string>> = {
    aiChatApiUrl: "https://example.com/chat",
    aiChatApiKey: "test-key",
    aiChatModel: "test-model",
  };
  const config = {
    get: (key: keyof AppEnv) => values[key],
  } as ConfigService<AppEnv, true>;
  return new IntentParserService(config);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("IntentParserService", () => {
  it("does not call the model for a clear standalone request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const intent = await configuredService().parse("200元以内的抹茶蛋糕");

    expect(intent.priceMax).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rewrites a contextual follow-up with recent history", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              queryText: "伯爵红茶奶油蛋糕有什么尺寸",
              keywords: ["伯爵红茶奶油蛋糕", "尺寸"],
              priceMin: null,
              priceMax: null,
              needRecommendation: false,
            }),
          },
        }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const intent = await configuredService().parse(
      "第二个有什么尺寸？",
      [{ role: "assistant", content: "第二个是伯爵红茶奶油蛋糕" }],
      true,
      [
        { id: "first", name: "草莓蛋糕" },
        { id: "second", name: "伯爵红茶奶油蛋糕" },
      ],
    );

    expect(intent.queryText).toBe("伯爵红茶奶油蛋糕有什么尺寸");
    expect(intent.keywords).toContain("伯爵红茶奶油蛋糕");
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(String(request.body)).toContain("第二个是伯爵红茶奶油蛋糕");
    expect(String(request.body)).toContain("2. 伯爵红茶奶油蛋糕");
  });
});
