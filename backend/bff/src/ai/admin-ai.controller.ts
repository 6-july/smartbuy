import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ApiHeader, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AdminGuard } from "../auth/admin.guard";
import { ChatModelService } from "./chat-model.service";
import { ModelLatencyProbeDto } from "./dto/model-latency-probe.dto";

@ApiTags("内部管理-AI")
@ApiHeader({ name: "x-admin-token", required: true })
@UseGuards(AdminGuard)
@Controller("admin/ai")
export class AdminAiController {
  constructor(private readonly chat: ChatModelService) {}

  @Post("model-latency")
  @ApiOperation({ summary: "裸调当前对话模型并返回耗时" })
  probeModelLatency(@Body() dto: ModelLatencyProbeDto) {
    return this.chat.probePlainModelLatency({
      prompt: dto.prompt,
      rounds: dto.rounds,
    });
  }
}
