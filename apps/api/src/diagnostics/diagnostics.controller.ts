import { Body, Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { MAX_DTCS } from '@autotech/engines';
import { IdParam, ZodPipe } from '../common/zod';
import { DiagnosticsService } from './diagnostics.service';

const StartBody = z.object({ variantId: z.number().int().positive(), codes: z.array(z.string().min(3).max(8)).min(1).max(MAX_DTCS) });
const ResultBody = z.object({
  causeId: z.string().min(3).max(40),
  steps: z.array(z.object({ stepId: z.number().int().positive(), value: z.number().finite().nullish(), ok: z.boolean().nullish() })).min(1).max(20),
});
const HvBody = z.object({ confirmedSteps: z.array(z.number().int().min(0)).max(50) });
const CloseBody = z.object({ causeId: z.string().max(40).nullish(), note: z.string().max(2000).nullish() });
const SessionId = new ZodPipe(z.uuid());
const IdList = new ZodPipe(z.string().default('').transform(s => s.split(',').filter(Boolean).map(Number)).pipe(z.array(z.number().int().positive()).max(50)));

@Controller()
export class DiagnosticsController {
  constructor(@Inject(DiagnosticsService) private readonly svc: DiagnosticsService) {}

  @Get('variants/:id/dtcs')
  dtcs(@Param('id', IdParam) id: number, @Query('q', new ZodPipe(z.string().max(60).default(''))) q: string) { return this.svc.searchDtcs(id, q); }

  @Get('variants/:id/knowledge')
  knowledge(@Param('id', IdParam) id: number, @Query('dtcs', IdList) dtcs: number[]) { return this.svc.knowledge(id, dtcs); }

  @Get('diagnostics/sessions')
  recent() { return this.svc.recent(); }

  @Post('diagnostics/sessions')
  start(@Body(new ZodPipe(StartBody)) body: z.infer<typeof StartBody>) { return this.svc.start(body.variantId, body.codes); }

  @Get('diagnostics/sessions/:id')
  view(@Param('id', SessionId) id: string) { return this.svc.view(id); }

  @Post('diagnostics/sessions/:id/results')
  result(@Param('id', SessionId) id: string, @Body(new ZodPipe(ResultBody)) body: z.infer<typeof ResultBody>) {
    return this.svc.record(id, body.causeId, body.steps);
  }

  @Post('diagnostics/sessions/:id/hv-isolation')
  hv(@Param('id', SessionId) id: string, @Body(new ZodPipe(HvBody)) body: z.infer<typeof HvBody>) {
    return this.svc.confirmHvIsolation(id, body.confirmedSteps);
  }

  @Post('diagnostics/sessions/:id/close')
  close(@Param('id', SessionId) id: string, @Body(new ZodPipe(CloseBody)) body: z.infer<typeof CloseBody>) {
    return this.svc.close(id, body.causeId ?? null, body.note ?? null);
  }

  @Get('test-procedures/:id')
  test(@Param('id', IdParam) id: number) { return this.svc.testProcedure(id); }
}
