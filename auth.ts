import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { execute, query } from "./db";

export const ADMIN_COOKIE = "gametopup_admin_session";
export const CSRF_COOKIE = "gametopup_csrf";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

export type AdminRecord = {
  id: number;
  username: string;
  email: string | null;
  must_change_password: number;
  is_active: number;
};
export type AdminRequest = Request & { admin?: AdminRecord };

function parseCookieHeader(header: string) {
  return Object.fromEntries(header.split(";").map(part => {
    const index = part.indexOf("=");
    return index === -1 ? [part.trim(), ""] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([key]) => Boolean(key)));
}

function serializeCookie(name: string, value: string, options: { httpOnly?: boolean; secure?: boolean; sameSite?: string; path?: string; maxAge?: number; expires?: Date }) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite[0].toUpperCase()}${options.sameSite.slice(1)}`);
  return parts.join("; ");
}

export function hashPassword(password: string, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { hash, salt };
}

export function verifyPassword(password: string, hash: string, salt: string) {
  const candidate = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(hash, "hex"));
}

function hashToken(token: string) { return crypto.createHash("sha256").update(token).digest("hex"); }
function secureCookies() { return process.env.NODE_ENV === "production" || Boolean(process.env.MANUS_ADDON_PREVIEW_PUBLIC_ORIGIN); }
function cookieSameSite() { return secureCookies() ? "none" : "lax"; }

export async function createAdminSession(res: Response, adminId: number) {
  const token = crypto.randomBytes(32).toString("hex");
  const csrf = crypto.randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  await execute("INSERT INTO admin_sessions (admin_id, token_hash, expires_at) VALUES (?, ?, ?)", [adminId, hashToken(token), expiresAt]);
  // SameSite=None is only valid together with Secure. Local development uses HTTP,
  // so browsers silently discard the session cookie unless we use Lax there.
  const base = { httpOnly: true, secure: secureCookies(), sameSite: cookieSameSite(), path: "/", maxAge: SESSION_TTL_SECONDS };
  res.setHeader("Set-Cookie", [serializeCookie(ADMIN_COOKIE, token, base), serializeCookie(CSRF_COOKIE, csrf, { ...base, httpOnly: false })]);
}

export function clearAdminSession(res: Response) {
  const base = { secure: secureCookies(), sameSite: cookieSameSite(), path: "/", expires: new Date(0) };
  res.setHeader("Set-Cookie", [serializeCookie(ADMIN_COOKIE, "", { ...base, httpOnly: true }), serializeCookie(CSRF_COOKIE, "", { ...base, httpOnly: false })]);
}

export async function getAdmin(req: Request): Promise<AdminRecord | null> {
  const cookies = parseCookieHeader(req.headers.cookie ?? "");
  const token = cookies[ADMIN_COOKIE] || (req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : "");
  if (!token) return null;
  const rows = await query<AdminRecord[]>(`SELECT a.id, a.username, a.email, a.must_change_password, a.is_active
    FROM admins a JOIN admin_sessions s ON s.admin_id = a.id
    WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > NOW() AND a.is_active = 1 LIMIT 1`, [hashToken(token)]);
  return rows[0] ?? null;
}

export async function requireAdmin(req: AdminRequest, res: Response, next: NextFunction) {
  const admin = await getAdmin(req);
  if (!admin) return res.status(401).json({ error: "ADMIN_AUTH_REQUIRED" });
  req.admin = admin;
  return next();
}

export function requireCsrf(req: AdminRequest, res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.path === "/admin/login" || req.path === "/login" || req.path === "/orders" || req.path === "/scheduled/sync") return next();
  const cookies = parseCookieHeader(req.headers.cookie ?? "");
  const header = req.headers["x-csrf-token"];
  const token = Array.isArray(header) ? header[0] : header;
  if (!token || !cookies[CSRF_COOKIE] || token !== cookies[CSRF_COOKIE]) return res.status(403).json({ error: "CSRF_FAILED" });
  return next();
}

export async function recordLoginAttempt(username: string, ip: string | undefined, success: boolean) {
  await execute("INSERT INTO login_attempts (username, ip_address, success) VALUES (?, ?, ?)", [username.slice(0, 160), ip?.slice(0, 80) ?? null, success ? 1 : 0]);
}
export async function isRateLimited(username: string, ip: string | undefined) {
  const rows = await query<{ attempts: number }[]>(`SELECT COUNT(*) AS attempts FROM login_attempts WHERE success = 0 AND attempted_at > DATE_SUB(NOW(), INTERVAL 15 MINUTE) AND (username = ? OR ip_address = ?)`, [username.slice(0, 160), ip?.slice(0, 80) ?? ""]);
  return Number(rows[0]?.attempts ?? 0) >= 10;
}
export async function revokeSession(req: Request) {
  const cookies = parseCookieHeader(req.headers.cookie ?? "");
  const token = cookies[ADMIN_COOKIE];
  if (token) await execute("UPDATE admin_sessions SET revoked_at = NOW() WHERE token_hash = ?", [hashToken(token)]);
}
export async function revokeAllSessions(adminId: number) { await execute("UPDATE admin_sessions SET revoked_at = NOW() WHERE admin_id = ? AND revoked_at IS NULL", [adminId]); }
