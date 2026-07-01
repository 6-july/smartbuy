import { ConfigService } from "@nestjs/config";
import { HttpStatus } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { AppException } from "../../../src/common/app-exception";
import { AppEnv } from "../../../src/config/env";
import { ConversationsService } from "../../../src/conversations/conversations.service";

const conversation = {
  id: "conversation-id",
  merchant_id: "merchant-id",
};

const dto = {
  content: "推荐一个蛋糕",
  clientMessageId: "client-message-id",
};

function createService(responses: Array<{ rows: unknown[] }>) {
  const query = vi.fn(async () => responses.shift() || { rows: [] });
  const database = {
    transaction: async (work: (client: { query: typeof query }) => Promise<unknown>) =>
      work({ query }),
  };
  const config = { get: () => 120 } as unknown as ConfigService<AppEnv, true>;
  const service = new ConversationsService(
    database as never,
    {} as never,
    {} as never,
    config,
  );
  return { service, query };
}

function failedUserMessage() {
  return {
    id: "user-message-id",
    content: dto.content,
    processing_status: "failed",
    created_at: new Date(),
  };
}

describe("ConversationsService message claiming", () => {
  it("reclaims a failed message for retry", async () => {
    const { service } = createService([
      { rows: [] },
      { rows: [failedUserMessage()] },
      { rows: [] },
      { rows: [{ id: "user-message-id" }] },
      { rows: [] },
    ]);

    const result = await (service as any).claimUserMessage(conversation, "user-id", dto);

    expect(result).toEqual({
      userMessageId: "user-message-id",
      processingAttemptId: expect.any(String),
    });
  });

  it("returns the explicitly linked reply without running AI again", async () => {
    const { service } = createService([
      { rows: [] },
      { rows: [failedUserMessage()] },
      { rows: [{ id: "reply-id", content: "回复", products: [] }] },
    ]);

    const result = await (service as any).claimUserMessage(conversation, "user-id", dto);

    expect(result.reply).toEqual({ messageId: "reply-id", reply: "回复", products: [] });
  });

  it("rejects a recent processing message", async () => {
    const processing = { ...failedUserMessage(), processing_status: "processing" };
    const { service } = createService([
      { rows: [] },
      { rows: [processing] },
      { rows: [] },
      { rows: [] },
    ]);

    await expect(
      (service as any).claimUserMessage(conversation, "user-id", dto),
    ).rejects.toMatchObject<AppException>({
      code: "MESSAGE_PROCESSING",
      status: HttpStatus.CONFLICT,
    });
  });
});
