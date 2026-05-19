import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, normalize, resolve, sep } from 'node:path';
import { rootDir } from '../../shared/config.js';
import type { BackendConfig, BackendModule, RequestContext } from '../../shared/types.js';

export function createAssetsModule(config: BackendConfig): BackendModule {
  const assets = config.assets || {};
  const route = normalizeRoute(assets.imagesRoute || '/images');
  const root = resolve(rootDir, assets.imagesPath || 'public/images');

  return {
    name: 'assets',

    async route(context: RequestContext) {
      if (context.req.method !== 'GET') return false;
      if ((assets.mode || 'node-static') !== 'node-static') return false;
      if (!context.url.pathname.startsWith(route + '/')) return false;

      const relativePath = decodeURIComponent(context.url.pathname.slice(route.length + 1));
      const filePath = resolve(root, normalize(relativePath));

      if (!isInside(root, filePath)) {
        context.res.writeHead(403);
        context.res.end();
        return true;
      }

      try {
        const info = await stat(filePath);
        if (!info.isFile()) return false;

        context.res.writeHead(200, {
          'Content-Type': contentType(filePath),
          'Cache-Control': 'public, max-age=31536000, immutable',
          'Access-Control-Allow-Origin': '*',
          'Cross-Origin-Resource-Policy': 'cross-origin'
        });
        createReadStream(filePath).pipe(context.res);
        return true;
      } catch {
        return false;
      }
    }
  };
}

export function resolveAssetUrl(config: BackendConfig, value: string | undefined): string {
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;

  const assets = config.assets || {};
  if (assets.mode === 'disabled') return value;

  const route = normalizeRoute(assets.imagesRoute || '/images');
  const baseUrl = (assets.mode === 'external'
    ? assets.baseUrl
    : assets.publicBaseUrl || config.publicBaseUrl || '').replace(/\/$/, '');

  if (!baseUrl) return route + '/' + trimSlashes(value);
  return baseUrl + route + '/' + trimSlashes(value);
}

function normalizeRoute(value: string): string {
  const route = '/' + trimSlashes(value);
  return route === '/' ? '' : route;
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}

function isInside(root: string, filePath: string): boolean {
  return filePath === root || filePath.startsWith(root + sep);
}

function contentType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}
