import { Body, Controller, Get, Inject, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { IdParam, ZodPipe } from '../common/zod';
import { LaborService } from './labor.service';

const QuoteBody = z.object({
  variantId: z.number().int().positive(),
  operationIds: z.array(z.number().int().positive()).min(1).max(30),
  hourlyRateMillimes: z.number().int().min(0).max(10_000_000),
  customerName: z.string().max(120).nullish(),
});

@Controller()
export class LaborController {
  constructor(@Inject(LaborService) private readonly svc: LaborService) {}

  @Get('variants/:id/labor-operations')
  ops(@Param('id', IdParam) id: number) { return this.svc.operations(id); }

  @Post('quotes/preview')
  preview(@Body(new ZodPipe(QuoteBody)) b: z.infer<typeof QuoteBody>) { return this.svc.preview(b.variantId, b.operationIds, b.hourlyRateMillimes); }

  @Post('quotes')
  save(@Body(new ZodPipe(QuoteBody)) b: z.infer<typeof QuoteBody>) {
    return this.svc.save(b.variantId, b.operationIds, b.hourlyRateMillimes, b.customerName ?? null);
  }

  @Get('quotes/:id')
  get(@Param('id', new ZodPipe(z.uuid())) id: string) { return this.svc.get(id); }

  @Get('quotes/:id/pdf')
  async pdf(@Param('id', new ZodPipe(z.uuid())) id: string, @Res() res: Response) {
    const buf = await this.svc.pdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="devis-${id.slice(0, 8)}.pdf"`);
    res.send(buf);
  }
}
