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
    const apiUrl = this.config.get("embeddingApiUrl", { infer: true });
    const isMultimodal = apiUrl.includes("/multimodal");
    const input = isMultimodal ? [{ type: "text", text }] : text;
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.get("embeddingApiKey", { infer: true })}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.config.get("embeddingModel", { infer: true }),
        input,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Embedding API returned ${response.status}`);
    const body = (await response.json()) as {
      data?: Array<{ embedding?: number[] }> | { embedding?: number[] };
    };
    const embedding = Array.isArray(body.data)
      ? body.data[0]?.embedding
      : body.data?.embedding;
    if (!embedding?.length || embedding.some((value) => !Number.isFinite(value))) {
      throw new Error("Embedding API returned an invalid vector");
    }
    return embedding;
  }
}
