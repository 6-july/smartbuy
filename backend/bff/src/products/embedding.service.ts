import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AppEnv } from "../config/env";

@Injectable()
export class EmbeddingService {
  constructor(private readonly config: ConfigService<AppEnv, true>) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.get("embeddingApiUrl", { infer: true }) &&
        this.config.get("embeddingApiKey", { infer: true }) &&
        this.config.get("embeddingModel", { infer: true }),
    );
  }

  async embed(text: string): Promise<number[] | null> {
    if (!this.isConfigured()) return null;
    const response = await fetch(this.config.get("embeddingApiUrl", { infer: true }), {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.get("embeddingApiKey", { infer: true })}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.config.get("embeddingModel", { infer: true }),
        input: text,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Embedding API returned ${response.status}`);
    const body = (await response.json()) as { data?: Array<{ embedding?: number[] }> };
    const embedding = body.data?.[0]?.embedding;
    if (!embedding?.length || embedding.some((value) => !Number.isFinite(value))) {
      throw new Error("Embedding API returned an invalid vector");
    }
    return embedding;
  }
}
