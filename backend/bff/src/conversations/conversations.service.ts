import { HttpStatus, Injectable } from "@nestjs/common";
import { ChatMessage } from "@smartbuy/ai";
import { AiOrchestratorService } from "../ai/ai-orchestrator.service";
import { AppException } from "../common/app-exception";
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
  created_at: Date;
}

@Injectable()
export class ConversationsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly ai: AiOrchestratorService,
    private readonly products: ProductsService,
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
                m.status AS merchant_status
         FROM conversations c
         JOIN merchants m ON m.id = c.merchant_id
         WHERE c.user_id = $1 AND c.status = 'active' AND m.status = 'enabled'
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

    const existing = await this.findIdempotentReply(conversationId, dto.clientMessageId);
    if (existing) return existing;

    const insertedUserMessage = await this.database.transaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO messages (
           conversation_id, user_id, merchant_id, role, content,
           message_type, client_message_id
         ) VALUES ($1, $2, $3, 'user', $4, 'text', $5)
         ON CONFLICT (conversation_id, client_message_id) WHERE client_message_id IS NOT NULL
         DO NOTHING`,
        [conversationId, userId, conversation.merchant_id, dto.content, dto.clientMessageId],
      );
      await client.query(
        `UPDATE conversations
         SET last_message = $2, last_message_time = now()
         WHERE id = $1`,
        [conversationId, dto.content],
      );
      return inserted.rowCount === 1;
    });

    if (!insertedUserMessage) {
      const completed = await this.findIdempotentReply(conversationId, dto.clientMessageId);
      if (completed) return completed;
      throw new AppException(
        "MESSAGE_PROCESSING",
        "该消息正在处理中，请稍后重试",
        HttpStatus.CONFLICT,
      );
    }

    const historyResult = await this.database.query<MessageRow>(
      `SELECT * FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [conversationId],
    );
    const history: ChatMessage[] = historyResult.rows
      .reverse()
      .filter((message) => message.client_message_id !== dto.clientMessageId)
      .map((message) => ({ role: message.role, content: message.content }));
    const guide = await this.ai.guide({
      merchant: {
        id: conversation.merchant_id,
        name: conversation.merchant_name,
        description: conversation.merchant_description,
      },
      question: dto.content,
      history,
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
    const saved = await this.database.transaction(async (client) => {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO messages (
           conversation_id, user_id, merchant_id, role, content,
           message_type, products
         ) VALUES ($1, $2, $3, 'assistant', $4, $5, $6::jsonb)
         RETURNING id`,
        [
          conversationId,
          userId,
          conversation.merchant_id,
          guide.reply,
          cards.length > 0 ? "product_card" : "text",
          JSON.stringify(cards),
        ],
      );
      await client.query(
        `UPDATE conversations
         SET last_message = $2, last_message_time = now()
         WHERE id = $1`,
        [conversationId, guide.reply],
      );
      return inserted.rows[0].id;
    });
    return { messageId: saved, reply: guide.reply, products: cards };
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

  private async findIdempotentReply(conversationId: string, clientMessageId: string) {
    const result = await this.database.query<MessageRow>(
      `SELECT a.*
       FROM messages u
       JOIN LATERAL (
         SELECT * FROM messages candidate
         WHERE candidate.conversation_id = u.conversation_id
           AND candidate.role = 'assistant'
           AND candidate.created_at >= u.created_at
         ORDER BY candidate.created_at ASC
         LIMIT 1
       ) a ON true
       WHERE u.conversation_id = $1
         AND u.client_message_id = $2
       LIMIT 1`,
      [conversationId, clientMessageId],
    );
    const message = result.rows[0];
    if (!message) return null;
    return { messageId: message.id, reply: message.content, products: message.products };
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
