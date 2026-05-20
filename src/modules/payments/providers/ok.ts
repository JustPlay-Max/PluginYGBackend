import { createHash } from 'node:crypto';
import { sendJson } from '../../../shared/http.js';
import { localizedCurrencyTitle, productPrice, providerProduct } from './registry.js';

export function createOkProvider(id, providerConfig) {
  return {
    id,
    currencyCode: 'ok',
    startStatus: 'pending',
    routes: [
      {
        method: 'GET',
        path: '/providers/ok/callback',
        handle: okCallback
      }
    ],

    startOrder({ product, order, body }) {
      const provider = providerProduct(product, id);
      const priceValue = Number(productPrice(provider, product) || 0);
      const language = body.language || '';
      return {
        providerProductId: provider?.item || product.id,
        title: localizedText(product.title, product.titleRU, language) || product.id,
        description: localizedText(product.description, product.descriptionRU, language),
        price: priceWithCurrency(priceValue, localizedCurrencyTitle(provider, product, language)),
        priceValue,
        paymentToken: createProductHash(providerConfig, provider?.item || product.id, priceValue),
        message: order.orderId
      };
    },

    priceText(product, language = '') {
      const provider = providerProduct(product, id);
      return priceWithCurrency(productPrice(provider, product), localizedCurrencyTitle(provider, product, language));
    },

    priceValue(product) {
      const provider = providerProduct(product, id);
      return String(productPrice(provider, product));
    },

    secretKey: providerConfig.secretKey || ''
  };
}

async function okCallback({ context, config, orderStore, provider }) {
  const params = context.url.searchParams;
  const productCode = params.get('product_code') || '';
  const amount = Number(params.get('amount') || 0);
  const uid = params.get('uid') || '';
  const transactionId = params.get('transaction_id') || '';
  const extraAttributes = parseAttributes(params.get('extra_attributes') || '');
  const product = productByProviderId(config, 'ok', productCode);

  if (!product) {
    sendOkError(context.res, 1001, 'CALLBACK_INVALID_PAYMENT : Product not found');
    return;
  }

  const providerData = providerProduct(product, 'ok');
  const expectedAmount = Number(productPrice(providerData, product) || 0);
  if (amount !== expectedAmount) {
    sendOkError(context.res, 1001, 'CALLBACK_INVALID_PAYMENT : Invalid payment amount');
    return;
  }

  if (provider.secretKey && !isValidSignature(params, provider.secretKey)) {
    sendOkError(context.res, 104, 'PARAM_SIGNATURE : Invalid signature');
    return;
  }

  const orders = await orderStore.list();
  let order = orders.find(item => item.providerTransactionId === transactionId && transactionId);

  if (!order) {
    order = orders
      .slice()
      .reverse()
      .find(item =>
        item.provider === 'ok' &&
        item.productId === product.id &&
        (!extraAttributes.orderId || item.orderId === extraAttributes.orderId) &&
        (!uid || item.userId === uid || !item.userId) &&
        item.status === 'pending');
  }

  if (!order) {
    order = {
      orderId: extraAttributes.orderId || transactionId || `${Date.now()}`,
      provider: 'ok',
      productId: product.id,
      productType: product.type || 'consumable',
      userId: uid,
      status: 'paid',
      providerToken: '',
      providerTransactionId: transactionId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    orders.push(order);
  } else {
    if (order.status !== 'consumed') {
      order.status = 'paid';
    }

    order.userId = order.userId || uid;
    order.providerTransactionId = transactionId || order.providerTransactionId || '';
    order.updatedAt = new Date().toISOString();
  }

  await orderStore.save(orders);
  sendJson(context.res, 200, true);
}

function createProductHash(providerConfig, code, price) {
  if (!providerConfig.productHashSecret) return '';
  return createHash('sha256')
    .update(`${code}:${price}:${providerConfig.productHashSecret}`, 'utf8')
    .digest('hex');
}

function isValidSignature(params, secretKey) {
  const sig = params.get('sig') || '';
  const pairs = [];
  params.forEach((value, key) => {
    if (key !== 'sig') {
      pairs.push(`${key}=${value}`);
    }
  });
  pairs.sort();

  const hash = createHash('md5')
    .update(pairs.join('') + secretKey, 'utf8')
    .digest('hex');

  return hash === sig;
}

function sendOkError(res, code, message) {
  sendJson(res, 200, {
    error_code: code,
    error_msg: message,
    error_data: null
  });
}

function parseAttributes(value) {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function productByProviderId(config, platform, providerId) {
  return (config.products || []).find(product => {
    const provider = providerProduct(product, platform);
    return provider && (provider.item === providerId || provider.sku === providerId || product.id === providerId);
  });
}

function priceWithCurrency(value, currencyTitle) {
  return currencyTitle ? `${value} ${currencyTitle}` : String(value || '');
}

function localizedText(value = '', valueRU = '', language = '') {
  if (language.toLowerCase().startsWith('ru') && valueRU) {
    return valueRU;
  }

  return value || '';
}
