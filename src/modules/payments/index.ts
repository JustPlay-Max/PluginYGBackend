import { randomUUID } from 'node:crypto';
import { sendJson } from '../../shared/http.js';
import { resolveAssetUrl } from '../assets/index.js';
import { createProviderRegistry } from './providers/registry.js';

export function createPaymentsModule({ config, orderStore }) {
  const providers = createProviderRegistry(config);

  return {
    name: 'payments',

    async route(context) {
      const prefix = config.apiPrefix || '/api/v1';
      const { req, res, url } = context;

      if (req.method === 'GET' && url.pathname === `${prefix}/products`) {
        sendCatalog(res, config, providers, url.searchParams.get('platform') || '', url.searchParams.get('language') || '');
        return true;
      }

      if (req.method === 'POST' && url.pathname === `${prefix}/orders/start`) {
        await startOrder(context, config, orderStore, providers);
        return true;
      }

      if (req.method === 'POST' && url.pathname === `${prefix}/orders/verify`) {
        await verifyOrder(context, config, orderStore, providers);
        return true;
      }

      if (req.method === 'POST' && url.pathname === `${prefix}/orders/restore`) {
        await restorePurchases(context, config, orderStore, providers);
        return true;
      }

      if (req.method === 'POST' && url.pathname === `${prefix}/orders/consume`) {
        await consumeOrder(context, config, orderStore);
        return true;
      }

      if (req.method === 'GET' && url.pathname === `${prefix}/orders/status`) {
        await orderStatus(res, url, config, orderStore);
        return true;
      }

      if (req.method === 'GET' && url.pathname === `${prefix}/orders/pending`) {
        await pendingOrders(res, url, orderStore);
        return true;
      }

      const providerRoute = providers.routeFor(req.method, url.pathname, prefix);
      if (providerRoute) {
        await providerRoute.handle({
          context,
          config,
          orderStore,
          provider: providerRoute.provider
        });
        return true;
      }

      return false;
    }
  };
}

function sendCatalog(res, config, providers, platform, language) {
  const products = enabledProducts(config, providers, platform);

  sendJson(res, 200, {
    id: products.map(product => product.id),
    title: products.map(product => localizedText(product.title, product.titleRU, language) || product.id),
    description: products.map(product => localizedText(product.description, product.descriptionRU, language)),
    imageURI: products.map(product => resolveAssetUrl(config, product.imageURI)),
    price: products.map(product => providers.priceText(product, platform, language)),
    priceValue: products.map(product => providers.priceValue(product, platform)),
    priceCurrencyCode: products.map(product => providers.priceCurrencyCode(product, platform, language)),
    currencyImageURL: products.map(product => resolveOptionalAssetUrl(config, providers.currencyImageURI(product, platform))),
    consumed: products.map(product => product.type !== 'nonConsumable' && product.type !== 'subscription'),
    language: language || ''
  });
}

async function startOrder(context, config, orderStore, providers) {
  const body = await context.readBody();
  const product = productById(config, body.productId, body.platform);
  const provider = providers.get(body.platform);

  if (!product || !provider || !providers.providerProduct(product, body.platform)) {
    sendJson(context.res, 404, { success: false, message: 'product_not_found' });
    return;
  }

  const order = createOrder({
    provider: body.platform,
    product,
    userId: body.userId,
    providerToken: body.providerToken,
    status: provider.startStatus || 'created'
  });

  const orders = await orderStore.list();
  orders.push(order);
  await orderStore.save(orders);

  const response = await provider.startOrder({
    config,
    product,
    order,
    body
  });

  sendJson(context.res, 200, {
    success: true,
    orderId: order.orderId,
    providerProductId: response.providerProductId,
    paymentUrl: response.paymentUrl || '',
    paymentToken: response.paymentToken || '',
    title: response.title || localizedText(product.title, product.titleRU, body.language) || product.id,
    description: response.description || localizedText(product.description, product.descriptionRU, body.language),
    price: response.price || '',
    priceValue: response.priceValue || 0,
    immediateSuccess: response.immediateSuccess === true,
    message: response.message || ''
  });
}

async function verifyOrder(context, config, orderStore, providers) {
  const body = await context.readBody();
  const product = productById(config, body.productId, body.platform);
  const provider = providers.get(body.platform);

  if (!product || !provider || !providers.providerProduct(product, body.platform)) {
    sendJson(context.res, 404, { success: false, status: 'not_found', message: 'product_not_found' });
    return;
  }

  if (!provider.verifyOrder) {
    sendJson(context.res, 400, { success: false, status: 'unsupported', productId: product.id, message: 'verify_not_supported' });
    return;
  }

  const orders = await orderStore.list();
  let order = findOrder(orders, {
    orderId: body.orderId,
    provider: body.platform,
    productId: product.id,
    userId: body.userId
  });

  if (!order) {
    order = createOrder({
      provider: body.platform,
      product,
      userId: body.userId,
      providerToken: body.providerToken,
      status: 'created'
    });
    orders.push(order);
  }

  if (order.status === 'consumed') {
    sendJson(context.res, 200, {
      success: false,
      status: 'consumed',
      productId: order.productId,
      orderId: order.orderId,
      providerTransactionId: order.providerTransactionId || '',
      purchaseToken: '',
      message: 'purchase_already_consumed'
    });
    return;
  }

  const result = await provider.verifyOrder({
    config,
    product,
    order,
    body,
    orders
  });

  order.status = result.success ? 'paid' : 'failed';
  order.providerTransactionId = result.providerTransactionId || body.providerTransactionId || order.providerTransactionId || '';
  order.receiptHash = result.receiptHash || '';
  order.updatedAt = new Date().toISOString();

  await orderStore.save(orders);

  sendJson(context.res, 200, {
    success: result.success === true,
    status: order.status,
    productId: order.productId,
    orderId: order.orderId,
    providerTransactionId: order.providerTransactionId || '',
    purchaseToken: result.purchaseToken || '',
    message: result.message || ''
  });
}

async function restorePurchases(context, config, orderStore, providers) {
  const body = await context.readBody();
  const provider = providers.get(body.platform);

  if (!provider?.restorePurchases) {
    sendJson(context.res, 400, {
      success: false,
      orderId: [],
      productId: [],
      purchaseToken: [],
      message: 'restore_not_supported'
    });
    return;
  }

  const orders = await orderStore.list();
  const result = await provider.restorePurchases({
    config,
    products: config.products || [],
    body,
    orders
  });

  if (!result.success) {
    sendJson(context.res, 200, {
      success: false,
      orderId: [],
      productId: [],
      purchaseToken: [],
      message: result.message || ''
    });
    return;
  }

  const restored = [];
  for (const purchase of result.purchases || []) {
    let order = orders.find(item =>
      item.provider === body.platform &&
      item.providerTransactionId === purchase.providerTransactionId);

    if (order?.status === 'consumed') {
      continue;
    }

    if (!order) {
      order = createOrder({
        provider: body.platform,
        product: purchase.product,
        userId: body.userId,
        providerToken: '',
        status: 'paid'
      });
      orders.push(order);
    }

    order.productId = purchase.productId;
    order.userId = order.userId || body.userId || '';
    order.status = 'paid';
    order.providerTransactionId = purchase.providerTransactionId || order.providerTransactionId || '';
    order.updatedAt = new Date().toISOString();

    restored.push({
      ...purchase,
      orderId: order.orderId
    });
  }

  if (restored.length > 0) {
    await orderStore.save(orders);
  }

  sendJson(context.res, 200, {
    success: true,
    orderId: restored.map(item => item.orderId || ''),
    productId: restored.map(item => item.productId),
    purchaseToken: restored.map(item => item.purchaseToken || ''),
    message: ''
  });
}

async function consumeOrder(context, config, orderStore) {
  const body = await context.readBody();
  const product = productById(config, body.productId, body.platform);
  const orders = await orderStore.list();
  const order = findOrder(orders, {
    orderId: body.orderId,
    provider: body.platform,
    productId: product?.id || body.productId,
    userId: body.userId
  });

  if (!order) {
    sendJson(context.res, 200, {
      success: false,
      status: 'not_found',
      productId: body.productId || ''
    });
    return;
  }

  if (order.status === 'paid' || order.status === 'granted') {
    order.status = 'consumed';
    order.updatedAt = new Date().toISOString();
    await orderStore.save(orders);
  }

  sendJson(context.res, 200, {
    success: order.status === 'consumed',
    status: order.status,
    productId: order.productId,
    orderId: order.orderId
  });
}

async function orderStatus(res, url, config, orderStore) {
  const platform = url.searchParams.get('platform') || '';
  const orderId = url.searchParams.get('orderId') || '';
  const productId = url.searchParams.get('productId') || '';
  const userId = url.searchParams.get('userId') || '';

  if (!platform || (!orderId && (!productId || !userId))) {
    sendJson(res, 200, {
      success: false,
      status: 'not_found',
      productId
    });
    return;
  }

  const product = productById(config, productId, platform);
  const orders = await orderStore.list();
  const order = findOrder(orders, {
    orderId,
    provider: platform,
    productId: product?.id || productId,
    userId
  });

  if (!order) {
    sendJson(res, 200, {
      success: false,
      status: 'not_found',
      productId
    });
    return;
  }

  sendJson(res, 200, {
    success: isPaid(order.status),
    status: order.status,
    productId: order.productId,
    orderId: order.orderId
  });
}

async function pendingOrders(res, url, orderStore) {
  const platform = url.searchParams.get('platform') || '';
  const userId = url.searchParams.get('userId') || '';

  if (!platform || !userId) {
    sendJson(res, 200, { productId: [] });
    return;
  }

  const orders = await orderStore.list();
  const pending = orders.filter(order =>
    order.provider === platform &&
    order.userId === userId &&
    (order.status === 'paid' || order.status === 'granted'));

  pending.forEach(order => {
    order.status = 'consumed';
    order.updatedAt = new Date().toISOString();
  });

  if (pending.length > 0) {
    await orderStore.save(orders);
  }

  sendJson(res, 200, {
    productId: pending.map(order => order.productId)
  });
}

function createOrder({ provider, product, userId, providerToken, status }) {
  return {
    orderId: randomUUID(),
    provider,
    productId: product.id,
    productType: product.type || 'consumable',
    userId: userId || '',
    status,
    providerToken: providerToken || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function enabledProducts(config, providers, platform) {
  return (config.products || []).filter(product => providers.providerProduct(product, platform));
}

function productById(config, id, platform = '') {
  return (config.products || []).find(product => {
    if (product.id === id) return true;
    const provider = productProvider(product, platform);
    return provider && (provider.item === id || provider.sku === id);
  });
}

function productProvider(product, platform) {
  if (!platform) return null;
  const provider = product.providers?.[platform];
  return provider && provider.enabled !== false ? provider : null;
}

function resolveOptionalAssetUrl(config, value) {
  return value ? resolveAssetUrl(config, value) : '';
}

function localizedText(value = '', valueRU = '', language = '') {
  if (language.toLowerCase().startsWith('ru') && valueRU) {
    return valueRU;
  }

  return value || '';
}

function findOrder(orders, query) {
  return orders
    .slice()
    .reverse()
    .find(order =>
      (!query.orderId || order.orderId === query.orderId) &&
      (!query.provider || order.provider === query.provider) &&
      (!query.productId || order.productId === query.productId) &&
      (!query.userId || order.userId === query.userId));
}

function isPaid(status) {
  return status === 'paid' || status === 'granted';
}
