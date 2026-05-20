import { sendJson } from '../../../shared/http.js';
import { resolveAssetUrl } from '../../assets/index.js';
import { localizedCurrencyTitle, productPrice, providerProduct } from './registry.js';

export function createVkBridgeProvider(id, providerConfig) {
  return {
    id,
    currencyCode: 'votes',
    startStatus: 'pending',
    routes: [
      {
        method: 'GET',
        path: '/providers/vkbridge/callback',
        handle: vkCallback
      },
      {
        method: 'POST',
        path: '/providers/vkbridge/callback',
        handle: vkCallback
      }
    ],

    startOrder({ product }) {
      const provider = providerProduct(product, id);
      return {
        providerProductId: provider?.item || product.id
      };
    },

    priceText(product, language = '') {
      const provider = providerProduct(product, id);
      return priceWithCurrency(productPrice(provider, product), localizedCurrencyTitle(provider, product, language));
    },

    priceValue(product) {
      return String(productPrice(providerProduct(product, id), product));
    },

    confirmationResponse: providerConfig.confirmationResponse || 'ok'
  };
}

async function vkCallback({ context, config, orderStore, provider }) {
  const params = await callbackParams(context);
  const notificationType = params.notification_type || params.type || '';

  if (notificationType === 'get_item' || notificationType === 'get_item_test') {
    const product = productByProviderId(config, 'vkbridge', params.item || params.item_id || params.productId);
    if (!product) {
      sendJson(context.res, 200, {
        error: {
          error_code: 20,
          error_msg: 'Product not found',
          critical: true
        }
      });
      return;
    }

    const providerData = providerProduct(product, 'vkbridge');
    sendJson(context.res, 200, {
      response: {
        item_id: providerData.item || product.id,
        title: product.title || product.id,
        photo_url: resolveAssetUrl(config, product.imageURI),
        price: Number(productPrice(providerData, product) || 1)
      }
    });
    return;
  }

  if (notificationType === 'order_status_change' || notificationType === 'order_status_change_test') {
    const product = productByProviderId(config, 'vkbridge', params.item || params.item_id || params.productId);
    const vkOrderId = String(params.order_id || '');
    const orders = await orderStore.list();
    const order = orders
      .slice()
      .reverse()
      .find(item =>
        item.provider === 'vkbridge' &&
        (!product || item.productId === product.id) &&
        (!params.user_id || item.userId === String(params.user_id) || !item.userId) &&
        (item.status === 'pending' || (vkOrderId && item.providerTransactionId === vkOrderId)));

    if (!order) {
      sendJson(context.res, 200, {
        error: {
          error_code: 100,
          error_msg: 'Order not found',
          critical: true
        }
      });
      return;
    }

    if (params.status === 'chargeable') {
      if (order.status === 'pending') {
        order.status = 'paid';
      }

      order.providerTransactionId = vkOrderId;
      order.updatedAt = new Date().toISOString();
      await orderStore.save(orders);

      sendJson(context.res, 200, {
        response: {
          order_id: Number(vkOrderId || 0),
          app_order_id: appOrderId(order.orderId)
        }
      });
      return;
    }

    if (order.status !== 'consumed') {
      order.status = params.status === 'paid' ? 'paid' : 'failed';
    }

    order.providerTransactionId = vkOrderId;
    order.updatedAt = new Date().toISOString();
    await orderStore.save(orders);

    sendJson(context.res, 200, { response: provider.confirmationResponse });
    return;
  }

  sendJson(context.res, 200, { response: provider.confirmationResponse });
}

async function callbackParams(context): Promise<Record<string, any>> {
  const result: Record<string, any> = {};

  context.url.searchParams.forEach((value, key) => {
    result[key] = value;
  });

  if (context.req.method === 'POST') {
    const body = await context.readBody();
    Object.assign(result, body);
  }

  return result;
}

function productByProviderId(config, platform, providerId) {
  return (config.products || []).find(product => {
    const provider = providerProduct(product, platform);
    return provider && (provider.item === providerId || provider.sku === providerId || product.id === providerId);
  });
}

function appOrderId(orderId) {
  let hash = 0;
  const value = String(orderId || '');

  for (let i = 0; i < value.length; i++) {
    hash = ((hash * 31) + value.charCodeAt(i)) >>> 0;
  }

  return hash || 1;
}

function priceWithCurrency(value, currencyTitle) {
  return currencyTitle ? `${value} ${currencyTitle}` : String(value || '');
}
