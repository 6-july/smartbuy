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
import { ChatMessage, RecentProductReference } from "../domain";
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
  SelectProductsExecutionInput,
  SelectProductsResult,
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
      finalAnswer: null,
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
    if (!state.finalAnswer) {
      throw new Error("Guide graph did not finalize an answer");
    }
    return {
      reply: state.finalAnswer.reply,
      productIds: state.finalAnswer.productIds,
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
          queryMerchantInfoToolDefinition,
        ],
        forcedToolChoice ? { toolChoice: forcedToolChoice } : undefined,
      );
      return { messages: [response] };
    };

    const finalizeNode = async (state: GuideStateValue) => {
      const output = parseSafeGuideFinalOutput(state.messages.at(-1));
      const reply = resolveResponseReply(output.reply, state);
      const result = await this.runProductFinalizer(
        {
          reply,
          productIds: output.productIds,
        },
        state,
      );
      return {
        finalAnswer: {
          reply: result.reply,
          productIds: result.productIds,
        },
        currentProducts: applyCurrentProductContext(state.currentProducts, result),
      };
    };

    const shouldContinue = (state: GuideStateValue) => {
      const last = state.messages.at(-1);
      if (!AIMessage.isInstance(last)) return "finalize";
      return last.tool_calls?.some((call) => isGuideToolName(call.name))
        ? "tools"
        : "finalize";
    };

    return new StateGraph(GuideStateAnnotation)
      .addNode("agent", agentNode)
      .addNode("tools", toolNode)
      .addNode("finalize", finalizeNode)
      .addEdge(START, "agent")
      .addConditionalEdges("agent", shouldContinue, { tools: "tools", finalize: "finalize" })
      .addEdge("tools", "agent")
      .addEdge("finalize", END)
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

    return [loadProductsTool, queryMerchantInfoTool];
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

  private async runProductFinalizer(
    args: Omit<SelectProductsExecutionInput, "question" | "products" | "currentProducts">,
    state: GuideStateValue,
  ): Promise<SelectProductsResult> {
    try {
      return await this.selectProducts.execute({
        productIds: args.productIds,
        reply: args.reply,
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
        reason: error instanceof Error ? error.message : "商品结果整理失败",
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
  return name === LOAD_PRODUCTS_TOOL_NAME || name === QUERY_MERCHANT_INFO_TOOL_NAME;
}

function parseSafeGuideFinalOutput(message: BaseMessage | undefined): GuideFinalOutput {
  try {
    return parseGuideFinalOutput(message);
  } catch {
    return {
      reply: "我暂时没能完成这次查询，可以换个口味、预算或商品类型再试试。",
      productIds: [],
    };
  }
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
      function: { name: typeof LOAD_PRODUCTS_TOOL_NAME };
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

  if (state.products.items.length > 0) return undefined;

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
  if (isGiftOrRecipientProductNeed(normalized)) return true;
  return /(推荐|帮我.*(?:选|找|看)|看看|想要|想买|来一?[个款份]|哪个好|有什么|有没有|蛋糕|甜品|商品|口味|味道|尺寸|预算|价格|多少钱|贵|便宜|实惠|划算|超预算|巧克力|草莓|芒果|榴莲|抹茶|奶油|水果|奥利奥|可可|黑巧|生巧)/.test(normalized);
}

function isGiftOrRecipientProductNeed(question: string): boolean {
  if (/(配送|送货|外送|送到|能送|可以送|邮寄|快递)/.test(question)) return false;
  return /(送(?:长辈|老人|父母|爸妈|妈妈|爸爸|女友|男友|朋友|同事|客户|孩子|宝宝|小孩|女生|男生|女士|男士)|想送|送礼|礼物|生日|纪念日|长辈|老人|父母|爸妈|妈妈|爸爸|女友|男友|孩子|宝宝|儿童|男士|女士)/.test(question);
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
  name: typeof LOAD_PRODUCTS_TOOL_NAME | typeof QUERY_MERCHANT_INFO_TOOL_NAME,
  result: LoadProductsResult | QueryMerchantInfoResult,
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
