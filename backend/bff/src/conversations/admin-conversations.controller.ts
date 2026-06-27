import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { ApiHeader, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AdminGuard } from "../auth/admin.guard";
import { ConversationsService } from "./conversations.service";
import { AdminConversationQueryDto } from "./dto/admin-conversation-query.dto";

@ApiTags("内部管理-会话")
@ApiHeader({ name: "x-admin-token", required: true })
@UseGuards(AdminGuard)
@Controller("admin/conversations")
export class AdminConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  @ApiOperation({ summary: "按商家或用户分页查看会话" })
  list(@Query() query: AdminConversationQueryDto) {
    return this.conversations.adminList(query);
  }

  @Get(":conversationId/messages")
  @ApiOperation({ summary: "查看指定会话消息" })
  messages(@Param("conversationId") conversationId: string) {
    return this.conversations.adminMessages(conversationId);
  }
}
