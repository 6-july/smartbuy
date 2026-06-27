import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { DatabaseService } from "../database/database.service";

@ApiTags("健康检查")
@Controller("health")
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

  @Get()
  @ApiOperation({ summary: "检查服务和数据库连接" })
  async health(): Promise<{ status: "ok"; database: "ok" }> {
    await this.database.ping();
    return { status: "ok", database: "ok" };
  }
}
