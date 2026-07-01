import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AppEnv } from "../config/env";
import { parseSearchIntent, SearchIntent } from "./domain";

const INTENT_SYSTEM_PROMPT = `你是一个购物意图解析器。从用户的消息中提取搜索意图，返回严格 JSON，不要输出任何其他内容。

格式：
{
  "keywords": ["关键词1", "关键词2"],
  "priceMin": null 或数字,
  "priceMax": null 或数字,
  "needRecommendation": true/false
}

规则：
- keywords：提取与商品相关的名词（口味、类型、用途、场景等），去掉语气词和停用词
- priceMin/priceMax：提取价格区间，"200以内"→priceMax:200，"100以上"→priceMin:100，"200左右"→priceMin:150,priceMax:250
- needRecommendation：用户请求推荐、不确定要什么时为 true
- 如果消息是闲聊/打招呼/感谢等非购物意图，keywords 返回空数组`;

@Injectable()
export class IntentParserService {
  constructor(private readonly config: ConfigService<AppEnv, true>) {}

  async parse(question: string): Promise<SearchIntent> {
    const regexResult = parseSearchIntent(question);

    const apiUrl = this.config.get("aiChatApiUrl", { infer: true });
    const apiKey = this.config.get("aiChatApiKey", { infer: true });
    const model = this.config.get("aiChatModel", { infer: true });
    if (!apiUrl || !apiKey || !model) return regexResult;

    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 200,
          messages: [
            { role: "system", content: INTENT_SYSTEM_PROMPT },
            { role: "user", content: question },
          ],
        }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return regexResult;

      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = body.choices?.[0]?.message?.content?.trim();
      if (!content) return regexResult;

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return regexResult;

      const parsed = JSON.parse(jsonMatch[0]) as {
        keywords?: string[];
        priceMin?: number | null;
        priceMax?: number | null;
        needRecommendation?: boolean;
      };

      return {
        queryText: question.trim(),
        keywords: Array.isArray(parsed.keywords)
          ? parsed.keywords.filter((k) => typeof k === "string" && k.trim().length > 0)
          : regexResult.keywords,
        priceMin: typeof parsed.priceMin === "number" ? parsed.priceMin : regexResult.priceMin,
        priceMax: typeof parsed.priceMax === "number" ? parsed.priceMax : regexResult.priceMax,
        needRecommendation: typeof parsed.needRecommendation === "boolean"
          ? parsed.needRecommendation
          : regexResult.needRecommendation,
      };
    } catch (err) {
      console.warn("[IntentParser] LLM parse failed, falling back to regex:", err);
      return regexResult;
    }
  }
}
