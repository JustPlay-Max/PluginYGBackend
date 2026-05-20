import { sendJson } from '../../../shared/http.js';
import { localizedCurrencyTitle, productPrice, providerProduct } from './registry.js';

export function createCrazyGamesProvider(id, providerConfig) {
  return {
    id,
    currencyCode: 'XSOLLA',
    startStatus: 'created',
    routes: [
      {
        method: 'POST',
        path: '/providers/crazygames/xsolla-webhook',
        handle: xsollaWebhook
      }
    ],

    startOrder({ product, order, body }) {
      const provider = providerProduct(product, id);
      return {
        providerProductId: provider?.sku || product.id,
        paymentUrl: createPaymentUrl(provider, providerConfig, order, body.providerToken)
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

async function xsollaWebhook({ context, orderStore }) {
  const body = await context.readBody();
  const orderId = body.orderId || body.external_id || body.custom_parameters?.orderId || '';
  const orders = await orderStore.list();
  const order = orders.find(item => item.orderId === orderId);

  if (order) {
    order.status = body.notification_type === 'payment' || body.status === 'done' ? 'paid' : order.status;
    order.updatedAt = new Date().toISOString();
    await orderStore.save(orders);
  }

  sendJson(context.res, 200, { success: true });
}

function createPaymentUrl(provider, providerConfig, order, xsollaUserToken) {
  const template = provider?.paymentUrlTemplate || providerConfig.paymentUrlTemplate || '';
  return template
    .replaceAll('{orderId}', encodeURIComponent(order.orderId))
    .replaceAll('{productId}', encodeURIComponent(order.productId))
    .replaceAll('{xsollaUserToken}', encodeURIComponent(xsollaUserToken || order.providerToken || ''));
}

function priceWithCurrency(value, currencyTitle) {
  return currencyTitle ? `${value} ${currencyTitle}` : String(value);
}
