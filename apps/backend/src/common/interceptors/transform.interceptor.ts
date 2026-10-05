// SSOT Phase 001 §5 — envelope { data } for object responses
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, { data: T }> {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<{ data: T }> {
    return next.handle().pipe(map((data) => ({ data })));
  }
}
