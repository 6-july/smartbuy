import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Request } from "express";

@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const [type, token] = request.headers.authorization?.split(" ") ?? [];
    if (type !== "Bearer" || !token) return true;
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; openId: string; status: string }>(
        token,
      );
      request.user = { id: payload.sub, openId: payload.openId, status: payload.status };
    } catch {
      // Optional authentication treats an invalid token as anonymous.
    }
    return true;
  }
}
