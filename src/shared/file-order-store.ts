import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { rootDir } from './config.js';
import type { BackendConfig, OrderStore } from './types.js';

export function createFileOrderStore(config: BackendConfig): OrderStore {
  const dataPath = resolve(rootDir, config.storage?.ordersPath || 'data/orders.json');

  return {
    async list() {
      await ensureDirectory(dataPath);
      if (!existsSync(dataPath)) return [];
      return JSON.parse(await readFile(dataPath, 'utf8'));
    },

    async save(orders) {
      await ensureDirectory(dataPath);
      await writeFile(dataPath, JSON.stringify(orders, null, 2), 'utf8');
    }
  };
}

async function ensureDirectory(path) {
  await mkdir(dirname(path), { recursive: true });
}
