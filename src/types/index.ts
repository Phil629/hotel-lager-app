export interface Note {
  id: string;
  text: string;
  showOnOrderCreation: boolean;
  showOnOpenOrders: boolean;
}

export interface Supplier {
  id: string;
  name: string;
  contactName?: string;
  email: string;
  phone?: string;
  url?: string;
  notes?: Note[];
  emailSubjectTemplate?: string;
  emailBodyTemplate?: string;
  loginUrl?: string; // Optional login portal URL
  loginUsername?: string; // Optional username
  loginPassword?: string; // Optional password
  documents?: { name: string; url: string; date?: string; }[];
}

export interface Product {
  id: string;
  name: string;
  category?: string;
  stock: number;
  minStock?: number;
  price?: number; // Net price
  unit: string;
  orderUrl?: string; // Legacy: Keep for backward compatibility or direct URL orders
  image?: string;
  supplierId?: string; // Link to Supplier
  autoOrder?: boolean;
  notes?: Note[];
  preferredOrderMethod?: 'email' | 'link' | 'phone';
  productNumber?: string; // e.g. EAN or internal sku
  consumptionAmount?: number;
  consumptionPeriod?: 'day' | 'week';
  lastConsumptionDate?: string;
  standardOrderQuantity?: number; // Replaces targetStock: Always order exactly this amount
  ignoreOrderProposals?: boolean; // Exclude from order proposals
  lastCountedAt?: string;

  // Legacy fields (will be deprecated in favor of Supplier relation, but kept for now)
  emailOrderAddress?: string;
  emailOrderSubject?: string;
  emailOrderBody?: string;
  supplierPhone?: string;
}

export interface Order {
  id: string;
  date: string; // ISO string
  productName: string;
  quantity: number;
  status: 'open' | 'received';
  productImage?: string;
  hasDefect?: boolean;
  defectNotes?: string;
  defectReportedAt?: string; // ISO string
  defectResolved?: boolean; // New: Track if defect is resolved
  expectedDeliveryDate?: string; // ISO string
  trackingLink?: string; // New: Tracking URL
  supplierName?: string; // New: Supplier name for one-time orders
  orderNumber?: string; // New: Order number for tracking
  price?: number; // New: Price of the order
  supplierEmail?: string; // Cached from product for easy access
  supplierPhone?: string; // Cached from product for easy access
  receivedAt?: string; // ISO string, timestamp when order was marked as received
  notes?: string; // New: Notes for the order
}

export interface AppSettings {
  serviceId: string; // Deprecated
  templateId: string; // Deprecated
  publicKey: string; // Deprecated
  supabaseUrl?: string; // Hidden developer option
  supabaseKey?: string; // Hidden developer option
  enableStockManagement?: boolean;
  inventoryMode?: boolean; // New: Inventory Mode (pauses auto-consumption)
  
  // SaaS & Personalization Settings
  hotelName?: string;
  logoUrl?: string;
  currency?: string; // 'EUR', 'CHF', etc.
  currentPlan?: 'basic' | 'standard' | 'pro';
  developerMode?: boolean; // Toggle to show advanced settings
  preferredEmailClient?: 'all' | 'mailto' | 'gmail';
}
