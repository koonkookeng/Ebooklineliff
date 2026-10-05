// SSOT Phase 001 §5 — global exception shape
import { Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

@Catch()
export class HttpExceptionFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();
    const req = ctx.getRequest();
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const traceId = req?.id ?? req?.headers?.['x-request-id'] ?? undefined;
    res.status(status).send({
      statusCode: status,
      message: exception instanceof HttpException ? exception.message : 'Internal server error',
      path: req?.url,
      ...(traceId ? { traceId } : {}),
    });
  }
}
