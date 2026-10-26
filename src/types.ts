export interface OrderItem {
  item: {
    id: string;
    title: string;
  };
  quantity: number;
  unit_price: number;
  sale_fee: number;
}

export interface Buyer {
  id: number;
  nickname: string;
  first_name?: string;
  last_name?: string;
}

export interface MercadoLivreOrder {
  id: string;
  status: string;
  date_created: string;
  date_closed?: string;
  total_amount: number;
  paid_amount?: number;
  currency_id: string;
  buyer: Buyer;
  order_items: OrderItem[];
  shipping?: {
    id: number;
  };
}

export interface InvoiceData {
  orderId: string;
  date: string;
  currency: string;
  totalAmount: number;
  buyerName: string;
  buyerNickname: string;
  items: {
    title: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
  }[];
}
