import { createCrazyGamesProvider } from './crazygames.js';
import { createOkProvider } from './ok.js';
import { createVkBridgeProvider } from './vkbridge.js';
import { createYandexProvider } from './yandex.js';
import type { BackendConfig, PaymentProduct, ProviderConfig, ProviderProductConfig } from '../../../shared/types.js';

const factories = {
  crazygames: createCrazyGamesProvider,
  ok: createOkProvider,
  vkbridge: createVkBridgeProvider,
  yandex: createYandexProvider
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
  priceText(product: PaymentProduct, language?: string): string;
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
      if (!providers.has(platform)) return null;
      return providerProduct(product, platform);
    },

    priceText(product: PaymentProduct, platform: string, language = '') {
      const provider = providers.get(platform);
      return provider?.priceText?.(product, language) || '';
    },

    priceValue(product: PaymentProduct, platform: string) {
      const provider = providers.get(platform);
      return provider?.priceValue?.(product) || '';
    },

    priceCurrencyCode(product: PaymentProduct, platform: string, language = '') {
      const providerProductConfig = providerProduct(product, platform);
      return localizedCurrencyTitle(providerProductConfig, product, language);
    },

    currencyImageURI(product: PaymentProduct, platform: string) {
      const providerProductConfig = providerProduct(product, platform);
      return providerProductConfig?.currencyImageURI || product.currencyImageURI || '';
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

    priceText(product, language = '') {
      const provider = providerProduct(product, id);
      const value = productPrice(provider, product);
      const currencyTitle = localizedCurrencyTitle(provider, product, language);
      return value !== '' ? priceWithCurrency(value, currencyTitle) : '';
    },

    priceValue(product) {
      const provider = providerProduct(product, id);
      return String(productPrice(provider, product));
    }
  };
}

export function providerProduct(product: PaymentProduct, platform: string): ProviderProductConfig | null {
  if (!platform) return null;
  const provider = product.providers?.[platform];
  if (provider?.enabled === false) return null;
  return provider || {};
}

function priceWithCurrency(value: string | number, currencyTitle: string) {
  return currencyTitle ? `${value} ${currencyTitle}` : String(value);
}

export function localizedCurrencyTitle(provider: ProviderProductConfig | null, product: PaymentProduct, language = '') {
  if (isRussian(language)) {
    return provider?.currencyTitleRU || provider?.currencyTitle || product.currencyTitleRU || product.currencyTitle || '';
  }

  return provider?.currencyTitle || product.currencyTitle || '';
}

export function productPrice(provider: ProviderProductConfig | null, product: PaymentProduct) {
  return provider?.price ?? product.price ?? '';
}

function isRussian(language: string) {
  return language.toLowerCase().startsWith('ru');
}
