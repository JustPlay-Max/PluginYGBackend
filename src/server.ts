import { createNodeServer } from './runtime/node-server.js';
import { loadConfig } from './shared/config.js';
import { createFileOrderStore } from './shared/file-order-store.js';
import { createAssetsModule } from './modules/assets/index.js';
import { createPaymentsModule } from './modules/payments/index.js';
import type { BackendModule } from './shared/types.js';

const config = await loadConfig();
const orderStore = createFileOrderStore(config);
const modules: BackendModule[] = [
  createAssetsModule(config),
  createPaymentsModule({
    config,
    orderStore
  })
];

const server = createNodeServer({
  config,
  modules
});

const port = Number(process.env.PORT) || config.port || 8080;
server.listen(port, () => {
  console.log(`PluginYG Backend v${config.version || '0.2.0'} listening on ${port}`);
});
