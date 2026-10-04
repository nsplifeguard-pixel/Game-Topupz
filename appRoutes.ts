import { Router, type Request, type Response } from "express";
import { execute, query } from "./db";
import { clearAdminSession, createAdminSession, getAdmin, isRateLimited, recordLoginAttempt, requireAdmin, requireCsrf, revokeAllSessions, revokeSession, verifyPassword, hashPassword, type AdminRequest } from "./auth";
import { getSyncStatus, runCatalogSync } from "./crawler";

export const appApi = Router();
appApi.use(requireCsrf);

const publicDescription = (value: unknown) => String(value ?? "ข้อมูลสินค้าจากแคตตาล็อกต้นทาง")
  .replace(/สั่งซื้อ|ชำระเงิน|เติมเกม|เติมเงิน/g, "ดูรายละเอียด")
  .replace(/\s{2,}/g, " ")
  .slice(0, 320);

const publicProduct = (row: any) => ({
  id: row.id,
  gameId: row.game_id,
  gameName: row.game_name,
  gameSlug: row.game_slug,
  productName: row.name,
  description: publicDescription(row.description),
  sellingPrice: Number(row.selling_price),
  productImage: row.image_url,
  thumbnail: row.thumbnail_url,
  productType: row.product_type,
  category: row.category,
  status: row.status,
  sourceUrl: undefined,
});

function paging(req: Request) {
  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = Math.min(48, Math.max(1, Number(req.query.limit ?? 24)));
  return { page, limit, offset: (page - 1) * limit };
}

appApi.get("/health", async (_req, res) => {
  try { await query("SELECT 1 AS ok"); res.json({ status: "ok", database: true }); }
  catch { res.status(503).json({ status: "degraded", database: false }); }
});

appApi.get("/games", async (req, res) => {
  const { page, limit, offset } = paging(req);
  const q = String(req.query.q ?? "").trim();
  const category = String(req.query.category ?? "").trim();
  const like = `%${q}%`;
  const rows = await query<any[]>(`SELECT g.id, g.slug, g.name, g.category, g.description, COALESCE(g.image_url, MIN(p.image_url), g.banner_url) AS image_url, g.banner_url, g.status, g.last_updated,
      COUNT(p.id) AS product_count
    FROM games g LEFT JOIN products p ON p.game_id=g.id AND p.status='ACTIVE'
    WHERE g.status='ACTIVE' AND (? = '' OR g.name LIKE ? OR g.slug LIKE ?) AND (? = '' OR g.category = ?)
    GROUP BY g.id ORDER BY g.last_updated DESC LIMIT ? OFFSET ?`, [q, like, like, category, category, limit, offset]);
  const totalRows = await query<any[]>(`SELECT COUNT(*) AS total FROM games WHERE status='ACTIVE' AND (?='' OR name LIKE ? OR slug LIKE ?) AND (?='' OR category=?)`, [q, like, like, category, category]);
  res.json({ data: rows.map((row: any) => ({ id: row.id, slug: row.slug, name: row.name, category: row.category, description: row.description, imageUrl: row.image_url, bannerUrl: row.banner_url, productCount: Number(row.product_count), status: row.status, lastUpdated: row.last_updated })), page, limit, total: Number(totalRows[0]?.total ?? 0) });
});

appApi.get("/games/:slug", async (req, res) => {
  const gameRows = await query<any[]>("SELECT g.id, g.slug, g.name, g.category, g.description, COALESCE(g.image_url, (SELECT MIN(p.image_url) FROM products p WHERE p.game_id=g.id), g.banner_url) AS image_url, g.banner_url, g.source_url, g.status, g.last_updated FROM games g WHERE g.slug=? LIMIT 1", [req.params.slug]);
  if (!gameRows[0]) return res.status(404).json({ error: "GAME_NOT_FOUND" });
  const game = gameRows[0];
  const products = await query<any[]>(`SELECT p.*, g.name AS game_name, g.slug AS game_slug FROM products p JOIN games g ON g.id=p.game_id WHERE p.game_id=? AND p.status='ACTIVE' ORDER BY p.selling_price ASC`, [game.id]);
  return res.json({ game: { id: game.id, slug: game.slug, name: game.name, category: game.category, description: game.description, imageUrl: game.image_url, bannerUrl: game.banner_url, status: game.status, lastUpdated: game.last_updated }, products: products.map(publicProduct) });
});

appApi.get("/products", async (req, res) => {
  const { page, limit, offset } = paging(req);
  const q = String(req.query.q ?? "").trim();
  const gameSlug = String(req.query.gameSlug ?? "").trim();
  const category = String(req.query.category ?? "").trim();
  const sort = String(req.query.sort ?? "recommended");
  const order = sort === "price_asc" ? "p.selling_price ASC" : sort === "price_desc" ? "p.selling_price DESC" : sort === "new" ? "p.updated_at DESC" : "p.selling_price ASC";
  const like = `%${q}%`;
  const rows = await query<any[]>(`SELECT p.*, g.name AS game_name, g.slug AS game_slug FROM products p JOIN games g ON g.id=p.game_id
    WHERE p.status='ACTIVE' AND (?='' OR p.name LIKE ? OR p.description LIKE ? OR g.name LIKE ? OR p.product_type LIKE ?) AND (?='' OR g.slug=?) AND (?='' OR p.category=?)
    ORDER BY ${order} LIMIT ? OFFSET ?`, [q, like, like, like, like, gameSlug, gameSlug, category, category, limit, offset]);
  const totalRows = await query<any[]>(`SELECT COUNT(*) AS total FROM products p JOIN games g ON g.id=p.game_id WHERE p.status='ACTIVE' AND (?='' OR p.name LIKE ? OR p.description LIKE ? OR g.name LIKE ? OR p.product_type LIKE ?) AND (?='' OR g.slug=?) AND (?='' OR p.category=?)`, [q, like, like, like, like, gameSlug, gameSlug, category, category]);
  res.json({ data: rows.map(publicProduct), page, limit, total: Number(totalRows[0]?.total ?? 0) });
});

appApi.get("/products/:id", async (req, res) => {
  const rows = await query<any[]>("SELECT p.*, g.name AS game_name, g.slug AS game_slug FROM products p JOIN games g ON g.id=p.game_id WHERE p.id=? AND p.status='ACTIVE' LIMIT 1", [Number(req.params.id)]);
  if (!rows[0]) return res.status(404).json({ error: "PRODUCT_NOT_FOUND" });
  res.json(publicProduct(rows[0]));
});
appApi.get("/products/:id/offers", async (req, res) => {
  const productId = Number(req.params.id);
  const products = await query<any[]>("SELECT id, selling_price, source_url FROM products WHERE id=? AND status='ACTIVE' LIMIT 1", [productId]);
  if (!products[0]) return res.status(404).json({ error: "PRODUCT_NOT_FOUND" });
  const rows = await query<any[]>("SELECT id, store_name, price, currency, url, availability, last_checked_at FROM product_offers WHERE product_id=? ORDER BY price ASC", [productId]);
  const offers = rows.map((row: any) => ({ id: row.id, storeName: row.store_name, price: Number(row.price), currency: row.currency, url: row.url, availability: row.availability, lastCheckedAt: row.last_checked_at }));
  if (!offers.length) offers.push({ id: 0, storeName: "Game Topup", price: Number(products[0].selling_price), currency: "THB", url: products[0].source_url, availability: "IN_STOCK", lastCheckedAt: null });
  res.json({ data: offers });
});

appApi.get("/search", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (q.length < 2) return res.json({ games: [], products: [] });
  const like = `%${q}%`;
  const games = await query<any[]>("SELECT slug, name, category, image_url FROM games WHERE status='ACTIVE' AND (name LIKE ? OR slug LIKE ?) ORDER BY name LIMIT 8", [like, like]);
  const products = await query<any[]>("SELECT p.id, p.name, p.selling_price, p.image_url, p.product_type, g.name AS game_name, g.slug AS game_slug FROM products p JOIN games g ON g.id=p.game_id WHERE p.status='ACTIVE' AND (p.name LIKE ? OR p.description LIKE ? OR g.name LIKE ? OR p.product_type LIKE ?) ORDER BY p.updated_at DESC LIMIT 12", [like, like, like, like]);
  res.json({ games: games.map((g: any) => ({ slug: g.slug, name: g.name, category: g.category, imageUrl: g.image_url })), products: products.map(publicProduct) });
});

appApi.all("/orders", (_req, res) => res.status(404).json({ error: "PRICE_CHECKER_ONLY", message: "ระบบนี้ใช้สำหรับเช็คราคาเท่านั้น ไม่มีการสั่งซื้อหรือชำระเงิน" }));

appApi.post("/admin/login", async (req, res) => {
  const username = String(req.body?.username ?? "").trim();
  const password = String(req.body?.password ?? "");
  const ip = req.ip;
  if (!username || !password) return res.status(400).json({ error: "CREDENTIALS_REQUIRED" });
  if (await isRateLimited(username, ip)) return res.status(429).json({ error: "TOO_MANY_ATTEMPTS" });
  const rows = await query<any[]>("SELECT id, username, email, password_hash, password_salt, must_change_password, is_active FROM admins WHERE username=? OR email=? LIMIT 1", [username, username]);
  const admin = rows[0];
  const valid = admin && admin.is_active && verifyPassword(password, admin.password_hash, admin.password_salt);
  await recordLoginAttempt(username, ip, Boolean(valid));
  if (!valid) return res.status(401).json({ error: "INVALID_CREDENTIALS" });
  await execute("UPDATE admins SET last_login_at=NOW() WHERE id=?", [admin.id]);
  await createAdminSession(res, admin.id);
  res.json({ admin: { id: admin.id, username: admin.username, mustChangePassword: Boolean(admin.must_change_password) } });
});

appApi.post("/admin/logout", requireAdmin, async (req, res) => { await revokeSession(req); clearAdminSession(res); res.json({ ok: true }); });
appApi.get("/admin/me", requireAdmin, (req: AdminRequest, res) => res.json({ admin: { id: req.admin!.id, username: req.admin!.username, email: req.admin!.email, mustChangePassword: Boolean(req.admin!.must_change_password) } }));

appApi.get("/admin/dashboard", requireAdmin, async (_req, res) => {
  const [games, products, active, out, categories, lastSync, latest] = await Promise.all([
    query<any[]>("SELECT COUNT(*) AS value FROM games"), query<any[]>("SELECT COUNT(*) AS value FROM products"), query<any[]>("SELECT COUNT(*) AS value FROM products WHERE status='ACTIVE'"), query<any[]>("SELECT COUNT(*) AS value FROM products WHERE status='OUT_OF_STOCK'"), query<any[]>("SELECT COUNT(DISTINCT category) AS value FROM games"), query<any[]>("SELECT * FROM sync_logs ORDER BY id DESC LIMIT 1"), query<any[]>("SELECT * FROM sync_logs ORDER BY id DESC LIMIT 10"),
  ]);
  res.json({ stats: { games: Number(games[0]?.value ?? 0), products: Number(products[0]?.value ?? 0), activeProducts: Number(active[0]?.value ?? 0), outOfStock: Number(out[0]?.value ?? 0), categories: Number(categories[0]?.value ?? 0) }, lastSync: lastSync[0] ?? null, logs: latest });
});

appApi.get("/admin/games", requireAdmin, async (_req, res) => {
  const rows = await query<any[]>(`SELECT g.*, COUNT(p.id) AS product_count FROM games g LEFT JOIN products p ON p.game_id=g.id GROUP BY g.id ORDER BY g.last_updated DESC`);
  res.json({ data: rows.map((g: any) => ({ ...g, productCount: Number(g.product_count) })) });
});

appApi.get("/admin/categories", requireAdmin, async (_req, res) => {
  const rows = await query<any[]>(`SELECT c.id, c.slug, c.name, c.created_at, c.updated_at,
    (SELECT COUNT(*) FROM products p WHERE p.category = c.name) AS product_count
    FROM categories c ORDER BY c.name ASC`);
  res.json({ data: rows });
});
appApi.post("/admin/categories", requireAdmin, async (req, res) => {
  const name = String(req.body?.name ?? "").trim().slice(0, 160);
  const slug = String(req.body?.slug ?? name).trim().toLowerCase().replace(/[^a-z0-9ก-๙]+/g, "-").replace(/^-|-$/g, "").slice(0, 120);
  if (!name || !slug) return res.status(400).json({ error: "CATEGORY_NAME_REQUIRED" });
  try {
    await execute("INSERT INTO categories (slug, name) VALUES (?, ?)", [slug, name]);
    res.status(201).json({ category: { slug, name } });
  } catch (error: any) {
    if (error?.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "CATEGORY_ALREADY_EXISTS" });
    throw error;
  }
});
appApi.patch("/admin/categories/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const name = String(req.body?.name ?? "").trim().slice(0, 160);
  if (!Number.isInteger(id) || id < 1 || !name) return res.status(400).json({ error: "CATEGORY_NAME_REQUIRED" });
  const existing = await query<any[]>("SELECT name FROM categories WHERE id=? LIMIT 1", [id]);
  if (!existing[0]) return res.status(404).json({ error: "CATEGORY_NOT_FOUND" });
  await execute("UPDATE categories SET name=?, updated_at=NOW() WHERE id=?", [name, id]);
  await execute("UPDATE products SET category=? WHERE category=?", [name, existing[0].name]);
  res.json({ ok: true });
});
appApi.delete("/admin/categories/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const existing = await query<any[]>("SELECT name FROM categories WHERE id=? LIMIT 1", [id]);
  if (!existing[0]) return res.status(404).json({ error: "CATEGORY_NOT_FOUND" });
  const usage = await query<any[]>("SELECT COUNT(*) AS count FROM products WHERE category=?", [existing[0].name]);
  if (Number(usage[0]?.count ?? 0) > 0) return res.status(409).json({ error: "CATEGORY_IN_USE" });
  await execute("DELETE FROM categories WHERE id=?", [id]);
  res.json({ ok: true });
});
appApi.get("/admin/products", requireAdmin, async (req, res) => {
  const { page, limit, offset } = paging(req);
  const queryText = String(req.query.q ?? "").trim();
  const q = `%${queryText}%`;
  const category = String(req.query.category ?? "").trim();
  const status = String(req.query.status ?? "").trim();
  const filters = `(? = '' OR p.name LIKE ? OR g.name LIKE ?) AND (? = '' OR p.category = ?) AND (? = '' OR p.status = ?)`;
  const rows = await query<any[]>(`SELECT p.*, g.name AS game_name, g.slug AS game_slug FROM products p JOIN games g ON g.id=p.game_id WHERE ${filters} ORDER BY p.updated_at DESC LIMIT ? OFFSET ?`, [queryText, q, q, category, category, status, status, limit, offset]);
  const total = await query<any[]>(`SELECT COUNT(*) AS value FROM products p JOIN games g ON g.id=p.game_id WHERE ${filters}`, [queryText, q, q, category, category, status, status]);
  res.json({ data: rows, page, limit, total: Number(total[0]?.value ?? 0) });
});
appApi.patch("/admin/products/:id", requireAdmin, async (req, res) => {
  const productId = Number(req.params.id);
  const rows = await query<any[]>("SELECT p.*, g.name AS game_name FROM products p JOIN games g ON g.id=p.game_id WHERE p.id=? LIMIT 1", [productId]);
  const current = rows[0];
  if (!current) return res.status(404).json({ error: "PRODUCT_NOT_FOUND" });
  const sourcePrice = Number(req.body?.sourcePrice);
  const sellingPrice = Number(req.body?.sellingPrice);
  if (!Number.isFinite(sourcePrice) || sourcePrice < 0 || !Number.isFinite(sellingPrice) || sellingPrice < 0) return res.status(400).json({ error: "INVALID_PRICE" });
  const status = req.body?.status === "OUT_OF_STOCK" ? "OUT_OF_STOCK" : "ACTIVE";
  const name = String(req.body?.name ?? current.name).trim().slice(0, 255);
  const category = String(req.body?.category ?? current.category).trim().slice(0, 120);
  const description = String(req.body?.description ?? current.description ?? "").slice(0, 2000);
  if (!name || !category) return res.status(400).json({ error: "NAME_AND_CATEGORY_REQUIRED" });
  await execute("UPDATE products SET name=?, category=?, description=?, source_price=?, selling_price=?, status=?, updated_at=NOW() WHERE id=?", [name, category, description, sourcePrice, sellingPrice, status, productId]);
  if (Number(current.source_price) !== sourcePrice || Number(current.selling_price) !== sellingPrice) {
    await execute("INSERT INTO price_history (product_id, old_source_price, new_source_price, old_selling_price, new_selling_price, margin_percent) VALUES (?, ?, ?, ?, ?, ?)", [productId, current.source_price, sourcePrice, current.selling_price, sellingPrice, current.margin_percent]);
  }
  const updated = await query<any[]>("SELECT p.*, g.name AS game_name, g.slug AS game_slug FROM products p JOIN games g ON g.id=p.game_id WHERE p.id=? LIMIT 1", [productId]);
  res.json({ product: updated[0] });
});
appApi.get("/admin/products/:id/offers", requireAdmin, async (req, res) => {
  const rows = await query<any[]>("SELECT id, product_id, store_name, price, currency, url, availability, last_checked_at FROM product_offers WHERE product_id=? ORDER BY price ASC", [Number(req.params.id)]);
  res.json({ data: rows });
});
appApi.post("/admin/products/:id/offers", requireAdmin, async (req, res) => {
  const productId = Number(req.params.id);
  const storeName = String(req.body?.storeName ?? "").trim().slice(0, 120);
  const price = Number(req.body?.price);
  const currency = String(req.body?.currency ?? "THB").trim().slice(0, 8).toUpperCase() || "THB";
  const url = String(req.body?.url ?? "").trim().slice(0, 2000);
  const availability = req.body?.availability === "OUT_OF_STOCK" ? "OUT_OF_STOCK" : "IN_STOCK";
  if (!storeName || !Number.isFinite(price) || price < 0 || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: "INVALID_OFFER" });
  const product = await query<any[]>("SELECT id FROM products WHERE id=? LIMIT 1", [productId]);
  if (!product[0]) return res.status(404).json({ error: "PRODUCT_NOT_FOUND" });
  await execute(`INSERT INTO product_offers (product_id, store_name, price, currency, url, availability, last_checked_at)
    VALUES (?, ?, ?, ?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE price=VALUES(price), currency=VALUES(currency), url=VALUES(url), availability=VALUES(availability), last_checked_at=NOW()`, [productId, storeName, price, currency, url, availability]);
  res.status(201).json({ ok: true });
});
appApi.delete("/admin/products/:productId/offers/:offerId", requireAdmin, async (req, res) => {
  await execute("DELETE FROM product_offers WHERE id=? AND product_id=?", [Number(req.params.offerId), Number(req.params.productId)]);
  res.json({ ok: true });
});

appApi.get("/admin/pricing", requireAdmin, async (_req, res) => {
  const rows = await query<any[]>("SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('margin_percent','rounding_mode','currency','timezone')");
  res.json({ settings: Object.fromEntries(rows.map((row: any) => [row.setting_key, row.setting_value])) });
});

appApi.put("/admin/settings", requireAdmin, async (req, res) => {
  const allowed = ["margin_percent", "rounding_mode", "currency", "timezone", "store_name", "tagline", "maintenance_mode"];
  for (const key of allowed) if (req.body?.[key] !== undefined) await execute("INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)", [key, String(req.body[key]).slice(0, 255)]);
  if (req.body?.margin_percent !== undefined) {
    const margin = Math.min(100, Math.max(0, Number(req.body.margin_percent)));
    await execute("UPDATE products SET margin_percent=?, selling_price=ROUND(source_price * (1 + ? / 100), 2)", [margin, margin]);
  }
  const rows = await query<any[]>("SELECT setting_key, setting_value FROM settings");
  res.json({ settings: Object.fromEntries(rows.map((row: any) => [row.setting_key, row.setting_value])) });
});

appApi.post("/admin/sync", requireAdmin, async (_req, res) => {
  if (getSyncStatus()?.status === "RUNNING") return res.status(409).json({ error: "SYNC_ALREADY_RUNNING" });
  void runCatalogSync().catch(error => console.error("[Sync]", error));
  res.status(202).json({ status: "RUNNING" });
});
appApi.get("/admin/sync-status", requireAdmin, async (_req, res) => { const rows = await query<any[]>("SELECT * FROM sync_logs ORDER BY id DESC LIMIT 20"); res.json({ current: getSyncStatus(), logs: rows }); });
appApi.get("/admin/price-history", requireAdmin, async (_req, res) => { const rows = await query<any[]>(`SELECT h.*, p.name AS product_name, g.name AS game_name FROM price_history h JOIN products p ON p.id=h.product_id JOIN games g ON g.id=p.game_id ORDER BY h.changed_at DESC LIMIT 200`); res.json({ data: rows }); });
appApi.get("/admin/settings", requireAdmin, async (_req, res) => { const rows = await query<any[]>("SELECT setting_key, setting_value FROM settings ORDER BY setting_key"); res.json({ settings: Object.fromEntries(rows.map((row: any) => [row.setting_key, row.setting_value])) }); });
appApi.post("/admin/account/password", requireAdmin, async (req: AdminRequest, res) => {
  const current = String(req.body?.currentPassword ?? ""); const next = String(req.body?.newPassword ?? "");
  if (next.length < 8) return res.status(400).json({ error: "PASSWORD_TOO_SHORT" });
  const rows = await query<any[]>("SELECT password_hash, password_salt FROM admins WHERE id=? LIMIT 1", [req.admin!.id]);
  if (!rows[0] || !verifyPassword(current, rows[0].password_hash, rows[0].password_salt)) return res.status(401).json({ error: "INVALID_CURRENT_PASSWORD" });
  const hashed = hashPassword(next);
  await execute("UPDATE admins SET password_hash=?, password_salt=?, must_change_password=0 WHERE id=?", [hashed.hash, hashed.salt, req.admin!.id]);
  await revokeAllSessions(req.admin!.id); clearAdminSession(res); res.json({ ok: true, requiresLogin: true });
});
appApi.post("/admin/account/logout-all", requireAdmin, async (req: AdminRequest, res) => { await revokeAllSessions(req.admin!.id); clearAdminSession(res); res.json({ ok: true }); });

appApi.post("/scheduled/sync", async (req, res) => {
  if (process.env.NODE_ENV === "production" && !req.headers.cookie?.includes("app_session_id=")) return res.status(401).json({ error: "SCHEDULE_AUTH_REQUIRED" });
  if (getSyncStatus()?.status === "RUNNING") return res.status(202).json({ status: "ALREADY_RUNNING" });
  void runCatalogSync().catch(error => console.error("[Scheduled sync]", error));
  res.status(202).json({ status: "ACCEPTED" });
});
