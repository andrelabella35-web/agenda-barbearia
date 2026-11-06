import { createApp } from './app.js';
import { config } from './config.js';

createApp().listen(config.port, () => {
  console.log(`Agenda rodando em http://localhost:${config.port}  (admin: /admin)`);
});
