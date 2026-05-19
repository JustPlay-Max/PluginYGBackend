import { createCrazyGamesProvider } from './crazygames.js';
import { createOkProvider } from './ok.js';
import { createVkBridgeProvider } from './vkbridge.js';
import type { BackendConfig, PaymentProduct, ProviderConfig, ProviderProductConfig } from '../../../shared/types.js';

const factories = {
  crazygames: createCrazyGamesProvider,
  ok: createOkProvider,
  vkbridge: createVkBridgeProvider
};

type ProviderFactory = (id: string, providerConfig: ProviderConfig) => PaymentProvider;

interface PaymentProvider {
  id: string;
  currencyCode: string;
  startStatus: string;
  routes?: Array<{
    method: string;
    path: string;
    handle: Function;
  }>;
  startOrder(args: any): any;
  verifyOrder?: (args: any) => Promise<any>;
  priceText(product: PaymentProduct): string;
  priceValue(product: PaymentProduct): string;
}

export function createProviderRegistry(config: BackendConfig) {
  const providers = new Map<string, PaymentProvider>();

  for (const [id, providerConfig] of Object.entries(config.providers || {})) {
    if (!providerConfig || providerConfig.enabled === false) continue;

    const factory = (factories as Record<string, ProviderFactory>)[id] || createGenericProvider;
    providers.set(id, factory(id, providerConfig));
  }

  return {
    get: (id: string) => providers.get(id),

    routeFor(method: string, pathname: string, prefix: string) {
      for (const provider of providers.values()) {
        const route = provider.routes?.find(item =>
          item.method === method &&
          pathname === `${prefix}${item.path}`);

        if (route) {
          return {
            provider,
            handle: route.handle
          };
        }
      }

      return null;
    },

    providerProduct(product: PaymentProduct, platform: string): ProviderProductConfig | null {
      if (!platform) return null;
      const provider = product.providers?.[platform];
      return provider && provider.enabled !== false ? provider : null;
    },

    priceText(product: PaymentProduct, platform: string) {
      const provider = providers.get(platform);
      return provider?.priceText?.(product) || '';
    },

    priceValue(product: PaymentProduct, platform: string) {
      const provider = providers.get(platform);
      return provider?.priceValue?.(product) || '';
    },

    priceCurrencyCode(platform: string) {
      const provider = providers.get(platform);
      return provider?.currencyCode || '';
    }
  };
}

function createGenericProvider(id: string): PaymentProvider {
  return {
    id,
    currencyCode: '',
    startStatus: 'created',

    startOrder({ product }) {
      return {
        providerProductId: providerProduct(product, id)?.sku || providerProduct(product, id)?.item || product.id
      };
    },

    priceText(product) {
      const provider = providerProduct(product, id);
      return provider?.price || '';
    },

    priceValue(product) {
      const provider = providerProduct(product, id);
      return String(provider?.priceValue || provider?.price || '');
    }
  };
}

export function providerProduct(product: PaymentProduct, platform: string): ProviderProductConfig | null {
  if (!platform) return null;
  const provider = product.providers?.[platform];
  return provider && provider.enabled !== false ? provider : null;
}
