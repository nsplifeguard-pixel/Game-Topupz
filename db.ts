import mysql, { type Pool, type ResultSetHeader } from "mysql2/promise";
import { ENV } from "./_core/env";
import { users, type InsertUser } from "../drizzle/schema";
import { drizzle } from "drizzle-orm/mysql2";
import { eq } from "drizzle-orm";

let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

export function getPool() {
  if (!pool && ENV.databaseUrl) {
    pool = mysql.createPool({
      uri: ENV.databaseUrl,
      waitForConnections: true,
      connectionLimit: 8,
      queueLimit: 0,
      enableKeepAlive: true,
    });
  }
  return pool;
}

export async function query<T = any[]>(sql: string, params: unknown[] = []): Promise<T> {
  const db = getPool();
  if (!db) return [] as unknown as T;
  const [rows] = await db.query(sql, params);
  return rows as T;
}

export async function execute(sql: string, params: unknown[] = []) {
  const db = getPool();
  if (!db) throw new Error("Database is not available");
  const [result] = await db.execute<ResultSetHeader>(sql, params);
  return result;
}

export async function ensureSchema() {
  if (!schemaReady) schemaReady = ensureSchemaOnce();
  return schemaReady;
}

async function ensureSchemaOnce() {
  const db = getPool();
  if (!db) {
    console.warn("[Database] DATABASE_URL is not configured; app will run with empty catalog state");
    return;
  }
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (id INT AUTO_INCREMENT PRIMARY KEY, openId VARCHAR(64) NOT NULL UNIQUE, name TEXT NULL, email VARCHAR(320) NULL, loginMethod VARCHAR(64) NULL, role ENUM('user','admin') NOT NULL DEFAULT 'user', createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, lastSignedIn TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS admins (id INT AUTO_INCREMENT PRIMARY KEY, username VARCHAR(80) NOT NULL UNIQUE, email VARCHAR(320) NULL, password_hash VARCHAR(128) NOT NULL, password_salt VARCHAR(64) NOT NULL, must_change_password TINYINT NOT NULL DEFAULT 1, is_active TINYINT NOT NULL DEFAULT 1, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, last_login_at TIMESTAMP NULL)`,
    `CREATE TABLE IF NOT EXISTS admin_sessions (id INT AUTO_INCREMENT PRIMARY KEY, admin_id INT NOT NULL, token_hash VARCHAR(128) NOT NULL UNIQUE, expires_at TIMESTAMP NOT NULL, revoked_at TIMESTAMP NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_admin_sessions_admin (admin_id), INDEX idx_admin_sessions_expiry (expires_at))`,
    `CREATE TABLE IF NOT EXISTS categories (id INT AUTO_INCREMENT PRIMARY KEY, slug VARCHAR(120) NOT NULL UNIQUE, name VARCHAR(160) NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS games (id INT AUTO_INCREMENT PRIMARY KEY, slug VARCHAR(255) NOT NULL UNIQUE, name VARCHAR(255) NOT NULL, category VARCHAR(120) NOT NULL, description TEXT NULL, image_url TEXT NULL, banner_url TEXT NULL, source_url TEXT NOT NULL, status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE', last_updated TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_games_category (category), INDEX idx_games_status (status))`,
    `CREATE TABLE IF NOT EXISTS products (id INT AUTO_INCREMENT PRIMARY KEY, game_id INT NOT NULL, category VARCHAR(120) NOT NULL, product_key VARCHAR(255) NOT NULL, name VARCHAR(255) NOT NULL, description TEXT NULL, source_price DECIMAL(12,2) NOT NULL, selling_price DECIMAL(12,2) NOT NULL, margin_percent DECIMAL(6,2) NOT NULL, product_type VARCHAR(40) NOT NULL DEFAULT 'OTHER', image_url TEXT NULL, thumbnail_url TEXT NULL, source_url TEXT NOT NULL, status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE', last_sync_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, UNIQUE KEY uniq_game_product (game_id, product_key), INDEX idx_products_game (game_id), INDEX idx_products_status (status), INDEX idx_products_category (category))`,
    `CREATE TABLE IF NOT EXISTS product_offers (id INT AUTO_INCREMENT PRIMARY KEY, product_id INT NOT NULL, store_name VARCHAR(120) NOT NULL, price DECIMAL(12,2) NOT NULL, currency VARCHAR(8) NOT NULL DEFAULT 'THB', url TEXT NOT NULL, availability VARCHAR(32) NOT NULL DEFAULT 'IN_STOCK', last_checked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, UNIQUE KEY uniq_product_store (product_id, store_name), INDEX idx_product_offers_product (product_id), INDEX idx_product_offers_price (price))`,
    `CREATE TABLE IF NOT EXISTS product_images (id INT AUTO_INCREMENT PRIMARY KEY, product_id INT NOT NULL, url TEXT NOT NULL, image_type VARCHAR(40) NOT NULL DEFAULT 'product', status VARCHAR(32) NOT NULL DEFAULT 'VALID', error_message TEXT NULL, source_url TEXT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_product_images_product (product_id))`,
    `CREATE TABLE IF NOT EXISTS price_history (id INT AUTO_INCREMENT PRIMARY KEY, product_id INT NOT NULL, old_source_price DECIMAL(12,2) NULL, new_source_price DECIMAL(12,2) NOT NULL, old_selling_price DECIMAL(12,2) NULL, new_selling_price DECIMAL(12,2) NOT NULL, margin_percent DECIMAL(6,2) NOT NULL, changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_price_history_product (product_id), INDEX idx_price_history_changed (changed_at))`,
    `CREATE TABLE IF NOT EXISTS sync_logs (id INT AUTO_INCREMENT PRIMARY KEY, status VARCHAR(24) NOT NULL, progress VARCHAR(255) NULL, started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TIMESTAMP NULL, games_found INT NOT NULL DEFAULT 0, products_found INT NOT NULL DEFAULT 0, new_products INT NOT NULL DEFAULT 0, updated_products INT NOT NULL DEFAULT 0, price_changes INT NOT NULL DEFAULT 0, images_updated INT NOT NULL DEFAULT 0, missing_products INT NOT NULL DEFAULT 0, error_message TEXT NULL, INDEX idx_sync_logs_started (started_at))`,
    `CREATE TABLE IF NOT EXISTS settings (id INT AUTO_INCREMENT PRIMARY KEY, setting_key VARCHAR(120) NOT NULL UNIQUE, setting_value TEXT NOT NULL, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS orders (id INT AUTO_INCREMENT PRIMARY KEY, order_number VARCHAR(40) NOT NULL UNIQUE, customer_name VARCHAR(160) NULL, customer_email VARCHAR(320) NULL, customer_phone VARCHAR(40) NULL, status VARCHAR(32) NOT NULL DEFAULT 'PENDING_PAYMENT', payment_status VARCHAR(32) NOT NULL DEFAULT 'UNPAID', total_amount DECIMAL(12,2) NOT NULL, currency VARCHAR(8) NOT NULL DEFAULT 'THB', created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, INDEX idx_orders_status (status), INDEX idx_orders_created (created_at))`,
    `CREATE TABLE IF NOT EXISTS order_items (id INT AUTO_INCREMENT PRIMARY KEY, order_id INT NOT NULL, product_id INT NOT NULL, game_name VARCHAR(255) NOT NULL, product_name VARCHAR(255) NOT NULL, product_type VARCHAR(40) NOT NULL, quantity INT NOT NULL, unit_price DECIMAL(12,2) NOT NULL, total_price DECIMAL(12,2) NOT NULL, INDEX idx_order_items_order (order_id))`,
    `CREATE TABLE IF NOT EXISTS order_inputs (id INT AUTO_INCREMENT PRIMARY KEY, order_id INT NOT NULL, order_item_id INT NOT NULL, field_key VARCHAR(80) NOT NULL, field_value TEXT NOT NULL, INDEX idx_order_inputs_order (order_id))`,
    `CREATE TABLE IF NOT EXISTS login_attempts (id INT AUTO_INCREMENT PRIMARY KEY, username VARCHAR(160) NOT NULL, ip_address VARCHAR(80) NULL, success TINYINT NOT NULL DEFAULT 0, attempted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_login_attempts_user_time (username, attempted_at))`,
  ];
  for (const statement of statements) await db.query(statement);
  await execute(`INSERT IGNORE INTO settings (setting_key, setting_value) VALUES ('margin_percent','20'), ('rounding_mode','nearest'), ('currency','THB'), ('timezone','Asia/Bangkok'), ('store_name','Game Topup'), ('tagline','เช็คราคาเกมและสินค้าดิจิทัล'), ('source_url','https://www.overtopup.com/th'), ('maintenance_mode','0')`);
}

// Kept for compatibility with the starter's Manus OAuth helpers.
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.insert(users).values({ ...user, lastSignedIn: user.lastSignedIn ?? new Date() }).onDuplicateKeyUpdate({
    set: { name: user.name, email: user.email, loginMethod: user.loginMethod, role: user.role, lastSignedIn: new Date() },
  });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function getDb() {
  const db = getPool();
  return db ? drizzle(db) : null;
}
