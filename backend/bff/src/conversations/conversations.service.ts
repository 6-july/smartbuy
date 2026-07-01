import { randomUUID } from "node:crypto";
import { HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AiOrchestratorService } from "../ai/ai-orchestrator.service";
import { ChatMessage } from "../ai/domain";
import { AppException } from "../common/app-exception";
import { AppEnv } from "../config/env";
import { DatabaseService } from "../database/database.service";
import { ProductsService } from "../products/products.service";
import { AdminConversationQueryDto } from "./dto/admin-conversation-query.dto";
import { SendMessageDto } from "./dto/send-message.dto";

interface ConversationRow {
  id: string;
  user_id: string;
  merchant_id: string;
  last_message: string | null;
  last_message_time: Date | null;
  status: string;
  merchant_name: string;
  merchant_logo: string | null;
  merchant_description: string | null;
  merchant_app_id: string;
  merchant_phone: string | null;
  merchant_industry: string;
  merchant_status: string;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  message_type: string;
  products: unknown[];
  client_message_id: string | null;
  processing_status: "processing" | "completed" | "failed";
  processing_started_at: Date | null;
  processing_completed_at: Date | null;
  processing_attempt_id: string | null;
  reply_to_message_id: string | null;
  created_at: Date;
}

export interface MessageReply {
  messageId: string;
  reply: string;
  products: unknown[];
}

@Injectable()
export class ConversationsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly ai: AiOrchestratorService,
    private readonly products: ProductsService,
    private readonly config: ConfigService<AppEnv, true>,
  ) {}

  async listForUser(userId: string, keyword?: string) {
    const values: unknown[] = [userId];
    let keywordSql = "";
    if (keyword?.trim()) {
      values.push(keyword.trim());
      keywordSql = `AND m.name ILIKE '%' || $${values.length} || '%'`;
    }
    const result = await this.database.query<ConversationRow>(
      `SELECT * FROM (
         SELECT DISTINCT ON (c.merchant_id)
                c.*, m.name AS merchant_name, m.logo AS merchant_logo,
                m.description AS merchant_description,
                m.mini_program_app_id AS merchant_app_id,
                m.phone AS merchant_phone,
                m.industry AS merchant_industry,
                m.status AS merchant_status
         FROM conversations c
         JOIN merchants m ON m.id = c.merchant_id
         WHERE c.user_id = $1
           AND c.status = 'active'
           AND c.last_message_time IS NOT NULL
           AND m.status = 'enabled'
         ${keywordSql}
         ORDER BY c.merchant_id, c.last_message_time DESC NULLS LAST, c.created_at DESC
       ) latest
       ORDER BY latest.last_message_time DESC NULLS LAST, latest.created_at DESC`,
      values,
    );
    return {
      list: result.rows.map((row) => ({
        conversationId: row.id,
        merchantId: row.merchant_id,
        merchantName: row.merchant_name,
        merchantLogo: row.merchant_logo,
        lastMessage: row.last_message,
        lastMessageTime: row.last_message_time,
      })),
    };
  }

  async listMessages(conversationId: string, userId: string) {
    const conversation = await this.getOwnedConversation(conversationId, userId);
    const result = await this.database.query<MessageRow>(
      `SELECT * FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC
       LIMIT 200`,
      [conversationId],
    );
    if (result.rows.length === 0) {
      const welcome = await this.createWelcomeMessage(conversation);
      return { list: [this.mapMessage(welcome)] };
    }
    return { list: result.rows.map((row) => this.mapMessage(row)) };
  }

  private async createWelcomeMessage(conversation: ConversationRow): Promise<MessageRow> {
    const greeting = `你好呀！欢迎来到「${conversation.merchant_name}」～😊 我是你的智能导购助手，可以帮你推荐商品、查看价格和规格。告诉我你想找什么，或者直接问我吧！`;
    const result = await this.database.query<MessageRow>(
      `INSERT INTO messages (
         conversation_id, user_id, merchant_id, role, content, message_type
       ) VALUES ($1, $2, $3, 'assistant', $4, 'text')
       RETURNING *`,
      [conversation.id, conversation.user_id, conversation.merchant_id, greeting],
    );
    return result.rows[0];
  }

  async send(conversationId: string, userId: string, dto: SendMessageDto) {
    const conversation = await this.getOwnedConversation(conversationId, userId);
    if (conversation.merchant_status !== "enabled") {
      throw new AppException(
        "MERCHANT_DISABLED",
        "该商家导购服务暂不可用",
        HttpStatus.CONFLICT,
      );
    }

    const claim = await this.claimUserMessage(conversation, userId, dto);
    if (claim.reply) return claim.reply;
    const processingAttemptId = claim.processingAttemptId;
    if (!processingAttemptId) throw new Error("Claimed message is missing a processing attempt id");

    try {
      const historyResult = await this.database.query<MessageRow>(
        `SELECT * FROM messages
         WHERE conversation_id = $1
         ORDER BY created_at DESC
         LIMIT 10`,
        [conversationId],
      );
      const history: ChatMessage[] = historyResult.rows
        .reverse()
        .filter((message) => message.id !== claim.userMessageId)
        .map((message) => ({ role: message.role, content: message.content }));
      const recentProducts = extractRecentProducts(historyResult.rows);
      const guide = await this.ai.guide({
        merchant: {
          id: conversation.merchant_id,
          name: conversation.merchant_name,
          description: conversation.merchant_description,
          phone: conversation.merchant_phone,
          industry: conversation.merchant_industry,
        },
        question: dto.content,
        history,
        recentProducts,
        trace: {
          userId,
          sessionId: conversationId,
          clientMessageId: dto.clientMessageId || "",
        },
      });

      const cards = guide.products.map(({ row }) => {
        const product = this.products.toProduct(row);
        const images = (product.images as Array<{ url?: string }>)
          .map((img) => img.url)
          .filter(Boolean) as string[];
        const specs = (product.options as Array<{ name: string; type?: string; options?: Array<{ name: string; price?: number }> }>)
          .filter((opt) => opt.type === "price" && opt.options?.length)
          .map((opt) => ({
            name: opt.name,
            values: opt.options!.map((v) => ({ label: v.name, price: v.price ?? null })),
          }));
        return {
          productId: product.id,
          name: product.title,
          tags: product.tags,
          description: product.description,
          price: product.displayPrice,
          minPrice: product.minPrice,
          maxPrice: product.maxPrice,
          imageUrl: images[0] || null,
          images,
          specs,
          miniProgramAppId: conversation.merchant_app_id,
          miniProgramPath: product.miniProgramPath,
          miniProgramParams: product.miniProgramParams,
        };
      });

      return await this.database.transaction(async (client) => {
        const completed = await client.query<{ id: string }>(
          `UPDATE messages
           SET processing_status = 'completed', processing_completed_at = now()
           WHERE id = $1
             AND processing_status = 'processing'
             AND processing_attempt_id = $2
           RETURNING id`,
          [claim.userMessageId, processingAttemptId],
        );
        if (!completed.rows[0]) {
          const existing = await client.query<MessageRow>(
            `SELECT * FROM messages WHERE reply_to_message_id = $1 LIMIT 1`,
            [claim.userMessageId],
          );
          const row = existing.rows[0];
          if (row) {
            return { messageId: row.id, reply: row.content, products: row.products };
          }
          throw new AppException(
            "MESSAGE_PROCESSING",
            "该消息已由新的请求接管处理",
            HttpStatus.CONFLICT,
          );
        }

        const inserted = await client.query<{ id: string }>(
          `INSERT INTO messages (
             conversation_id, user_id, merchant_id, role, content,
             message_type, products, reply_to_message_id
           ) VALUES ($1, $2, $3, 'assistant', $4, $5, $6::jsonb, $7)
           ON CONFLICT (reply_to_message_id) WHERE reply_to_message_id IS NOT NULL
           DO NOTHING
           RETURNING id`,
          [
            conversationId,
            userId,
            conversation.merchant_id,
            guide.reply,
            cards.length > 0 ? "product_card" : "text",
            JSON.stringify(cards),
            claim.userMessageId,
          ],
        );

        let reply: MessageReply;
        if (inserted.rows[0]) {
          reply = {
            messageId: inserted.rows[0].id,
            reply: guide.reply,
            products: cards,
          };
        } else {
          const existing = await client.query<MessageRow>(
            `SELECT * FROM messages WHERE reply_to_message_id = $1 LIMIT 1`,
            [claim.userMessageId],
          );
          const row = existing.rows[0];
          if (!row) throw new Error("Reply conflict found without an existing reply");
          reply = { messageId: row.id, reply: row.content, products: row.products };
        }

        await client.query(
          `UPDATE conversations
           SET last_message = $2, last_message_time = now()
           WHERE id = $1`,
          [conversationId, reply.reply],
        );
        return reply;
      });
    } catch (error) {
      await this.markMessageFailed(claim.userMessageId, processingAttemptId);
      throw error;
    }
  }

  async adminList(query: AdminConversationQueryDto) {
    const conditions = ["1=1"];
    const values: unknown[] = [];
    if (query.merchantId) {
      values.push(query.merchantId);
      conditions.push(`c.merchant_id = $${values.length}`);
    }
    if (query.userId) {
      values.push(query.userId);
      conditions.push(`c.user_id = $${values.length}`);
    }
    values.push(query.pageSize, (query.page - 1) * query.pageSize);
    const result = await this.database.query<ConversationRow & { total_count: string }>(
      `SELECT c.*, m.name AS merchant_name, m.logo AS merchant_logo,
              m.description AS merchant_description,
              m.mini_program_app_id AS merchant_app_id,
              m.phone AS merchant_phone,
              m.industry AS merchant_industry,
              m.status AS merchant_status,
              count(*) OVER() AS total_count
       FROM conversations c
       JOIN merchants m ON m.id = c.merchant_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY c.last_message_time DESC NULLS LAST, c.created_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return {
      list: result.rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        merchantId: row.merchant_id,
        merchantName: row.merchant_name,
        lastMessage: row.last_message,
        lastMessageTime: row.last_message_time,
        status: row.status,
      })),
      total: Number(result.rows[0]?.total_count || 0),
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async adminMessages(conversationId: string) {
    const result = await this.database.query<MessageRow>(
      `SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
      [conversationId],
    );
    return { list: result.rows.map((row) => this.mapMessage(row)) };
  }

  private async getOwnedConversation(id: string, userId: string): Promise<ConversationRow> {
    const result = await this.database.query<ConversationRow>(
      `SELECT c.*, m.name AS merchant_name, m.logo AS merchant_logo,
              m.description AS merchant_description,
              m.mini_program_app_id AS merchant_app_id,
              m.phone AS merchant_phone,
              m.industry AS merchant_industry,
              m.status AS merchant_status
       FROM conversations c
       JOIN merchants m ON m.id = c.merchant_id
       WHERE c.id = $1 AND c.user_id = $2 AND c.status = 'active'`,
      [id, userId],
    );
    if (!result.rows[0]) {
      throw new AppException(
        "CONVERSATION_NOT_FOUND",
        "会话不存在或无权访问",
        HttpStatus.NOT_FOUND,
      );
    }
    return result.rows[0];
  }

  private async claimUserMessage(
    conversation: ConversationRow,
    userId: string,
    dto: SendMessageDto,
  ): Promise<{ userMessageId: string; processingAttemptId?: string; reply?: MessageReply }> {
    const timeoutSeconds = this.config.get("messageProcessingTimeoutSeconds", { infer: true });
    const processingAttemptId = randomUUID();
    return this.database.transaction(async (client) => {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO messages (
           conversation_id, user_id, merchant_id, role, content,
           message_type, client_message_id, processing_status,
           processing_started_at, processing_attempt_id
         ) VALUES ($1, $2, $3, 'user', $4, 'text', $5, 'processing', now(), $6)
         ON CONFLICT (conversation_id, client_message_id) WHERE client_message_id IS NOT NULL
         DO NOTHING
         RETURNING id`,
        [
          conversation.id,
          userId,
          conversation.merchant_id,
          dto.content,
          dto.clientMessageId,
          processingAttemptId,
        ],
      );
      if (inserted.rows[0]) {
        await client.query(
          `UPDATE conversations
           SET last_message = $2, last_message_time = now()
           WHERE id = $1`,
          [conversation.id, dto.content],
        );
        return { userMessageId: inserted.rows[0].id, processingAttemptId };
      }

      const existingUser = await client.query<MessageRow>(
        `SELECT * FROM messages
         WHERE conversation_id = $1 AND client_message_id = $2
         LIMIT 1`,
        [conversation.id, dto.clientMessageId],
      );
      const userMessage = existingUser.rows[0];
      if (!userMessage) throw new Error("Message conflict found without an existing message");
      if (userMessage.content !== dto.content) {
        throw new AppException(
          "IDEMPOTENCY_KEY_REUSED",
          "同一个消息标识不能用于不同内容",
          HttpStatus.CONFLICT,
        );
      }

      const explicitReply = await client.query<MessageRow>(
        `SELECT * FROM messages WHERE reply_to_message_id = $1 LIMIT 1`,
        [userMessage.id],
      );
      if (explicitReply.rows[0]) {
        const row = explicitReply.rows[0];
        return {
          userMessageId: userMessage.id,
          reply: { messageId: row.id, reply: row.content, products: row.products },
        };
      }

      if (userMessage.processing_status === "completed") {
        const legacyReply = await client.query<MessageRow>(
          `SELECT * FROM messages
           WHERE conversation_id = $1
             AND role = 'assistant'
             AND reply_to_message_id IS NULL
             AND created_at >= $2
           ORDER BY created_at ASC
           LIMIT 1`,
          [conversation.id, userMessage.created_at],
        );
        if (legacyReply.rows[0]) {
          const row = legacyReply.rows[0];
          return {
            userMessageId: userMessage.id,
            reply: { messageId: row.id, reply: row.content, products: row.products },
          };
        }
      }

      const claimed = await client.query<{ id: string }>(
        `UPDATE messages
         SET processing_status = 'processing',
             processing_started_at = now(),
             processing_completed_at = NULL,
             processing_attempt_id = $3
         WHERE id = $1
           AND (
             processing_status IN ('failed', 'completed')
             OR processing_started_at IS NULL
             OR processing_started_at < now() - ($2::int * INTERVAL '1 second')
           )
         RETURNING id`,
        [userMessage.id, timeoutSeconds, processingAttemptId],
      );
      if (!claimed.rows[0]) {
        throw new AppException(
          "MESSAGE_PROCESSING",
          "该消息正在处理中，请稍后重试",
          HttpStatus.CONFLICT,
        );
      }

      await client.query(
        `UPDATE conversations
         SET last_message = $2, last_message_time = now()
         WHERE id = $1`,
        [conversation.id, userMessage.content],
      );
      return { userMessageId: claimed.rows[0].id, processingAttemptId };
    });
  }

  private async markMessageFailed(messageId: string, processingAttemptId: string): Promise<void> {
    try {
      await this.database.query(
        `UPDATE messages
         SET processing_status = 'failed', processing_completed_at = now()
         WHERE id = $1
           AND processing_status = 'processing'
           AND processing_attempt_id = $2
           AND NOT EXISTS (
             SELECT 1 FROM messages reply WHERE reply.reply_to_message_id = messages.id
           )`,
        [messageId, processingAttemptId],
      );
    } catch (error) {
      console.error("[ConversationsService] failed to mark message as failed:", error);
    }
  }

  private mapMessage(row: MessageRow) {
    return {
      id: row.id,
      role: row.role,
      content: row.content,
      messageType: row.message_type,
      products: row.products,
      createdAt: row.created_at,
    };
  }
}

function extractRecentProducts(messages: MessageRow[]): Array<{ id: string; name: string }> {
  const latest = messages.find(
    (message) =>
      message.role === "assistant" &&
      Array.isArray(message.products) &&
      message.products.length > 0,
  );
  if (!latest) return [];

  return latest.products
    .map((product) => {
      if (typeof product !== "object" || product === null) return null;
      const item = product as { productId?: unknown; name?: unknown };
      return typeof item.productId === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.productId) &&
        typeof item.name === "string" &&
        item.name.trim()
        ? { id: item.productId, name: item.name.trim() }
        : null;
    })
    .filter((product): product is { id: string; name: string } => Boolean(product))
    .slice(0, 5);
}
