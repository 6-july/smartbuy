import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { AppEnv } from "../config/env";
import { AdminGuard } from "./admin.guard";
import { AuthController } from "./auth.controller";
import { AuthGuard } from "./auth.guard";
import { AuthService } from "./auth.service";
import { OptionalAuthGuard } from "./optional-auth.guard";
import { WechatService } from "./wechat.service";

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnv, true>) => ({
        secret: config.get("jwtSecret", { infer: true }),
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, WechatService, AuthGuard, OptionalAuthGuard, AdminGuard],
  exports: [JwtModule, WechatService, AuthGuard, OptionalAuthGuard, AdminGuard],
})
export class AuthModule {}
