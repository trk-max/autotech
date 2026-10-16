import { Controller, Get, Inject, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { IdParam, ZodPipe } from '../common/zod';
import { WiringService } from './wiring.service';

@Controller()
export class WiringController {
  constructor(@Inject(WiringService) private readonly svc: WiringService) {}

  @Get('variants/:id/diagrams')
  list(@Param('id', IdParam) id: number) { return this.svc.diagramsForVariant(id); }

  @Get('diagrams/:id')
  diagram(@Param('id', IdParam) id: number) { return this.svc.diagram(id); }

  @Get('diagrams/:id/svg')
  async svg(@Param('id', IdParam) id: number, @Res() res: Response) {
    const file = await this.svc.svgPath(id);
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // content-addressed
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    res.sendFile(file);
  }

  @Get('diagrams/:id/trace')
  trace(@Param('id', IdParam) id: number, @Query('wire', IdParam) wire: number) { return this.svc.trace(id, wire); }

  @Get('wiring/entity/:kind/:entityId')
  entity(
    @Param('kind', new ZodPipe(z.enum(['wire', 'node', 'ground', 'component']))) kind: string,
    @Param('entityId', IdParam) entityId: number,
  ) { return this.svc.entity(kind, entityId); }
}
