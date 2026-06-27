import { CanActivate, ExecutionContext, HttpStatus, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Request } from "express";
import { AppException } from "../common/app-exception";
import { DatabaseService } from "../database/database.service";
import { AuthUser } from "./auth.types";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly database: DatabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const [type, token] = request.headers.authorization?.split(" ") ?? [];
    if (type !== "Bearer" || !token) {
      throw new AppException("UNAUTHORIZED", "需要登录", HttpStatus.UNAUTHORIZED);
    }

    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; openId: string; status: string }>(
        token,
      );
      const current = await this.database.query<{ status: string }>(
        `SELECT status FROM users WHERE id = $1`,
        [payload.sub],
      );
      if (current.rows[0]?.status !== "enabled") throw new Error("User is disabled");
      request.user = { id: payload.sub, openId: payload.openId, status: payload.status } as AuthUser;
      return true;
    } catch {
      throw new AppException("UNAUTHORIZED", "登录状态无效或已过期", HttpStatus.UNAUTHORIZED);
    }
  }
}
