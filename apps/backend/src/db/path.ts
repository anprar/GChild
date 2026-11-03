import { z } from 'zod';

const envSchema = z.object({
  DATABASE_PATH: z.string().min(1).default('./data/gchild.sqlite'),
});

/** CLI (migrate/admin/prune) hanya butuh path database, bukan seluruh config. */
export function loadDatabasePath(env: NodeJS.ProcessEnv = process.env): string {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error('DATABASE_PATH tidak valid.');
  }
  return parsed.data.DATABASE_PATH;
}
