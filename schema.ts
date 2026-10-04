import { decimal, int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const admins = mysqlTable("admins", {
  id: int("id").autoincrement().primaryKey(),
  username: varchar("username", { length: 80 }).notNull().unique(),
  email: varchar("email", { length: 320 }),
  passwordHash: varchar("password_hash", { length: 128 }).notNull(),
  passwordSalt: varchar("password_salt", { length: 64 }).notNull(),
  mustChangePassword: int("must_change_password").default(1).notNull(),
  isActive: int("is_active").default(1).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  lastLoginAt: timestamp("last_login_at"),
});

export const adminSessions = mysqlTable("admin_sessions", {
  id: int("id").autoincrement().primaryKey(),
  adminId: int("admin_id").notNull(),
  tokenHash: varchar("token_hash", { length: 128 }).notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const categories = mysqlTable("categories", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 120 }).notNull().unique(),
  name: varchar("name", { length: 160 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export const games = mysqlTable("games", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  category: varchar("category", { length: 120 }).notNull(),
  description: text("description"),
  imageUrl: text("image_url"),
  bannerUrl: text("banner_url"),
  sourceUrl: text("source_url").notNull(),
  status: varchar("status", { length: 32 }).default("ACTIVE").notNull(),
  lastUpdated: timestamp("last_updated").defaultNow().notNull(),
});

export const products = mysqlTable("products", {
  id: int("id").autoincrement().primaryKey(),
  gameId: int("game_id").notNull(),
  category: varchar("category", { length: 120 }).notNull(),
  productKey: varchar("product_key", { length: 255 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  sourcePrice: decimal("source_price", { precision: 12, scale: 2 }).notNull(),
  sellingPrice: decimal("selling_price", { precision: 12, scale: 2 }).notNull(),
  marginPercent: decimal("margin_percent", { precision: 6, scale: 2 }).notNull(),
  productType: varchar("product_type", { length: 40 }).default("OTHER").notNull(),
  imageUrl: text("image_url"),
  thumbnailUrl: text("thumbnail_url"),
  sourceUrl: text("source_url").notNull(),
  status: varchar("status", { length: 32 }).default("ACTIVE").notNull(),
  lastSyncAt: timestamp("last_sync_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export const productOffers = mysqlTable("product_offers", {
  id: int("id").autoincrement().primaryKey(),
  productId: int("product_id").notNull(),
  storeName: varchar("store_name", { length: 120 }).notNull(),
  price: decimal("price", { precision: 12, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 8 }).default("THB").notNull(),
  url: text("url").notNull(),
  availability: varchar("availability", { length: 32 }).default("IN_STOCK").notNull(),
  lastCheckedAt: timestamp("last_checked_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export const productImages = mysqlTable("product_images", {
  id: int("id").autoincrement().primaryKey(),
  productId: int("product_id").notNull(),
  url: text("url").notNull(),
  imageType: varchar("image_type", { length: 40 }).default("product").notNull(),
  status: varchar("status", { length: 32 }).default("VALID").notNull(),
  errorMessage: text("error_message"),
  sourceUrl: text("source_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const priceHistory = mysqlTable("price_history", {
  id: int("id").autoincrement().primaryKey(),
  productId: int("product_id").notNull(),
  oldSourcePrice: decimal("old_source_price", { precision: 12, scale: 2 }),
  newSourcePrice: decimal("new_source_price", { precision: 12, scale: 2 }).notNull(),
  oldSellingPrice: decimal("old_selling_price", { precision: 12, scale: 2 }),
  newSellingPrice: decimal("new_selling_price", { precision: 12, scale: 2 }).notNull(),
  marginPercent: decimal("margin_percent", { precision: 6, scale: 2 }).notNull(),
  changedAt: timestamp("changed_at").defaultNow().notNull(),
});

export const syncLogs = mysqlTable("sync_logs", {
  id: int("id").autoincrement().primaryKey(),
  status: varchar("status", { length: 24 }).notNull(),
  progress: varchar("progress", { length: 255 }),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  gamesFound: int("games_found").default(0).notNull(),
  productsFound: int("products_found").default(0).notNull(),
  newProducts: int("new_products").default(0).notNull(),
  updatedProducts: int("updated_products").default(0).notNull(),
  priceChanges: int("price_changes").default(0).notNull(),
  imagesUpdated: int("images_updated").default(0).notNull(),
  missingProducts: int("missing_products").default(0).notNull(),
  errorMessage: text("error_message"),
});

export const settings = mysqlTable("settings", {
  id: int("id").autoincrement().primaryKey(),
  settingKey: varchar("setting_key", { length: 120 }).notNull().unique(),
  settingValue: text("setting_value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export const orders = mysqlTable("orders", {
  id: int("id").autoincrement().primaryKey(),
  orderNumber: varchar("order_number", { length: 40 }).notNull().unique(),
  customerName: varchar("customer_name", { length: 160 }),
  customerEmail: varchar("customer_email", { length: 320 }),
  customerPhone: varchar("customer_phone", { length: 40 }),
  status: varchar("status", { length: 32 }).default("PENDING_PAYMENT").notNull(),
  paymentStatus: varchar("payment_status", { length: 32 }).default("UNPAID").notNull(),
  totalAmount: decimal("total_amount", { precision: 12, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 8 }).default("THB").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export const orderItems = mysqlTable("order_items", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("order_id").notNull(),
  productId: int("product_id").notNull(),
  gameName: varchar("game_name", { length: 255 }).notNull(),
  productName: varchar("product_name", { length: 255 }).notNull(),
  productType: varchar("product_type", { length: 40 }).notNull(),
  quantity: int("quantity").notNull(),
  unitPrice: decimal("unit_price", { precision: 12, scale: 2 }).notNull(),
  totalPrice: decimal("total_price", { precision: 12, scale: 2 }).notNull(),
});

export const orderInputs = mysqlTable("order_inputs", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("order_id").notNull(),
  orderItemId: int("order_item_id").notNull(),
  fieldKey: varchar("field_key", { length: 80 }).notNull(),
  fieldValue: text("field_value").notNull(),
});

export const loginAttempts = mysqlTable("login_attempts", {
  id: int("id").autoincrement().primaryKey(),
  username: varchar("username", { length: 160 }).notNull(),
  ipAddress: varchar("ip_address", { length: 80 }),
  success: int("success").default(0).notNull(),
  attemptedAt: timestamp("attempted_at").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
