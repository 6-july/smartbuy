import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  RemoveMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import {
  Command,
  END,
  getCurrentTaskInput,
  MemorySaver,
  REMOVE_ALL_MESSAGES,
  START,
  StateGraph,
} from "@langchain/langgraph";
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
import { GuideFinalOutput, parseGuideFinalOutput } from "./guide-output";
import {
  CurrentProductContext,
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
  LOAD_PRODUCTS_TOOL_NAME,
  LoadProductsResult,
  loadProductsToolDefinition,
  LoadProductsInputSchema,
} from "./tools/load-products.contract";
import { LoadProductsService } from "./tools/load-products.service";
import {
  SELECT_PRODUCTS_TOOL_NAME,
  SelectProductsResult,
  selectProductsToolDefinition,
  SelectProductsInputSchema,
} from "./tools/select-products.contract";
import { SelectProductsService } from "./tools/select-products.service";

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
  private readonly checkpointer = new MemorySaver();

  constructor(
    private readonly chat: ChatModelService,
    private readonly loadProducts: LoadProductsService,
    private readonly selectProducts: SelectProductsService,
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
    const threadId = input.trace?.sessionId || `guide-${randomUUID()}`;
    const initialState = {
      sessionId: threadId,
      merchantContext: input.merchant,
      messages: [
        new RemoveMessage({ id: REMOVE_ALL_MESSAGES }),
        ...toBaseMessages(input.history).slice(-8),
        new HumanMessage(input.question),
      ],
      currentProducts: toCurrentProductContext(input.recentProducts || []),
    };
    const state = await graph.invoke(initialState, {
      configurable: {
        thread_id: threadId,
      },
      callbacks: createLangfuseCallbacks({
        userId: input.trace?.userId,
        sessionId: input.trace?.sessionId,
        tags: ["smartbuy", "guide", "langgraph"],
        traceMetadata: {
          merchantId: input.merchant.id,
          merchantName: input.merchant.name,
          clientMessageId: input.trace?.clientMessageId,
          historyCount: input.history.length,
          recentProductIds: initialState.currentProducts.items.map((product) => product.id),
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
    const output = resolveGuideFinalOutput(state);
    const allowed = new Set(state.currentProducts.items.map((product) => product.id));
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
        [
          loadProductsToolDefinition,
          selectProductsToolDefinition,
          queryMerchantInfoToolDefinition,
        ],
        forcedToolChoice ? { toolChoice: forcedToolChoice } : undefined,
      );
      return { messages: [response] };
    };

    const shouldContinue = (state: GuideStateValue) => {
      const last = state.messages.at(-1);
      if (!AIMessage.isInstance(last)) return END;
      return last.tool_calls?.some((call) => isGuideToolName(call.name)) ? "tools" : END;
    };
    const afterTools = (state: GuideStateValue) => {
      return currentToolBatchHasFinalSelect(state.messages) ? END : "agent";
    };

    return new StateGraph(GuideStateAnnotation)
      .addNode("agent", agentNode)
      .addNode("tools", toolNode)
      .addEdge(START, "agent")
      .addConditionalEdges("agent", shouldContinue, { tools: "tools", [END]: END })
      .addConditionalEdges("tools", afterTools, { agent: "agent", [END]: END })
      .compile({ checkpointer: this.checkpointer });
  }

  private createTools() {
    const loadProductsTool = tool(
      async (args, config) => {
        const state = getCurrentTaskInput<GuideStateValue>();
        const result = await this.runLoadProductsTool(args, state);
        return new Command({
          update: {
            messages: [
              toToolMessage(getToolCallId(config), LOAD_PRODUCTS_TOOL_NAME, result),
            ],
            products: applyLoadedProductContext(state.products, result),
          },
        });
      },
      {
        name: LOAD_PRODUCTS_TOOL_NAME,
        description: loadProductsToolDefinition.function.description,
        schema: LoadProductsInputSchema,
      },
    );

    const selectProductsTool = tool(
      async (args, config) => {
        const state = getCurrentTaskInput<GuideStateValue>();
        const result = await this.runSelectProductsTool(args, state);
        return new Command({
          update: {
            messages: [
              toToolMessage(getToolCallId(config), SELECT_PRODUCTS_TOOL_NAME, result),
            ],
            currentProducts: applyCurrentProductContext(state.currentProducts, result),
          },
        });
      },
      {
        name: SELECT_PRODUCTS_TOOL_NAME,
        description: selectProductsToolDefinition.function.description,
        schema: SelectProductsInputSchema,
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

    return [loadProductsTool, selectProductsTool, queryMerchantInfoTool];
  }

  private async runLoadProductsTool(
    args: { reason?: string },
    state: GuideStateValue,
  ): Promise<LoadProductsResult> {
    try {
      return await this.loadProducts.execute({
        merchantId: state.merchantContext.id,
        reason: args.reason,
      });
    } catch (error) {
      return {
        status: "error",
        products: [],
        reason: error instanceof Error ? error.message : "load_products 执行失败",
      };
    }
  }

  private async runSelectProductsTool(
    args: {
      productIds: string[];
      reply: string;
      answerType:
        | "recommendation"
        | "product_detail"
        | "unsupported_fact"
        | "product_overview"
        | "no_match"
        | "clarification";
      reason?: string;
    },
    state: GuideStateValue,
  ): Promise<SelectProductsResult> {
    try {
      return await this.selectProducts.execute({
        productIds: args.productIds,
        reply: args.reply,
        answerType: args.answerType,
        question: lastHumanMessageText(state.messages),
        products: state.products,
        currentProducts: state.currentProducts,
        reason: args.reason,
      });
    } catch (error) {
      return {
        status: "error",
        products: [],
        reply: "我暂时没能完成这次查询，可以换个口味、预算或商品类型再试试。",
        productIds: [],
        answerType: "no_match",
        reason: error instanceof Error ? error.message : "select_products 执行失败",
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

function toCurrentProductContext(recentProducts: RecentProductReference[]): CurrentProductContext {
  return {
    items: recentProducts.map((product) => ({
      id: product.id,
      title: product.name,
    })),
    focusedId: recentProducts.length === 1 ? recentProducts[0].id : undefined,
  };
}

function applyLoadedProductContext(
  current: ProductContext,
  result: LoadProductsResult,
): ProductContext {
  if (result.status !== "success" || result.products.length === 0) {
    return current;
  }
  return {
    items: result.products,
    loadedAt: new Date().toISOString(),
  };
}

function applyCurrentProductContext(
  current: CurrentProductContext,
  result: SelectProductsResult,
): CurrentProductContext {
  if (
    (result.status !== "success" && result.status !== "invalid") ||
    result.products.length === 0
  ) {
    return current;
  }
  return {
    items: result.products,
    focusedId: result.products.length === 1 ? result.products[0].id : current.focusedId,
  };
}

function isGuideToolName(name: string | undefined): boolean {
  return (
    name === LOAD_PRODUCTS_TOOL_NAME ||
    name === SELECT_PRODUCTS_TOOL_NAME ||
    name === QUERY_MERCHANT_INFO_TOOL_NAME
  );
}

function resolveGuideFinalOutput(state: GuideStateValue): GuideFinalOutput {
  const selectResult = currentTurnSelectProductsResult(state.messages);
  if (selectResult) {
    return {
      reply: selectResult.reply,
      productIds: selectResult.productIds,
      answerType: selectResult.answerType,
    };
  }
  return parseGuideFinalOutput(state.messages.at(-1));
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
  | {
      type: "function";
      function: { name: typeof LOAD_PRODUCTS_TOOL_NAME | typeof SELECT_PRODUCTS_TOOL_NAME };
    }
  | undefined {
  const lastHumanIndex = findLastHumanMessageIndex(state.messages);
  if (lastHumanIndex < 0) return undefined;
  const question = messageText(state.messages[lastHumanIndex]);
  if (
    !isProductSearchQuestion(question) &&
    !isProductContinuationConfirmation(question, state.messages, lastHumanIndex)
  ) {
    return undefined;
  }

  const messagesAfterLastHuman = state.messages.slice(lastHumanIndex + 1);
  const alreadySelectedProducts = messagesAfterLastHuman.some((message) =>
    ToolMessage.isInstance(message) && message.name === SELECT_PRODUCTS_TOOL_NAME
  );
  if (alreadySelectedProducts) return undefined;

  if (state.products.items.length > 0) {
    return {
      type: "function",
      function: { name: SELECT_PRODUCTS_TOOL_NAME },
    };
  }

  const alreadyLoadedProducts = state.messages
    .slice(lastHumanIndex + 1)
    .some((message) =>
      ToolMessage.isInstance(message) && message.name === LOAD_PRODUCTS_TOOL_NAME
    );
  if (alreadyLoadedProducts) return undefined;
  return {
    type: "function",
    function: { name: LOAD_PRODUCTS_TOOL_NAME },
  };
}

function findLastHumanMessageIndex(messages: BaseMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (HumanMessage.isInstance(messages[index])) return index;
  }
  return -1;
}

function lastHumanMessageText(messages: BaseMessage[]): string | undefined {
  const index = findLastHumanMessageIndex(messages);
  return index >= 0 ? messageText(messages[index]) : undefined;
}

function isProductSearchQuestion(question: string): boolean {
  const normalized = question.trim();
  if (!normalized) return false;
  if (/(电话|联系方式|地址|位置|营业|几点开门|几点关门|商家|店铺|天气|新闻|百科|计算)/.test(normalized)) {
    return false;
  }
  return /(推荐|帮我.*(?:选|找|看)|看看|想要|想买|来一?[个款份]|哪个好|有什么|有没有|蛋糕|甜品|商品|口味|味道|尺寸|预算|价格|多少钱|贵|便宜|实惠|划算|超预算|巧克力|草莓|芒果|榴莲|抹茶|奶油|水果|奥利奥|可可|黑巧|生巧)/.test(normalized);
}

function isProductContinuationConfirmation(
  question: string,
  messages: BaseMessage[],
  lastHumanIndex: number,
): boolean {
  const normalized = question.replace(/\s+/g, "").replace(/[。！？!?,，~～]/g, "");
  if (!/^(可以|可以啊|可以呀|可以的|好|好啊|好呀|好的|行|行啊|行呀|嗯|嗯嗯|要|要的|来吧|推荐吧|那推荐吧|看看|看下)$/.test(normalized)) {
    return false;
  }

  const previousAssistant = previousAssistantText(messages, lastHumanIndex);
  return /(要不要|需要|需不需要|我帮你|帮你|可以帮你|给你).*(推荐|挑|找|看看|看下)|推荐几款|有好几款|更便宜|便宜的|预算|超预算/.test(previousAssistant);
}

function previousAssistantText(messages: BaseMessage[], beforeIndex: number): string {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (AIMessage.isInstance(message)) return messageText(message);
  }
  return "";
}

function resolveResponseProductIds(
  output: { reply: string; answerType: string; productIds: string[] },
  state: GuideStateValue,
  allowed: Set<string>,
  question: string,
): string[] {
  const toolIds = currentTurnProductToolIds(state.messages, allowed);
  if (
    output.answerType === "product_overview" ||
    isProductOverviewQuestion(question)
  ) {
    return [];
  }

  if (shouldAttachProductCards(output.answerType)) {
    const ids = output.productIds.filter((id) => allowed.has(id));
    if (toolIds.length > 0) {
      const idsFromCurrentTool = ids.filter((id) => toolIds.includes(id));
      if (idsFromCurrentTool.length > 0) {
        return alignProductIdsWithReply(output.reply, idsFromCurrentTool, state.currentProducts, allowed);
      }
      return alignProductIdsWithReply(output.reply, toolIds, state.currentProducts, allowed);
    }
    if (ids.length > 0) {
      return alignProductIdsWithReply(output.reply, ids, state.currentProducts, allowed);
    }
    if (state.currentProducts.focusedId && allowed.has(state.currentProducts.focusedId)) {
      return alignProductIdsWithReply(
        output.reply,
        [state.currentProducts.focusedId],
        state.currentProducts,
        allowed,
      );
    }
  }

  if (toolIds.length > 0) {
    return alignProductIdsWithReply(output.reply, toolIds, state.currentProducts, allowed);
  }

  if (output.answerType === "merchant_info" || output.answerType === "no_match") {
    return [];
  }
  return alignProductIdsWithReply(
    output.reply,
    referencedProductIds(question, state.currentProducts, allowed),
    state.currentProducts,
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

function isProductOverviewQuestion(question: string): boolean {
  const normalized = question.trim();
  return /(?:除了.+还(?:有|卖)什么|还(?:有|卖)什么|都(?:有|卖)什么|卖什么|有哪些(?:品类|种类|类型)|有什么(?:品类|种类|类型))/.test(normalized) &&
    !/(推荐|帮我.*(?:选|找|看)|哪个好|哪款|多少钱|价格|尺寸|适合|口味)/.test(normalized);
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

function alignProductIdsWithReply(
  reply: string,
  candidateIds: string[],
  products: CurrentProductContext,
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
  products: CurrentProductContext,
  allowed: Set<string>,
): string[] {
  const normalizedReply = normalizeProductText(reply);
  const titleIds: string[] = [];
  products.items.forEach((product) => {
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
  products.items.forEach((product, index) => {
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
  products: CurrentProductContext,
  allowed: Set<string>,
): string[] {
  const references = products.items
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

  if (products.items.length === 1 && products.focusedId && allowed.has(products.focusedId)) {
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
    if (!ToolMessage.isInstance(message) || message.name !== SELECT_PRODUCTS_TOOL_NAME) {
      continue;
    }
    const result = parseToolResult<SelectProductsResult>(message);
    if (result?.status !== "success" && result?.status !== "invalid") continue;
    for (const product of result.products) {
      if (allowed.has(product.id) && !ids.includes(product.id)) ids.push(product.id);
    }
  }
  return ids;
}

function currentToolBatchHasFinalSelect(messages: BaseMessage[]): boolean {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!ToolMessage.isInstance(message)) return false;
    if (message.name === SELECT_PRODUCTS_TOOL_NAME) return true;
  }
  return false;
}

function currentTurnSelectProductsResult(
  messages: BaseMessage[],
): SelectProductsResult | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!ToolMessage.isInstance(message)) break;
    if (message.name !== SELECT_PRODUCTS_TOOL_NAME) continue;
    return parseToolResult<SelectProductsResult>(message);
  }
  return undefined;
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
  name:
    | typeof LOAD_PRODUCTS_TOOL_NAME
    | typeof SELECT_PRODUCTS_TOOL_NAME
    | typeof QUERY_MERCHANT_INFO_TOOL_NAME,
  result: LoadProductsResult | SelectProductsResult | QueryMerchantInfoResult,
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
