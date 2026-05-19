import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BackendConfig } from './types.js';

export const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function loadConfig(): Promise<BackendConfig> {
  const configPath = resolve(rootDir, 'config.json');
  const fallbackConfigPath = resolve(rootDir, 'config.example.json');
  const path = existsSync(configPath) ? configPath : fallbackConfigPath;
  const config = JSON.parse(await readFile(path, 'utf8'));

  return {
    version: '0.2.0',
    apiPrefix: '/api/v1',
    ...config,
    publicBaseUrl: process.env.PUBLIC_BASE_URL || config.publicBaseUrl,
    assets: {
      ...(config.assets || {}),
      publicBaseUrl: process.env.PUBLIC_BASE_URL || config.assets?.publicBaseUrl || config.publicBaseUrl
    }
  };
}
