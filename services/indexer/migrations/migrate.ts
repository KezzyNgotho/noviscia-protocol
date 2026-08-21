/**
 * Novisca Indexer — SQL Migration Runner
 *
 * Reads numbered .sql files from migrations/ and applies them in order.
 * Tracks applied migrations in a _migrations table.
 *
 * Usage:
 *   npx tsx services/indexer/migrations/migrate.ts          # apply all pending
 *   npx tsx services/indexer/migrations/migrate.ts --status  # show applied
 *   npx tsx services/indexer/migrations/migrate.ts --dry-run # show what would run
 */
import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL environment variable is required');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });
const MIGRATIONS_DIR = path.join(__dirname);

async function ensureMigrationsTable(client: any) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

function loadMigrations(): { id: number; name: string; file: string; sql: string }[] {
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort();

  return files.map((file) => {
    const match = file.match(/^(\d+)_(.+)\.sql$/)!;
    const id = parseInt(match[1], 10);
    const name = match[2];
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
    return { id, name, file, sql };
  });
}

async function getAppliedIds(client: any): Promise<Set<number>> {
  const res = await client.query('SELECT id FROM _migrations ORDER BY id');
  return new Set(res.rows.map((r: any) => r.id));
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const showStatus = args.includes('--status');

  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const migrations = loadMigrations();
    const applied = await getAppliedIds(client);

    if (showStatus) {
      console.log('Migration Status');
      console.log('═══════════════════════════════════════');
      for (const m of migrations) {
        const status = applied.has(m.id) ? '✓ applied' : '  pending';
        console.log(`  ${String(m.id).padStart(3, ' ')}  ${m.name}  ${status}`);
      }
      console.log(`\nTotal: ${migrations.length} | Applied: ${applied.size} | Pending: ${migrations.length - applied.size}`);
      return;
    }

    const pending = migrations.filter((m) => !applied.has(m.id));
    if (pending.length === 0) {
      console.log('All migrations applied ✓');
      return;
    }

    if (dryRun) {
      console.log('Would apply:');
      for (const m of pending) {
        console.log(`  ${m.id} ${m.name}`);
      }
      return;
    }

    for (const m of pending) {
      process.stdout.write(`Applying ${m.id} ${m.name}... `);
      await client.query('BEGIN');
      try {
        await client.query(m.sql);
        await client.query(
          'INSERT INTO _migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
          [m.id, m.name]
        );
        await client.query('COMMIT');
        console.log('✓');
      } catch (err) {
        await client.query('ROLLBACK');
        console.log('✗');
        console.error(`  Error: ${(err as Error).message}`);
        process.exit(1);
      }
    }

    console.log(`\n${pending.length} migration(s) applied successfully ✓`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
