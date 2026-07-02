import { AIMessage, BaseMessage } from "@langchain/core/messages";
import { normalizeGuideReply } from "./guide-reply-format";

export type GuideAnswerType =
  | "recommendation"
  | "product_detail"
  | "clarification"
  | "merchant_info"
  | "product_overview"
  | "no_match"
  | "unsupported_fact"
  | "chitchat";

export interface GuideFinalOutput {
  reply: string;
  productIds: string[];
  answerType: GuideAnswerType;
}

export function parseGuideFinalOutput(message: BaseMessage | undefined): GuideFinalOutput {
  if (!message || !AIMessage.isInstance(message)) {
    throw new Error("Guide graph did not finish with an AI message");
  }

  const content = textContent(message.content).trim();
  const json = extractJsonObject(content);
  if (!json) {
    if (!content) throw new Error("Guide output is empty");
    return {
      reply: normalizeGuideReply(content),
      productIds: [],
      answerType: "chitchat",
    };
  }
  const parsed = JSON.parse(json) as Partial<GuideFinalOutput>;
  if (!parsed.reply?.trim()) throw new Error("Guide output is missing reply");

  return {
    reply: normalizeGuideReply(parsed.reply),
    productIds: Array.isArray(parsed.productIds)
      ? [...new Set(parsed.productIds.filter((id): id is string => typeof id === "string"))]
      : [],
    answerType: isGuideAnswerType(parsed.answerType) ? parsed.answerType : "chitchat",
  };
}

function textContent(content: BaseMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .map((block) => {
      if (typeof block === "string") return block;
      if ("text" in block && typeof block.text === "string") return block.text;
      return "";
    })
    .join("");
}

function extractJsonObject(content: string): string | undefined {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const source = fenced?.[1]?.trim() || content;
  const match = source.match(/\{[\s\S]*\}/);
  return match?.[0];
}

function isGuideAnswerType(value: unknown): value is GuideAnswerType {
  return (
    value === "recommendation" ||
    value === "product_detail" ||
    value === "clarification" ||
    value === "merchant_info" ||
    value === "product_overview" ||
    value === "no_match" ||
    value === "unsupported_fact" ||
    value === "chitchat"
  );
}
