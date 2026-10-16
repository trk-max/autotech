import { createApp } from './app';
import { config } from './config';

createApp().then(async app => {
  await app.listen(config.port);
  console.log(`AutoTech API on http://localhost:${config.port}/api`);
});
