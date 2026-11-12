import { loadConfig } from '../config.ts';
import { openDb } from '../db.ts';
import { buildApp } from './app.ts';

const config = loadConfig(process.env);
const app = buildApp({ db: openDb(config.dbPath), config });
await app.listen({ host: '0.0.0.0', port: config.port });
console.log(`singgah api listening on :${config.port}`);
