import { createServer } from 'node:http';
import { readRequestBody, sendJson, sendOptions } from '../shared/http.js';
import type { BackendConfig, BackendModule } from '../shared/types.js';

export function createNodeServer({ config, modules }: { config: BackendConfig; modules: BackendModule[] }) {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);

      if (req.method === 'OPTIONS') {
        sendOptions(res);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/health') {
        accessLog(config, req.method || 'GET', url.pathname);
        sendJson(res, 200, health(config, modules));
        return;
      }

      const context = {
        config,
        req,
        res,
        url,
        body: null,
        readBody: async () => {
          if (context.body === null) {
            context.body = await readRequestBody(req);
          }

          return context.body;
        }
      };

      for (const module of modules) {
        const handled = await module.route(context);
        if (handled) {
          accessLog(config, req.method || '', url.pathname + url.search);
          return;
        }
      }

      accessLog(config, req.method || '', url.pathname + url.search);
      sendJson(res, 404, { success: false, message: 'not_found' });
    } catch (error) {
      console.error(error);
      sendJson(res, 500, { success: false, message: 'internal_error' });
    }
  });
}

function accessLog(config: BackendConfig, method: string, path: string) {
  if (config.logging?.access === false) return;
  console.log(`${new Date().toISOString()} ${method} ${path}`);
}

function health(config: BackendConfig, modules: BackendModule[]) {
  return {
    name: 'PluginYG Backend',
    version: config.version || '0.2.0',
    api: ['v1'],
    modules: modules.map(module => module.name),
    providers: Object.entries(config.providers || {})
      .filter(([, value]) => value && value.enabled)
      .map(([key]) => key)
  };
}
