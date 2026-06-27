import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser } from "../auth/auth.types";
import { ConversationsService } from "./conversations.service";
import { SendMessageDto } from "./dto/send-message.dto";

@ApiTags("会话")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller()
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get("conversations")
  @ApiQuery({ name: "keyword", required: false })
  @ApiOperation({ summary: "获取当前用户历史商家会话" })
  list(@CurrentUser() user: AuthUser, @Query("keyword") keyword?: string) {
    return this.conversations.listForUser(user.id, keyword);
  }

  @Get("conversation/:conversationId/messages")
  @ApiOperation({ summary: "获取当前用户会话消息" })
  messages(@Param("conversationId") conversationId: string, @CurrentUser() user: AuthUser) {
    return this.conversations.listMessages(conversationId, user.id);
  }

  @Post("conversation/:conversationId/message")
  @ApiOperation({ summary: "发送消息并获取 AI 导购回复和商品卡片" })
  send(
    @Param("conversationId") conversationId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: SendMessageDto,
  ) {
    return this.conversations.send(conversationId, user.id, dto);
  }
}
