import { readdir, readFile } from 'node:fs/promises';
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
  const products = normalizeProducts(config, await loadProducts(config.productsPath, config.products || []));

  return {
    version: '0.2.0',
    apiPrefix: '/api/v1',
    ...config,
    products,
    publicBaseUrl: process.env.PUBLIC_BASE_URL || config.publicBaseUrl,
    assets: {
      ...(config.assets || {}),
      publicBaseUrl: process.env.PUBLIC_BASE_URL || config.assets?.publicBaseUrl || config.publicBaseUrl
    }
  };
}

function normalizeProducts(config: BackendConfig, products: any[]) {
  return products.map(product => {
    const normalized = {
      currencyTitle: config.currencyTitle,
      currencyTitleRU: config.currencyTitleRU,
      currencyImageURI: config.currencyImageURI,
      ...product,
      providers: {
        ...(product.providers || {})
      }
    };

    for (const [platform, providerConfig] of Object.entries(config.providers || {})) {
      if (!providerConfig || providerConfig.enabled === false) continue;

      const productProvider = normalized.providers[platform] || {};
      normalized.providers[platform] = {
        currencyTitle: providerConfig.currencyTitle,
        currencyTitleRU: providerConfig.currencyTitleRU,
        currencyImageURI: providerConfig.currencyImageURI,
        ...productProvider
      };
    }

    return normalized;
  });
}

async function loadProducts(productsPath: string | undefined, inlineProducts: any[]) {
  if (!productsPath) {
    return inlineProducts;
  }

  const directory = resolve(rootDir, productsPath);
  if (!existsSync(directory)) {
    return inlineProducts;
  }

  const files = (await readdir(directory, { withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const products = [];
  for (const file of files) {
    const product = JSON.parse(await readFile(resolve(directory, file), 'utf8'));
    products.push(product);
  }

  return [...inlineProducts, ...products];
}
