import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'fs';
import { dirname, isAbsolute, join } from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..');
const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

export class DatabaseService {
    constructor() {
        this.db = null;
        this.filePath = null;
    }

    get isInitialized() {
        return Boolean(this.db?.open);
    }

    initialize(filePath = './data/discord-supporter.db') {
        if (this.isInitialized) return this.db;

        this.filePath = filePath === ':memory:'
            ? filePath
            : (isAbsolute(filePath) ? filePath : join(PROJECT_ROOT, filePath));

        if (this.filePath !== ':memory:') {
            const dataDir = dirname(this.filePath);
            if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
        }

        this.db = new Database(this.filePath, { timeout: 5000 });
        this.db.pragma('foreign_keys = ON');
        this.db.pragma('busy_timeout = 5000');
        if (this.filePath !== ':memory:') this.db.pragma('journal_mode = WAL');
        this.runMigrations();

        logger.info(`SQLiteを初期化しました: ${this.filePath}`);
        return this.db;
    }

    runMigrations() {
        this.assertInitialized();
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version TEXT PRIMARY KEY,
                applied_at TEXT NOT NULL
            )
        `);

        const applied = new Set(
            this.db.prepare('SELECT version FROM schema_migrations').all().map(row => row.version)
        );
        const files = readdirSync(MIGRATIONS_DIR)
            .filter(name => name.endsWith('.sql'))
            .sort();
        const insertMigration = this.db.prepare(
            'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)'
        );

        for (const file of files) {
            if (applied.has(file)) continue;
            const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
            this.db.transaction(() => {
                this.db.exec(sql);
                insertMigration.run(file, new Date().toISOString());
            })();
            logger.info(`DBマイグレーションを適用しました: ${file}`);
        }
    }

    connection() {
        this.assertInitialized();
        return this.db;
    }

    transaction(fn) {
        this.assertInitialized();
        return this.db.transaction(fn);
    }

    close() {
        if (!this.isInitialized) return;
        this.db.close();
        this.db = null;
        logger.info('SQLiteを終了しました');
    }

    assertInitialized() {
        if (!this.db) throw new Error('SQLiteが初期化されていません');
    }
}

export default new DatabaseService();

