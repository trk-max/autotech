import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';

/** Engine errors (plain Error) become 400 with their French message; unknown errors stay 500. */
@Catch()
export class ErrorsFilter implements ExceptionFilter {
  private readonly log = new Logger('Errors');
  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (err instanceof HttpException) {
      const body = err.getResponse();
      res.status(err.getStatus()).json(typeof body === 'string' ? { message: body } : body);
      return;
    }
    if (err instanceof DomainError) {
      res.status(HttpStatus.BAD_REQUEST).json({ message: err.message });
      return;
    }
    this.log.error(err instanceof Error ? err.stack : String(err));
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: 'Erreur interne du serveur' });
  }
}

export class DomainError extends Error {}

/** Run engine code, converting thrown Errors into DomainError (HTTP 400). */
export function domain<T>(fn: () => T): T {
  try { return fn(); } catch (e) { throw new DomainError((e as Error).message); }
}
