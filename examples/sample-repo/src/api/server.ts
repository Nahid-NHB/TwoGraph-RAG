import express from 'express';
import { getUserHandler, listUsersHandler, loginHandler } from './handlers';

/** Builds the demo API server with its route table. */
export function createServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/users', listUsersHandler);
  app.get('/api/users/:id', getUserHandler);
  app.post('/api/login', loginHandler);

  return app;
}
