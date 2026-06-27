import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { Request } from "express";
import { AuthUser } from "./auth.types";

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => {
    return context.switchToHttp().getRequest<Request>().user as AuthUser;
  },
);
