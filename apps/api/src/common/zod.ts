import { BadRequestException, type PipeTransform } from '@nestjs/common';
import { z } from 'zod';

export class ZodPipe<T extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}
  transform(value: unknown): z.infer<T> {
    const r = this.schema.safeParse(value);
    if (!r.success) {
      throw new BadRequestException({
        message: 'Données invalides',
        issues: r.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return r.data;
  }
}

export const IdParam = new ZodPipe(z.coerce.number().int().positive());
