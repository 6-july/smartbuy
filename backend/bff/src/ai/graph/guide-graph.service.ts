import { Injectable } from "@nestjs/common";
import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { Command, END, getCurrentTaskInput, START, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatModelService } from "../chat-model.service";
import {
  ChatMessage,
  isProductDetailFollowUp,
  RecentProductReference,
  resolveReferencedProductIds,
} from "../domain";
import { createLangfuseCallbacks } from "../../observability/langfuse";
import { buildGuideSystemPrompt } from "./guide-prompt";
import { parseGuideFinalOutput } from "./guide-output";
import {
  GuideStateAnnotation,
  GuideStateValue,
  MerchantContext,
  ProductContext,
} from "./guide-state";
import {
  QUERY_MERCHANT_INFO_TOOL_NAME,
  QueryMerchantInfoResult,
  queryMerchantInfoToolDefinition,
  QueryMerchantInfoInputSchema,
} from "./tools/query-merchant-info.contract";
import { QueryMerchantInfoService } from "./tools/query-merchant-info.service";
import {
  QUERY_PRODUCTS_TOOL_NAME,
  QueryProductsResult,
  queryProductsToolDefinition,
  QueryProductsInputSchema,
} from "./tools/query-products.contract";
import { QueryProductsService } from "./tools/query-products.service";

export interface GuideGraphResult {
  reply: string;
  productIds: string[];
}

export interface GuideTraceContext {
  userId?: string;
  sessionId?: string;
  clientMessageId?: string;
}

@Injectable()
export class GuideGraphService {
  constructor(
    private readonly chat: ChatModelService,
    private readonly queryProducts: QueryProductsService,
    private readonly queryMerchantInfo: QueryMerchantInfoService,
  ) {}

  canRun(): boolean {
    return this.chat.isConfigured();
  }

  async guide(input: {
    merchant: MerchantContext;
    question: string;
    history: ChatMessage[];
    recentProducts?: RecentProductReference[];
    trace?: GuideTraceContext;
  }): Promise<GuideGraphResult> {
    const graph = this.buildGraph();
    const initialState = {
      merchantContext: input.merchant,
      messages: [
        ...toBaseMessages(input.history).slice(-8),
        new HumanMessage(input.question),
      ],
      products: toProductContext(input.recentProducts || []),
    };
    const state = await graph.invoke(initialState, {
      callbacks: createLangfuseCallbacks({
        userId: input.trace?.userId,
        sessionId: input.trace?.sessionId,
        tags: ["smartbuy", "guide", "langgraph"],
        traceMetadata: {
          merchantId: input.merchant.id,
          merchantName: input.merchant.name,
          clientMessageId: input.trace?.clientMessageId,
          historyCount: input.history.length,
          recentProductIds: initialState.products.shown.map((product) => product.id),
        },
      }),
      metadata: {
        merchantId: input.merchant.id,
        merchantName: input.merchant.name,
      },
      recursionLimit: 8,
      runName: "smartbuy-guide-graph",
      tags: ["smartbuy", "guide", "langgraph"],
    });
    const output = parseGuideFinalOutput(state.messages.at(-1));
    const allowed = new Set(state.products.shown.map((product) => product.id));
    const productIds = resolveResponseProductIds(output, state, allowed, input.question);
    const reply = resolveResponseReply(output.reply, state);
    return {
      reply,
      productIds,
    };
  }

  private buildGraph() {
    const toolNode = new ToolNode(this.createTools(), { name: "tools" });

    const agentNode = async (state: GuideStateValue) => {
      const forcedToolChoice = productToolChoiceForState(state);
      const response = await this.chat.invokeAgentTurn(
        [
          new SystemMessage(buildGuideSystemPrompt(state)),
          ...state.messages,
        ],
        [queryProductsToolDefinition, queryMerchantInfoToolDefinition],
        forcedToolChoice ? { toolChoice: forcedToolChoice } : undefined,
      );
      return { messages: [response] };
    };

    const shouldContinue = (state: GuideStateValue) => {
      const last = state.messages.at(-1);
      if (!AIMessage.isInstance(last)) return END;
      return last.tool_calls?.some((call) => isGuideToolName(call.name)) ? "tools" : END;
    };

    return new StateGraph(GuideStateAnnotation)
      .addNode("agent", agentNode)
      .addNode("tools", toolNode)
      .addEdge(START, "agent")
      .addConditionalEdges("agent", shouldContinue, { tools: "tools", [END]: END })
      .addEdge("tools", "agent")
      .compile();
  }

  private createTools() {
    const queryProductsTool = tool(
      async (args, config) => {
        const state = getCurrentTaskInput<GuideStateValue>();
        const result = await this.runQueryProductsTool(args, state);
        return new Command({
          update: {
            messages: [
              toToolMessage(getToolCallId(config), QUERY_PRODUCTS_TOOL_NAME, result),
            ],
            products: applyProductContext(state.products, result),
          },
        });
      },
      {
        name: QUERY_PRODUCTS_TOOL_NAME,
        description: queryProductsToolDefinition.function.description,
        schema: QueryProductsInputSchema,
      },
    );

    const queryMerchantInfoTool = tool(
      async (args, config) => {
        const state = getCurrentTaskInput<GuideStateValue>();
        const result = await this.runQueryMerchantInfoTool(args, state);
        return new Command({
          update: {
            messages: [
              toToolMessage(getToolCallId(config), QUERY_MERCHANT_INFO_TOOL_NAME, result),
            ],
          },
        });
      },
      {
        name: QUERY_MERCHANT_INFO_TOOL_NAME,
        description: queryMerchantInfoToolDefinition.function.description,
        schema: QueryMerchantInfoInputSchema,
      },
    );

    return [queryProductsTool, queryMerchantInfoTool];
  }

  private async runQueryProductsTool(
    args: { query: string },
    state: GuideStateValue,
  ): Promise<QueryProductsResult> {
    try {
      return await this.queryProducts.execute({
        merchantId: state.merchantContext.id,
        query: args.query,
        products: state.products,
      });
    } catch (error) {
      return {
        status: "error",
        products: [],
        reason: error instanceof Error ? error.message : "query_products 执行失败",
      };
    }
  }

  private async runQueryMerchantInfoTool(
    args: { query: string },
    state: GuideStateValue,
  ): Promise<QueryMerchantInfoResult> {
    try {
      return await this.queryMerchantInfo.execute({
        merchant: state.merchantContext,
        query: args.query,
      });
    } catch (error) {
      return {
        status: "error",
        infos: [],
        reason: error instanceof Error ? error.message : "query_merchant_info 执行失败",
      };
    }
  }
}

function toBaseMessages(history: ChatMessage[]): BaseMessage[] {
  const messages: BaseMessage[] = [];
  for (const message of history) {
    if (!message.content.trim()) continue;
    if (message.role === "assistant") {
      messages.push(new AIMessage(message.content));
    } else if (message.role === "system") {
      messages.push(new SystemMessage(message.content));
    } else {
      messages.push(new HumanMessage(message.content));
    }
  }
  return messages;
}

function toProductContext(recentProducts: RecentProductReference[]): ProductContext {
  return {
    shown: recentProducts.map((product) => ({
      id: product.id,
      title: product.name,
    })),
    focusedId: recentProducts.length === 1 ? recentProducts[0].id : undefined,
  };
}

function applyProductContext(
  current: ProductContext,
  result: QueryProductsResult,
): ProductContext {
  if (result.status !== "success" || result.products.length === 0) {
    return current;
  }
  const shown = result.products.map((product) => ({
    id: product.id,
    title: product.title,
    priceText: product.priceText,
    tags: product.tags
      .filter((tag): tag is string => typeof tag === "string")
      .slice(0, 5),
    summary: product.description || product.details,
  }));
  return {
    shown,
    focusedId: shown.length === 1 ? shown[0].id : current.focusedId,
  };
}

function isGuideToolName(name: string | undefined): boolean {
  return name === QUERY_PRODUCTS_TOOL_NAME || name === QUERY_MERCHANT_INFO_TOOL_NAME;
}

function resolveResponseReply(reply: string, state: GuideStateValue): string {
  const merchantInfoResult = currentTurnMerchantInfoResult(state.messages);
  if (
    merchantInfoResult &&
    (merchantInfoResult.status === "unsupported" || merchantInfoResult.status === "empty") &&
    merchantInfoResult.reason
  ) {
    return `${merchantInfoResult.reason}。`;
  }
  return reply;
}

function productToolChoiceForState(state: GuideStateValue):
  | { type: "function"; function: { name: typeof QUERY_PRODUCTS_TOOL_NAME } }
  | undefined {
  const lastHumanIndex = findLastHumanMessageIndex(state.messages);
  if (lastHumanIndex < 0) return undefined;
  if (!isProductSearchQuestion(messageText(state.messages[lastHumanIndex]))) {
    return undefined;
  }
  const alreadyQueriedProducts = state.messages
    .slice(lastHumanIndex + 1)
    .some((message) =>
      ToolMessage.isInstance(message) && message.name === QUERY_PRODUCTS_TOOL_NAME
    );
  if (alreadyQueriedProducts) return undefined;
  return {
    type: "function",
    function: { name: QUERY_PRODUCTS_TOOL_NAME },
  };
}

function findLastHumanMessageIndex(messages: BaseMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (HumanMessage.isInstance(messages[index])) return index;
  }
  return -1;
}

function isProductSearchQuestion(question: string): boolean {
  const normalized = question.trim();
  if (!normalized) return false;
  if (/(电话|联系方式|地址|位置|营业|几点开门|几点关门|商家|店铺|天气|新闻|百科|计算)/.test(normalized)) {
    return false;
  }
  return /(推荐|帮我.*(?:选|找|看)|看看|想要|想买|来一?[个款份]|哪个好|有什么|有没有|蛋糕|甜品|商品|口味|味道|尺寸|预算|价格|多少钱|巧克力|草莓|芒果|榴莲|抹茶|奶油|水果|奥利奥|可可|黑巧|生巧)/.test(normalized);
}

function resolveResponseProductIds(
  output: { reply: string; answerType: string; productIds: string[] },
  state: GuideStateValue,
  allowed: Set<string>,
  question: string,
): string[] {
  const toolIds = currentTurnProductToolIds(state.messages, allowed);
  if (shouldAttachProductCards(output.answerType)) {
    const ids = output.productIds.filter((id) => allowed.has(id));
    if (toolIds.length > 0) {
      const idsFromCurrentTool = ids.filter((id) => toolIds.includes(id));
      if (idsFromCurrentTool.length > 0) {
        return alignProductIdsWithReply(output.reply, idsFromCurrentTool, state.products, allowed);
      }
      return alignProductIdsWithReply(output.reply, toolIds, state.products, allowed);
    }
    if (ids.length > 0) {
      return alignProductIdsWithReply(output.reply, ids, state.products, allowed);
    }
    if (state.products.focusedId && allowed.has(state.products.focusedId)) {
      return alignProductIdsWithReply(output.reply, [state.products.focusedId], state.products, allowed);
    }
  }

  if (toolIds.length > 0) {
    return alignProductIdsWithReply(output.reply, toolIds, state.products, allowed);
  }

  if (output.answerType === "merchant_info" || output.answerType === "no_match") {
    return [];
  }
  return alignProductIdsWithReply(
    output.reply,
    referencedProductIds(question, state.products, allowed),
    state.products,
    allowed,
  );
}

function shouldAttachProductCards(answerType: string): boolean {
  return (
    answerType === "recommendation" ||
    answerType === "product_detail" ||
    answerType === "unsupported_fact"
  );
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

function alignProductIdsWithReply(
  reply: string,
  candidateIds: string[],
  products: ProductContext,
  allowed: Set<string>,
): string[] {
  const uniqueCandidateIds = uniqueIds(candidateIds).filter((id) => allowed.has(id));
  if (uniqueCandidateIds.length <= 1) return uniqueCandidateIds;

  const mentionedIds = productIdsMentionedInReply(reply, products, allowed);
  const alignedIds = mentionedIds.filter((id) => uniqueCandidateIds.includes(id));
  return alignedIds.length > 0 ? alignedIds.slice(0, 5) : uniqueCandidateIds.slice(0, 5);
}

function productIdsMentionedInReply(
  reply: string,
  products: ProductContext,
  allowed: Set<string>,
): string[] {
  const normalizedReply = normalizeProductText(reply);
  const titleIds: string[] = [];
  products.shown.forEach((product) => {
    if (!allowed.has(product.id)) return;
    const aliases = productTitleAliases(product.title);
    const mentionedByTitle = aliases.some((alias) =>
      alias.length >= 2 && normalizedReply.includes(alias)
    );
    if (mentionedByTitle && !titleIds.includes(product.id)) {
      titleIds.push(product.id);
    }
  });
  if (titleIds.length > 0) return titleIds;

  const ordinalIds: string[] = [];
  products.shown.forEach((product, index) => {
    if (!allowed.has(product.id) || !replyMentionsOrdinal(reply, index + 1)) return;
    if (!ordinalIds.includes(product.id)) ordinalIds.push(product.id);
  });
  return ordinalIds;
}

function productTitleAliases(title: string): string[] {
  const normalized = normalizeProductText(title);
  const withoutBadges = normalizeProductText(
    title
      .replace(/【[^】]*】/g, "")
      .replace(/\[[^\]]*]/g, "")
      .replace(/（[^）]*）/g, "")
      .replace(/\([^)]*\)/g, ""),
  );
  return uniqueIds([normalized, withoutBadges]).filter(Boolean);
}

function normalizeProductText(value: string): string {
  return value.replace(/\s+/g, "").replace(/[，。！？、,.!?*#\-—~～"'“”‘’：:]/g, "");
}

function replyMentionsOrdinal(reply: string, ordinal: number): boolean {
  const chinese = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"][ordinal];
  return new RegExp(`第\\s*(?:${ordinal}${chinese ? `|${chinese}` : ""})\\s*[个款]`).test(reply);
}

function referencedProductIds(
  question: string,
  products: ProductContext,
  allowed: Set<string>,
): string[] {
  const references = products.shown
    .filter((product) => allowed.has(product.id))
    .map((product) => ({
      id: product.id,
      name: product.title,
    }));
  if (!isProductDetailFollowUp(question, references.length > 0)) return [];

  const normalized = question.replace(/\s+/g, "");
  const namedIds = references
    .filter((product) => product.name && normalized.includes(product.name.replace(/\s+/g, "")))
    .map((product) => product.id);
  if (namedIds.length > 0) return uniqueIds(namedIds);

  const referencedIds = resolveReferencedProductIds(question, references)
    .filter((id) => allowed.has(id));
  if (referencedIds.length === 1) return referencedIds;

  if (products.shown.length === 1 && products.focusedId && allowed.has(products.focusedId)) {
    return [products.focusedId];
  }
  return [];
}

function currentTurnProductToolIds(
  messages: BaseMessage[],
  allowed: Set<string>,
): string[] {
  const ids: string[] = [];
  for (const message of messages) {
    if (!ToolMessage.isInstance(message) || message.name !== QUERY_PRODUCTS_TOOL_NAME) {
      continue;
    }
    const result = parseToolResult<QueryProductsResult>(message);
    if (result?.status !== "success") continue;
    for (const product of result.products) {
      if (allowed.has(product.id) && !ids.includes(product.id)) ids.push(product.id);
    }
  }
  return ids;
}

function currentTurnMerchantInfoResult(
  messages: BaseMessage[],
): QueryMerchantInfoResult | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!ToolMessage.isInstance(message) || message.name !== QUERY_MERCHANT_INFO_TOOL_NAME) {
      continue;
    }
    return parseToolResult<QueryMerchantInfoResult>(message);
  }
  return undefined;
}

function parseToolResult<T>(message: ToolMessage): T | undefined {
  try {
    return JSON.parse(toolMessageText(message)) as T;
  } catch {
    return undefined;
  }
}

function toToolMessage(
  toolCallId: string,
  name: typeof QUERY_PRODUCTS_TOOL_NAME | typeof QUERY_MERCHANT_INFO_TOOL_NAME,
  result: QueryProductsResult | QueryMerchantInfoResult,
): ToolMessage {
  return new ToolMessage({
    name,
    tool_call_id: toolCallId,
    status: result.status === "error" ? "error" : "success",
    content: JSON.stringify(result),
  });
}

function getToolCallId(config: unknown): string {
  const runtime = config as { toolCallId?: string; toolCall?: { id?: string } };
  return runtime.toolCallId || runtime.toolCall?.id || "";
}

function toolMessageText(message: ToolMessage): string {
  return contentText(message.content);
}

function messageText(message: BaseMessage): string {
  return contentText(message.content);
}

function contentText(content: BaseMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .map((block) => {
      if (typeof block === "string") return block;
      if ("text" in block && typeof block.text === "string") return block.text;
      return "";
    })
    .join("");
}
