import { Database } from 'bun:sqlite';
import fs from 'fs';

const db = new Database('./data/returns.db');
const sql = fs.readFileSync('./db/auth-schema.sql', 'utf8');
db.exec(sql);

const tables = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'user_%' OR name LIKE 'otp_%' OR name LIKE 'oauth_%' OR name='claude_memory' OR name='auth_audit_log' OR name LIKE 'claude_memory_%') ORDER BY name"
).all();
console.log('Auth + memory tables:');
for (const t of tables as { name: string }[]) console.log('  ' + t.name);
db.close();
