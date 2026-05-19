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
        sendCatalog(res, config, providers, url.searchParams.get('platform') || '');
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

      if (req.method === 'POST' && url.pathname === `${prefix}/orders/consume`) {
        await consumeOrder(context, orderStore);
        return true;
      }

      if (req.method === 'GET' && url.pathname === `${prefix}/orders/status`) {
        await orderStatus(res, url, orderStore);
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

function sendCatalog(res, config, providers, platform) {
  const products = enabledProducts(config, providers, platform);

  sendJson(res, 200, {
    id: products.map(product => product.id),
    title: products.map(product => product.title || product.id),
    description: products.map(product => product.description || ''),
    imageURI: products.map(product => resolveAssetUrl(config, product.imageURI)),
    price: products.map(product => providers.priceText(product, platform)),
    priceValue: products.map(product => providers.priceValue(product, platform)),
    priceCurrencyCode: products.map(() => providers.priceCurrencyCode(platform)),
    currencyImageURL: products.map(() => ''),
    consumed: products.map(product => product.type !== 'nonConsumable' && product.type !== 'subscription'),
    language: config.catalogLanguage || 'en'
  });
}

async function startOrder(context, config, orderStore, providers) {
  const body = await context.readBody();
  const product = productById(config, body.productId);
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
    title: response.title || product.title || product.id,
    description: response.description || product.description || '',
    price: response.price || '',
    priceValue: response.priceValue || 0,
    immediateSuccess: response.immediateSuccess === true,
    message: response.message || ''
  });
}

async function verifyOrder(context, config, orderStore, providers) {
  const body = await context.readBody();
  const product = productById(config, body.productId);
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

  const result = await provider.verifyOrder({
    config,
    product,
    order,
    body
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
    message: result.message || ''
  });
}

async function consumeOrder(context, orderStore) {
  const body = await context.readBody();
  const orders = await orderStore.list();
  const order = findOrder(orders, {
    orderId: body.orderId,
    provider: body.platform,
    productId: body.productId,
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

async function orderStatus(res, url, orderStore) {
  const orders = await orderStore.list();
  const order = findOrder(orders, {
    orderId: url.searchParams.get('orderId') || '',
    provider: url.searchParams.get('platform') || '',
    productId: url.searchParams.get('productId') || '',
    userId: url.searchParams.get('userId') || ''
  });

  if (!order) {
    sendJson(res, 200, {
      success: false,
      status: 'not_found',
      productId: url.searchParams.get('productId') || ''
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
  const orders = await orderStore.list();
  const pending = orders.filter(order =>
    order.provider === platform &&
    (!userId || order.userId === userId) &&
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

function productById(config, id) {
  return (config.products || []).find(product => product.id === id);
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
