import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { Request, Response } from "express";

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request & { requestId?: string }>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload = exception instanceof HttpException ? exception.getResponse() : null;
    const body = typeof payload === "object" && payload !== null ? payload : {};
    const message =
      typeof payload === "string"
        ? payload
        : (body as { message?: string | string[] }).message || "Internal server error";

    response.status(status).json({
      code:
        (body as { code?: string }).code ||
        (status === 500 ? "INTERNAL_ERROR" : "REQUEST_FAILED"),
      message,
      details: (body as { details?: unknown }).details,
      requestId: request.requestId,
    });
  }
}
