import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.js';

export interface HealthDeps {
  db: Db;
  version: string;
  startedAt: number;
  now: () => number;
}

/** Health/ready tanpa secret dan tanpa detail dependency yang sensitif. */
export function registerHealthRoutes(app: FastifyInstance, deps: HealthDeps): void {
  app.get('/v1/healthz', async () => ({
    status: 'ok',
    version: deps.version,
    uptimeSeconds: Math.max(0, Math.round((deps.now() - deps.startedAt) / 1000)),
  }));

  app.get('/v1/readyz', async (_request, reply) => {
    try {
      deps.db.prepare('SELECT 1 AS ok').get();
      return { status: 'ready', checks: { database: 'ok' } };
    } catch {
      return reply.status(503).send({ status: 'not_ready', checks: { database: 'unavailable' } });
    }
  });
}
