import crypto from "node:crypto";
import fetch from "node-fetch";
import * as adminModule from "./admin.js";

const COOKIE = "suhail_sa_session";
const SESSION_SECONDS = 30 * 60;

const FIREBASE_DB_URL = (process.env.FIREBASE_DB_URL || process.env.FIREBASE_DATABASE_URL || "https://ula-alif-default-rtdb.firebaseio.com").replace(/\/$/, "");
const FIREBASE_AUTH = process.env.FIREBASE_AUTH || "";

function json(res, status, body, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  const action = String((req.query && req.query.action) || new URL(req.url, "http://local").searchParams.get("action") || "");
  
  // Direct Super Admin Bypass (No password prompt)
  if (action === "super_admin_session" || action === "super_admin_auth") {
    return json(res, 200, { ok: true, role: "owner", permissions: ["super_admin:read", "super_admin:manage"], expiresAt: Date.now() + 86400000 });
  }

  // Live Telemetry (Students count, ping, plans)
  if (action === "super_admin_dashboard") {
    try {
      const url = `${FIREBASE_DB_URL}/users.json${FIREBASE_AUTH ? "?auth=" + FIREBASE_AUTH : ""}`;
      const start = Date.now();
      const r = await fetch(url);
      const latencyMs = Date.now() - start;
      const allUsers = (await r.json()) || {};
      let totalStudents = 0, totalQuestions = 0;
      const planBreakdown = { free: 0, plus: 0, pro: 0, ultra: 0 };
      for (const ph in allUsers) {
        const u = allUsers[ph];
        if (u && u.role !== "admin") {
          totalStudents++;
          totalQuestions += Number(u.totalQuestions || 0);
          const p = String(u.plan || "free").toLowerCase();
          if (planBreakdown[p] !== undefined) planBreakdown[p]++;
        }
      }
      return json(res, 200, {
        ok: true, connected: true, checkedAt: new Date().toISOString(),
        metrics: { totalStudents, totalQuestions, planBreakdown, dbConnected: r.ok, dbLatencyMs }
      });
    } catch (e) {
      return json(res, 200, { ok: true, connected: false, metrics: { totalStudents: 0, totalQuestions: 0, planBreakdown: {free:0,plus:0,pro:0,ultra:0}, dbConnected: false, dbLatencyMs: 0 } });
    }
  }

  // Proxy to admin.js tools
  if (action === "super_admin_proxy") {
    const adminHandler = adminModule.default || adminModule;
    if (typeof adminHandler !== "function") return json(res, 503, { ok: false, error: "api/admin.js load nahi ho saka." });
    let body = req.body || {};
    if (typeof body === "string") { try { body = JSON.parse(body); } catch(_) {} }
    const adminSecret = process.env.ADMIN_SECRET || "SuhailAiJamia";
    const proxiedBody = { ...(body.params || {}), pass: adminSecret };
    const mockReq = { method: "POST", url: `/api/admin?action=${encodeURIComponent(body.action || "")}`, query: { action: body.action || "" }, body: proxiedBody, headers: req.headers, socket: req.socket };
    let mockOutput = "";
    const mockRes = { statusCode: 200, setHeader(){}, getHeader(){}, status(c){ this.statusCode = c; return this; }, json(v){ mockOutput = JSON.stringify(v); }, send(v){ mockOutput = typeof v === "string" ? v : JSON.stringify(v); }, end(v){ if(v) mockOutput = String(v); } };
    try {
      await adminHandler(mockReq, mockRes);
      let parsed = {}; try { parsed = JSON.parse(mockOutput || "{}"); } catch(_) { parsed = { message: mockOutput }; }
      return json(res, mockRes.statusCode || 200, { ...parsed, proxied: true });
    } catch(err) {
      return json(res, 502, { ok: false, error: "Action error: " + err.message });
    }
  }

  return json(res, 200, { ok: true, message: "Action acknowledged" });
}
