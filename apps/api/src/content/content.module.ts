import { Module } from '@nestjs/common';
import { ContentController } from './content.controller';

@Module({ controllers: [ContentController] })
export class ContentModule {}
