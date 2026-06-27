import { timingSafeEqual } from "node:crypto";
import { CanActivate, ExecutionContext, HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request } from "express";
import { AppException } from "../common/app-exception";
import { AppEnv } from "../config/env";

@Injectable()
export class AdminGuard implements CanActivate {
  private readonly expected: Buffer;

  constructor(config: ConfigService<AppEnv, true>) {
    this.expected = Buffer.from(config.get("adminServiceToken", { infer: true }));
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const actual = Buffer.from(request.header("x-admin-token") || "");
    const valid = actual.length === this.expected.length && timingSafeEqual(actual, this.expected);
    if (!valid) {
      throw new AppException("FORBIDDEN", "管理员凭证无效", HttpStatus.FORBIDDEN);
    }
    return true;
  }
}
