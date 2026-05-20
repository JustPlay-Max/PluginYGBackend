import { createHmac, timingSafeEqual } from 'node:crypto';
import { localizedCurrencyTitle, productPrice, providerProduct } from './registry.js';

export function createYandexProvider(id, providerConfig) {
  return {
    id,
    currencyCode: 'YAN',
    startStatus: 'pending',

    startOrder({ product, order }) {
      const provider = providerProduct(product, id);
      return {
        providerProductId: provider?.item || provider?.sku || product.id,
        message: order.orderId
      };
    },

    async verifyOrder({ product, order, body, orders }) {
      const parsed = verifySignature(body.receipt || body.signature || '', providerConfig.secretKey || '');
      if (!parsed.success) {
        return {
          success: false,
          message: parsed.message
        };
      }

      const purchase = findPurchase(parsed.data, product, id);
      if (!purchase) {
        return {
          success: false,
          message: 'product_not_found'
        };
      }

      const token = purchase.token || purchase.purchaseToken || '';
      if (!token) {
        return {
          success: false,
          message: 'purchase_token_missing'
        };
      }

      const duplicate = (orders || []).find(item =>
        item.provider === id &&
        item.providerTransactionId === token &&
        item.orderId !== order.orderId &&
        item.status === 'consumed');

      if (duplicate) {
        return {
          success: false,
          providerTransactionId: token,
          message: 'purchase_already_consumed'
        };
      }

      return {
        success: true,
        providerTransactionId: token,
        purchaseToken: token,
        message: ''
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

function verifySignature(signature, secretKey) {
  if (!signature || !secretKey) {
    return {
      success: false,
      message: 'signature_or_secret_missing'
    };
  }

  const parts = signature.split('.');
  if (parts.length !== 2) {
    return {
      success: false,
      message: 'signature_format_invalid'
    };
  }

  const [sign, payload] = parts;
  let dataString = '';
  try {
    dataString = Buffer.from(payload, 'base64').toString('utf8');
  } catch {
    return {
      success: false,
      message: 'signature_payload_invalid'
    };
  }

  const expected = createHmac('sha256', secretKey).update(dataString).digest('base64');

  if (!safeEquals(sign, expected)) {
    return {
      success: false,
      message: 'signature_invalid'
    };
  }

  return {
    success: true,
    data: safeJsonParse(dataString)
  };
}

function findPurchase(data, product, platform) {
  const purchases = Array.isArray(data?.data) ? data.data : [data?.data];
  const provider = providerProduct(product, platform);
  const productIds = [product.id, provider?.item, provider?.sku].filter(Boolean);

  return purchases.find(item => {
    const productId = item?.product?.id || item?.productID || item?.productId || '';
    return productIds.includes(productId);
  });
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function safeEquals(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function priceWithCurrency(value, currencyTitle) {
  return currencyTitle ? `${value} ${currencyTitle}` : String(value);
}
