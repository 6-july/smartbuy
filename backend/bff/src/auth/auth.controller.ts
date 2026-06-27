import { Body, Controller, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuthService } from "./auth.service";
import { WechatLoginDto } from "./dto/wechat-login.dto";

@ApiTags("登录")
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("wechat-login")
  @ApiOperation({ summary: "使用微信登录 code 登录或注册" })
  login(@Body() dto: WechatLoginDto) {
    return this.auth.login(dto);
  }
}
