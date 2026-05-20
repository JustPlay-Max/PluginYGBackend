import type { IncomingMessage, ServerResponse } from 'node:http';

export type PaymentProductType = 'consumable' | 'nonConsumable' | 'subscription';

export interface BackendConfig {
  version?: string;
  port?: number;
  publicBaseUrl?: string;
  apiPrefix?: string;
  productsPath?: string;
  currencyTitle?: string;
  currencyTitleRU?: string;
  currencyImageURI?: string;
  storage?: {
    ordersPath?: string;
  };
  logging?: {
    access?: boolean;
  };
  assets?: {
    mode?: 'node-static' | 'external' | 'disabled';
    publicBaseUrl?: string;
    baseUrl?: string;
    imagesPath?: string;
    imagesRoute?: string;
  };
  products?: PaymentProduct[];
  providers?: Record<string, ProviderConfig>;
}

export interface ProviderConfig {
  enabled?: boolean;
  confirmationResponse?: string;
  webhookSecret?: string;
  secretKey?: string;
  productHashSecret?: string;
  paymentUrlTemplate?: string;
  currencyTitle?: string;
  currencyTitleRU?: string;
  currencyImageURI?: string;
}

export interface PaymentProduct {
  id: string;
  type?: PaymentProductType;
  title?: string;
  titleRU?: string;
  description?: string;
  descriptionRU?: string;
  price?: string | number;
  imageURI?: string;
  currencyTitle?: string;
  currencyTitleRU?: string;
  currencyImageURI?: string;
  providers?: Record<string, ProviderProductConfig>;
}

export interface ProviderProductConfig {
  enabled?: boolean;
  item?: string;
  sku?: string;
  price?: string | number;
  currencyTitle?: string;
  currencyTitleRU?: string;
  currencyImageURI?: string;
  paymentUrlTemplate?: string;
}

export interface PaymentOrder {
  orderId: string;
  provider: string;
  productId: string;
  productType: PaymentProductType;
  userId: string;
  status: string;
  providerToken: string;
  providerTransactionId?: string;
  receiptHash?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrderStore {
  list(): Promise<PaymentOrder[]>;
  save(orders: PaymentOrder[]): Promise<void>;
}

export interface RequestContext {
  config: BackendConfig;
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  body: unknown | null;
  readBody(): Promise<Record<string, any>>;
}

export interface BackendModule {
  name: string;
  route(context: RequestContext): Promise<boolean>;
}
