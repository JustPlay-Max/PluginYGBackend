import type { IncomingMessage, ServerResponse } from 'node:http';

export type PaymentProductType = 'consumable' | 'nonConsumable' | 'subscription';

export interface BackendConfig {
  version?: string;
  port?: number;
  publicBaseUrl?: string;
  apiPrefix?: string;
  catalogLanguage?: string;
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
}

export interface PaymentProduct {
  id: string;
  type?: PaymentProductType;
  title?: string;
  description?: string;
  imageURI?: string;
  reward?: Record<string, unknown>;
  providers?: Record<string, ProviderProductConfig>;
}

export interface ProviderProductConfig {
  enabled?: boolean;
  item?: string;
  sku?: string;
  price?: string;
  priceValue?: string | number;
  priceVotes?: number;
  priceOK?: number;
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
