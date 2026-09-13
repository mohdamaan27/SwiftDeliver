import React, { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "./supabase";





// === PART 1: CORE APP ===

// ─── Utility helpers ────────────────────────────────────────────────────────
const genCode = () => {
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 8 }, () => c[Math.floor(Math.random() * c.length)]).join("");
};
const genId = () => Math.random().toString(36).slice(2, 10);
const now = () => new Date().toISOString();
const fmt = (iso) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const calcFee = (weight, priority) => {
  const base = { standard: 60, express: 120, urgent: 250 }[priority] || 60;
  const w = parseFloat(weight) || 0;
  return Math.round(base + w * 18);
};
const STATUS_FLOW = ["booked", "picked_up", "in_transit", "out_for_delivery", "delivered"];
const STATUS_LABEL = { booked: "Booked", picked_up: "Picked up", in_transit: "In transit", out_for_delivery: "Out for delivery", delivered: "Delivered" };
const STATUS_ICON = { booked: "📦", picked_up: "🏠", in_transit: "🚚", out_for_delivery: "🛵", delivered: "✅" };
const STATUS_COLOR = { booked: "#6366f1", picked_up: "#f59e0b", in_transit: "#3b82f6", out_for_delivery: "#f97316", delivered: "#22c55e" };

const AGENTS = [
  { id: "ag1", name: "Ravi Kumar", phone: "+91 98001 11001", rating: 4.8, deliveries: 312 },
  { id: "ag2", name: "Priya Sharma", phone: "+91 98001 22002", rating: 4.9, deliveries: 488 },
  { id: "ag3", name: "Arjun Singh", phone: "+91 98001 33003", rating: 4.7, deliveries: 197 },
  { id: "ag4", name: "Meena Patel", phone: "+91 98001 44004", rating: 4.6, deliveries: 254 },
];

// ─── Supabase config ──────────────────────────────────────────────────────
// 1. Create a project at https://supabase.com
// 2. Run supabase_schema.sql in its SQL Editor
// 3. Paste your Project URL + anon public key below (Project Settings → API)
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const sb = supabase;

// ─── Supabase-backed store ────────────────────────────────────────────────
const Store = {
  // small local-only prefs (dark mode) still use localStorage — no need for a DB round trip
  get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),

  // ── Deliveries ──────────────────────────────────────────────────────────
  // Stored as one JSONB blob per row so every field the app already uses
  // (code, cod, insurance, promo, rating, timeline, ...) keeps working as-is.
  async getDeliveries() {
    const { data, error } = await sb.from("deliveries").select("*").order("created_at", { ascending: false });
    if (error) { console.error("getDeliveries:", error.message); return []; }
    return (data || []).map(row => ({ ...row.data, id: row.id }));
  },
 async setDeliveries(list) {
  if (!list.length) return true;

  const { data: { user } } = await sb.auth.getUser();

  try {
    // Check which deliveries already exist in Supabase
    const ids = list.map(d => d.id);

    const { data: existingRows, error: fetchError } = await sb
      .from("deliveries")
      .select("id")
      .in("id", ids);

    if (fetchError) {
      console.error("Error checking existing deliveries:", fetchError);
      return false;
    }

    const existingIds = new Set(
      (existingRows || []).map(row => row.id)
    );

    const newRows = list
      .filter(d => !existingIds.has(d.id))
      .map(d => ({
        id: d.id,
        sender_id: d.senderId || user?.id || null,
        receiver_id: d.receiverId || null,
        data: d,
        updated_at: now()
      }));

    const updateRows = list.filter(
      d => existingIds.has(d.id)
    );

    // Insert new deliveries
    if (newRows.length > 0) {
      const { error: insertError } = await sb
        .from("deliveries")
        .insert(newRows);

      if (insertError) {
        console.error("Supabase INSERT ERROR:", insertError);
        return false;
      }
    }

    // Update existing deliveries
    for (const d of updateRows) {
      const { error: updateError } = await sb
        .from("deliveries")
        .update({
          receiver_id: d.receiverId || null,
          data: d,
          updated_at: now()
        })
        .eq("id", d.id);

      if (updateError) {
        console.error(
          "Supabase UPDATE ERROR:",
          updateError
        );
        return false;
      }
    }

    console.log("Deliveries successfully saved to Supabase");
    return true;

  } catch (error) {
    console.error("setDeliveries unexpected error:", error);
    return false;
  }
},
 async deleteDeliveryRow(id) {
  try {
    if (!id) {
      throw new Error("Delivery ID is required.");
    }

    const { error } = await sb
      .from("deliveries")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("deleteDelivery:", error.message);
      return false;
    }

    return true;

  } catch (error) {
    console.error("deleteDeliveryRow failed:", error);
    return false;
  }
},

  // ── Disputes ─────────────────────────────────────────────────────────────
  async getDisputes() {
    const { data, error } = await sb.from("disputes").select("*").order("created_at", { ascending: false });
    if (error) { console.error("getDisputes:", error.message); return []; }
    return (data || []).map(row => ({ ...row.data, id: row.id }));
  },
  async setDisputes(list) {
    if (!list.length) return true;
    const { data: { user } } = await sb.auth.getUser();
    const rows = list.map(d => ({ id: d.id, user_id: d.userId || user?.id || null, data: d, updated_at: now() }));
    const { error } = await sb.from("disputes").upsert(rows);
    if (error) { console.error("setDisputes:", error.message); return false; }
    return true;
  },

  // ── Agents ───────────────────────────────────────────────────────────────
  async getAgents() {
    const { data, error } = await sb.from("agents").select("*");
    if (error || !data || !data.length) return AGENTS;
    return data;
  },

  // ── Auth (Supabase Auth + profiles table) ──────────────────────────────
  async signUp(name, email, password, role) {
    const { data, error } = await sb.auth.signUp({ email, password, options: { data: { name, role } } });
    if (error) return { error };
    return { user: data.user };
  },
  async signIn(email, password) {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) return { error };
    return { user: data.user };
  },
  async resetPassword(email) {
  if (!email) {
    return { error: { message: "Please enter your email address." } };
  }

  const { error } = await sb.auth.resetPasswordForEmail(
    email.trim().toLowerCase(),
    {
      redirectTo: window.location.origin,
    }
  );

  if (error) return { error };

  return { success: true };
},
  async signOut() { await sb.auth.signOut(); },
  async getCurrentSession() {
    const { data } = await sb.auth.getSession();
    return data.session;
  },
  async getProfile(userId) {
    const { data, error } = await sb.from("profiles").select("*").eq("id", userId).single();
    if (error) { console.error("getProfile:", error.message); return null; }
    return { id: data.id, name: data.name, email: data.email, role: data.role, agentId: data.agent_id, phone: data.phone, address: data.address, createdAt: data.created_at };
  },
  // Find a registered user using their email
async getProfileByEmail(email) {
  if (!email) return null;

  const { data, error } = await sb
    .from("profiles")
    .select("*")
    .eq("email", email.trim().toLowerCase())
    .maybeSingle();

  if (error) {
    console.error("getProfileByEmail:", error.message);
    return null;
  }

  if (!data) return null;

  return {
    id: data.id,
    name: data.name,
    email: data.email,
    role: data.role,
    agentId: data.agent_id,
    phone: data.phone,
    address: data.address,
    createdAt: data.created_at
  };
},

  async getProfiles() {
    const { data, error } = await sb.from("profiles").select("*");
    if (error) { console.error("getProfiles:", error.message); return []; }
    return data.map(p => ({ id: p.id, name: p.name, email: p.email, role: p.role, agentId: p.agent_id, phone: p.phone, address: p.address, createdAt: p.created_at }));
  },
};

// ─── QR Code generator (pure JS, no library) ─────────────────────────────────
function QRDisplay({ value, size = 120 }) {
  // Simple visual QR-like representation using canvas
  const canvasRef = useRef(null);
  useEffect(() => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    const cells = 21;
    const cellSize = size / cells;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#111";
    // deterministic pattern from value
    let hash = 0;
    for (let i = 0; i < value.length; i++) hash = (hash << 5) - hash + value.charCodeAt(i);
    // corner squares
    [[0,0],[0,14],[14,0]].forEach(([r,c]) => {
      ctx.fillRect(c*cellSize, r*cellSize, 7*cellSize, 7*cellSize);
      ctx.fillStyle = "#fff";
      ctx.fillRect((c+1)*cellSize, (r+1)*cellSize, 5*cellSize, 5*cellSize);
      ctx.fillStyle = "#111";
      ctx.fillRect((c+2)*cellSize, (r+2)*cellSize, 3*cellSize, 3*cellSize);
      ctx.fillStyle = "#111";
    });
    // data cells
    for (let r = 0; r < cells; r++) {
      for (let c = 0; c < cells; c++) {
        if ((r<8&&c<8)||(r<8&&c>12)||(r>12&&c<8)) continue;
        const bit = ((hash ^ (r*31+c*17+value.charCodeAt((r+c)%value.length))) & 1);
        if (bit) ctx.fillRect(c*cellSize, r*cellSize, cellSize, cellSize);
      }
    }
  }, [value, size]);
  return <canvas ref={canvasRef} width={size} height={size} style={{ borderRadius: 4, border: "1px solid #e5e7eb" }} />;
}

// ─── Notification toast ──────────────────────────────────────────────────────
function Toast({ msg, type, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3500); return () => clearTimeout(t); }, []);
  const bg = { success: "#dcfce7", error: "#fee2e2", info: "#dbeafe" }[type] || "#f3f4f6";
  const tc = { success: "#166534", error: "#991b1b", info: "#1e40af" }[type] || "#374151";
  return (
    <div style={{ position: "fixed", top: 20, right: 20, zIndex: 9999, background: bg, color: tc, padding: "12px 18px", borderRadius: 10, boxShadow: "0 4px 20px rgba(0,0,0,.13)", fontSize: 14, fontWeight: 500, maxWidth: 320, display: "flex", gap: 10, alignItems: "center" }}>
      <span style={{ fontSize: 18 }}>{type === "success" ? "✅" : type === "error" ? "❌" : "ℹ️"}</span>
      <span>{msg}</span>
      <button onClick={onClose} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", fontSize: 16, color: tc }}>×</button>
    </div>
  );
}

// ─── Tracking timeline ────────────────────────────────────────────────────────
function TrackingTimeline({ delivery }) {
  const currentIdx = STATUS_FLOW.indexOf(delivery.status);
  return (
    <div style={{ padding: "8px 0" }}>
      {STATUS_FLOW.map((s, i) => {
        const done = i <= currentIdx;
        const active = i === currentIdx;
        const update = delivery.timeline?.find(t => t.status === s);
        return (
          <div key={s} style={{ display: "flex", gap: 16, marginBottom: i < STATUS_FLOW.length - 1 ? 0 : 0 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: done ? STATUS_COLOR[s] : "#e5e7eb", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700, boxShadow: active ? `0 0 0 4px ${STATUS_COLOR[s]}33` : "none", transition: "all .3s" }}>
                {done ? STATUS_ICON[s] : <span style={{ color: "#9ca3af", fontSize: 12 }}>{i + 1}</span>}
              </div>
              {i < STATUS_FLOW.length - 1 && <div style={{ width: 2, height: 36, background: done && i < currentIdx ? STATUS_COLOR[s] : "#e5e7eb", marginTop: 2, marginBottom: 2 }} />}
            </div>
            <div style={{ paddingTop: 6, paddingBottom: i < STATUS_FLOW.length - 1 ? 32 : 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: done ? "#111" : "#9ca3af" }}>{STATUS_LABEL[s]}</div>
              {update && <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{fmt(update.at)}</div>}
              {update?.note && <div style={{ fontSize: 12, color: "#6b7280" }}>{update.note}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Badge ───────────────────────────────────────────────────────────────────
function Badge({ label, color = "#6366f1", bg = "#ede9fe" }) {
  return <span style={{ background: bg, color, fontSize: 11, fontWeight: 600, padding: "2px 9px", borderRadius: 999, display: "inline-flex", alignItems: "center", gap: 4 }}>{label}</span>;
}

// ─── Card ────────────────────────────────────────────────────────────────────
function Card({ children, style = {}, ...rest }) {
  return <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: "1.25rem 1.4rem", ...style }} {...rest}>{children}</div>;
}

// ─── Input field ──────────────────────────────────────────────────────────────
function Field({ label, required, error, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <label style={{ fontSize: 13, color: "#6b7280", display: "block", marginBottom: 4 }}>{label}{required && <span style={{ color: "#ef4444" }}> *</span>}</label>}
      {children}
      {error && <div style={{ fontSize: 12, color: "#ef4444", marginTop: 3 }}>{error}</div>}
    </div>
  );
}

const inp = { width: "100%", padding: "9px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, fontFamily: "inherit", outline: "none", boxSizing: "border-box", background: "#fff", color: "#111" };

// ─── Navbar ───────────────────────────────────────────────────────────────────
function Navbar({ session, setPage, logout, page, deliveries }) {
  const [menu, setMenu] = useState(false);
  const notifications = generateNotifications(deliveries || [], session);

const [read, setRead] = useState(() => {
  try {
    return JSON.parse(localStorage.getItem("sd_read_notifs")) || [];
  } catch {
    return [];
  }
});

const unreadCount = notifications.filter(
  n => !read.includes(n.id)
).length;
  return (
    <nav style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "0 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", height: 60, position: "sticky", top: 0, zIndex: 100 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }} onClick={() => setPage("home")}>
        <div style={{ width: 34, height: 34, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🚀</div>
        <span style={{ fontWeight: 700, fontSize: 17, color: "#111" }}>SwiftDeliver</span>
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        {[
  { label: "Send", p: "send" },
  { label: "Track", p: "track" },
  { label: "🔔 Notifications", p: "notifications", badge: unreadCount }
].map(({ label, p, badge }) => (
  <button
    key={p}
    onClick={() => setPage(p)}
    style={{
      position: "relative",
      padding: "6px 14px",
      border: "none",
      background: page === p ? "#ede9fe" : "transparent",
      color: page === p ? "#6366f1" : "#6b7280",
      borderRadius: 8,
      fontWeight: 600,
      fontSize: 13,
      cursor: "pointer",
      fontFamily: "inherit"
    }}
  >
    {label}

    {badge > 0 && (
      <span
        style={{
          position: "absolute",
          top: -6,
          right: -4,
          minWidth: 18,
          height: 18,
          padding: "0 4px",
          borderRadius: 10,
          background: "#ef4444",
          color: "#fff",
          fontSize: 10,
          fontWeight: 700,
          display: "flex",
          alignItems: "center",
          justifyContent: "center"
        }}
      >
        {badge > 99 ? "99+" : badge}
      </span>
    )}
  </button>
))}
        {session ? (
          <div style={{ position: "relative" }}>
            <button onClick={() => setMenu(prev => !prev)} style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 12px", background: "#f3f4f6", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#374151", fontFamily: "inherit" }}>
              <span style={{ width: 24, height: 24, background: "#6366f1", borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 11, fontWeight: 700 }}>{session.name[0].toUpperCase()}</span>
              {session.name.split(" ")[0]} ▾
            </button>
            {menu && (
              <div style={{ position: "absolute", right: 0, top: "110%", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, minWidth: 160, boxShadow: "0 8px 24px rgba(0,0,0,.10)", zIndex: 200 }}>
               {[
  { label: "🔔 Notifications", p: "notifications" },

  session.role !== "agent" && {
    label: "My deliveries",
    p: "history"
  },

  session.role === "admin" && {
    label: "Admin panel",
    p: "admin"
  },

  session.role === "agent" && {
    label: "Agent panel",
    p: "agent"
  },

  (session.role === "sender" || session.role === "receiver") && {
    label: "Dashboard",
    p: "dashboard"
  },
].filter(Boolean).map(({ label, p }) => (
                  <button key={p} onClick={() => { setPage(p); setMenu(false); }} style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 14px", border: "none", background: "none", cursor: "pointer", fontSize: 13, color: "#374151", fontFamily: "inherit" }}>{label}</button>
                ))}
                <div style={{ borderTop: "1px solid #f3f4f6" }} />
                <button onClick={() => { logout(); setMenu(false); }} style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 14px", border: "none", background: "none", cursor: "pointer", fontSize: 13, color: "#ef4444", fontFamily: "inherit" }}>Log out</button>
              </div>
            )}
          </div>
        ) : (
          <>
            <button onClick={() => setPage("login")} style={{ padding: "6px 14px", border: "1px solid #d1d5db", background: "transparent", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", color: "#374151", fontFamily: "inherit" }}>Log in</button>
            <button onClick={() => setPage("register")} style={{ padding: "6px 14px", border: "none", background: "#6366f1", color: "#fff", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Sign up</button>
          </>
        )}
      </div>
    </nav>
  );
}

// ─── Home page ────────────────────────────────────────────────────────────────
function HomePage({ setPage, session, deliveries }) {
  const stats = {
    total: deliveries.length,
    delivered: deliveries.filter(d => d.status === "delivered").length,
    active: deliveries.filter(d => d.status !== "delivered").length,
  };
  return (
    <div>
      {/* Hero */}
      <div style={{ textAlign: "center", padding: "3.5rem 1rem 2.5rem" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#ede9fe", color: "#7c3aed", borderRadius: 999, padding: "5px 14px", fontSize: 13, fontWeight: 600, marginBottom: 20 }}>
          🚀 Instant delivery, real-time tracking
        </div>
        <h1 style={{ fontSize: 44, fontWeight: 800, lineHeight: 1.15, color: "#0f172a", marginBottom: 18 }}>
          Send anything,<br /><span style={{ background: "linear-gradient(90deg,#6366f1,#8b5cf6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>anywhere, instantly</span>
        </h1>
        <p style={{ fontSize: 17, color: "#6b7280", maxWidth: 480, margin: "0 auto 32px" }}>
          Full-stack delivery platform with live tracking, agent assignment, payments, and real-time notifications.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <button onClick={() => setPage("send")} style={{ padding: "13px 28px", background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>📦 Send a package</button>
          <button onClick={() => setPage("track")} style={{ padding: "13px 28px", background: "#fff", color: "#374151", border: "1.5px solid #d1d5db", borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>🔍 Track delivery</button>
          {session && (session.role === "sender" || session.role === "receiver") && (
  <button
    onClick={() => setPage("dashboard")}
    style={{
      padding: "13px 28px",
      background: "#0f172a",
      color: "#fff",
      border: "none",
      borderRadius: 10,
      fontSize: 15,
      fontWeight: 700,
      cursor: "pointer",
      fontFamily: "inherit"
    }}
  >
    📊 My Dashboard
  </button>
)}
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, marginBottom: 32 }}>
        {[
          { label: "Total deliveries", value: stats.total, icon: "📦", color: "#6366f1", bg: "#ede9fe" },
          { label: "Active shipments", value: stats.active, icon: "🚚", color: "#f59e0b", bg: "#fef3c7" },
          { label: "Delivered", value: stats.delivered, icon: "✅", color: "#22c55e", bg: "#dcfce7" },
        ].map(s => (
          <Card key={s.label} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 28, marginBottom: 6 }}>{s.icon}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 13, color: "#9ca3af", marginTop: 2 }}>{s.label}</div>
          </Card>
        ))}
      </div>

      {/* Features */}
      <div style={{ marginBottom: 32 }}>
        <h2 style={{ fontWeight: 700, fontSize: 22, color: "#0f172a", marginBottom: 18 }}>Everything built in</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 14 }}>
          {[
            { icon: "🔐", title: "Auth & roles", desc: "Sender, receiver, agent, admin accounts", page: "login" },
            { icon: "📡", title: "Live tracking", desc: "Real-time status updates with timeline", page: "track" },
            { icon: "👤", title: "Agent module", desc: "Assign agents, update status, proof of delivery", page: "agent" },
            { icon: "💳", title: "Payments", desc: "Dynamic fee calculator with Razorpay flow", page: "send" },
            { icon: "🗺️", title: "Address details", desc: "Full pickup & delivery address management", page: "send" },
            { icon: "📊", title: "Admin dashboard", desc: "Stats, charts, all deliveries, user management", page: "admin" },
            { icon: "🔔", title: "Notifications", desc: "In-app toast system for all status changes", page: "notifications" },
            { icon: "📱", title: "QR code", desc: "QR on every booking for agent scanning", page: "track" },
            { icon: "🏷️", title: "Priority tiers", desc: "Standard, express, urgent with dynamic pricing", page: "send" },
            { icon: "📜", title: "History & export", desc: "Full delivery history per user", page: "history" },
            { icon: "🔍", title: "Search & filter", desc: "Filter deliveries by status, date, priority", page: "history" },
            { icon: "🛡️", title: "Insurance option", desc: "Optional insurance for valuable items", page: "send" },
          ].map(f => (
            <Card key={f.title} onClick={() => setPage(f.page)} style={{ cursor: "pointer", transition: "transform .15s, box-shadow .15s" }} onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-3px)"; e.currentTarget.style.boxShadow = "0 8px 20px rgba(0,0,0,.08)"; }} onMouseLeave={e => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "none"; }}>
              <div style={{ fontSize: 22, marginBottom: 8 }}>{f.icon}</div>
              <div style={{ fontWeight: 600, fontSize: 14, color: "#111", marginBottom: 4 }}>{f.title}</div>
              <div style={{ fontSize: 12, color: "#9ca3af", lineHeight: 1.5 }}>{f.desc}</div>
            </Card>
          ))}
        </div>
      </div>

      {!session && (
        <Card style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)", border: "none", textAlign: "center", padding: "2rem" }}>
          <h3 style={{ color: "#fff", fontSize: 20, fontWeight: 700, marginBottom: 10 }}>Ready to get started?</h3>
          <p style={{ color: "#c4b5fd", marginBottom: 20, fontSize: 14 }}>Create an account or explore with demo credentials.</p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <button onClick={() => setPage("register")} style={{ padding: "10px 22px", background: "#fff", color: "#6366f1", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Create account</button>
            <button onClick={() => setPage("login")} style={{ padding: "10px 22px", background: "rgba(255,255,255,.15)", color: "#fff", border: "1.5px solid rgba(255,255,255,.4)", borderRadius: 8, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Log in</button>
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── Sender page ──────────────────────────────────────────────────────────────
function SenderPage({ session, saveDeliveries, deliveries, toast, setPage, setModal, agents }) {
  const [step, setStep] = useState(1); // 1=form, 2=payment, 3=success
  const [priority, setPriority] = useState("standard");
  const [errors, setErrors] = useState({});
  const [booked, setBooked] = useState(null);
  const [paid, setPaid] = useState(false);
  const [paymentLoading, setPaymentLoading] = useState(false);
    useEffect(() => {
    if (window.Razorpay) return;

    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;

    script.onload = () => {
      console.log("Razorpay Checkout loaded successfully");
    };

    script.onerror = () => {
      console.error("Failed to load Razorpay Checkout");
      toast("Could not load Razorpay. Please check your internet connection.", "error");
    };

    document.body.appendChild(script);

    return () => {
      script.remove();
    };
  }, []);
  const [form, setForm] = useState({
    itemName: "", category: "", weight: "", qty: "1", value: "", description: "",
    fragile: false, cold: false, insure: false,
    senderName: session?.name || "", senderEmail: session?.email || "", senderPhone: "",
   senderAddr: "", recvName: "", recvEmail: "", recvPhone: "", recvAddr: "", recvCity: "", recvPin: "",
    instructions: "", deliveryTime: "",
  });

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const fee = calcFee(form.weight, priority);
const validate = () => {
  const e = {};

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const phoneRegex = /^[6-9]\d{9}$/;
  const pinRegex = /^\d{6}$/;

  const weight = Number(form.weight);
  const qty = Number(form.qty);
  const value = Number(form.value);

  if (!form.itemName.trim()) {
    e.itemName = "Item name is required";
  }

  if (!form.category.trim()) {
    e.category = "Category is required";
  }

  if (!form.weight || !Number.isFinite(weight) || weight <= 0 || weight > 1000) {
    e.weight = "Enter a valid weight between 0.1 and 1000 kg";
  }

  if (!form.qty || !Number.isInteger(qty) || qty < 1 || qty > 1000) {
    e.qty = "Quantity must be between 1 and 1000";
  }

  if (!form.value || !Number.isFinite(value) || value < 0 || value > 10000000) {
    e.value = "Enter a valid package value";
  }

  if (!form.senderName.trim()) {
    e.senderName = "Sender name is required";
  }

  if (!phoneRegex.test(form.senderPhone.trim())) {
    e.senderPhone = "Enter a valid 10-digit mobile number";
  }

  if (!form.senderAddr.trim()) {
    e.senderAddr = "Sender address is required";
  }

  if (!form.recvName.trim()) {
    e.recvName = "Receiver name is required";
  }

  if (!emailRegex.test(form.recvEmail.trim())) {
    e.recvEmail = "Enter a valid email address";
  }

  if (!phoneRegex.test(form.recvPhone.trim())) {
    e.recvPhone = "Enter a valid 10-digit mobile number";
  }

  if (!form.recvAddr.trim()) {
    e.recvAddr = "Receiver address is required";
  }

  if (form.recvPin && !pinRegex.test(form.recvPin.trim())) {
    e.recvPin = "PIN code must be exactly 6 digits";
  }

  if (!["standard", "express", "urgent"].includes(priority)) {
    e.priority = "Invalid delivery priority";
  }

  setErrors(e);

  return Object.keys(e).length === 0;
};

  const handleBooking = () => {
    if (!validate()) { toast("Please fill all required fields", "error"); return; }
    setStep(2);
  };

const handlePayment = async () => {
  if (paymentLoading) return;

  setPaymentLoading(true);

  if (!window.Razorpay) {
    toast("Razorpay Checkout is still loading. Please try again.", "error");
    setPaymentLoading(false);
    return;
  }

  if (!agents || agents.length === 0) {
    toast("No delivery agents available", "error");
    setPaymentLoading(false);
    return;
  }

  try {
    toast("Creating secure payment order...", "info");

    const code = genCode();

    const { data: orderData, error: orderError } =
      await sb.functions.invoke("create-razorpay-order", {
        body: {
          weight: form.weight,
          priority: priority,
          receipt: `swift_${code}`,
          notes: {
            delivery_code: code
          }
        }
      });

    if (orderError || !orderData?.success || !orderData?.order) {
      console.error("Razorpay order error:", orderError || orderData);

      toast(
        orderData?.error || "Could not create payment order.",
        "error"
      );

      setPaymentLoading(false);
      return;
    }

    const order = orderData.order;
    const keyId = orderData.keyId;
    const serverFee = Number(orderData.fee);

    const options = {
      key: keyId,
      amount: order.amount,
      currency: order.currency || "INR",
      name: "SwiftDeliver",
      description: `Delivery payment - ${code}`,
      order_id: order.id,

      handler: async function (response) {
        try {
          toast("Verifying payment...", "info");

          const { data: verifyData, error: verifyError } =
            await sb.functions.invoke("verify-razorpay-payment", {
              body: {
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature
              }
            });

          if (
            verifyError ||
            !verifyData?.success ||
            !verifyData?.verified
          ) {
            console.error(
              "Payment verification failed:",
              verifyError || verifyData
            );

            toast(
              verifyData?.error || "Payment verification failed.",
              "error"
            );

            setPaymentLoading(false);
            return;
          }

          const receiverProfile =
            await Store.getProfileByEmail(form.recvEmail);

          const agentIdx = Math.floor(
            Math.random() * agents.length
          );

          const agent = agents[agentIdx];

          const delivery = {
            id: genId(),
            code,
            status: "booked",
            priority,
            fee: serverFee,
            ...form,

            senderId: session?.id || null,
            receiverId: receiverProfile?.id || null,

            agentId: agent.id,
            agentName: agent.name,
            agentPhone: agent.phone,

            createdAt: now(),

            timeline: [
              {
                status: "booked",
                at: now(),
                note: "Delivery booked & payment confirmed"
              }
            ],

            paymentStatus: "paid",
            paymentMethod: "Razorpay",
            paymentId: response.razorpay_payment_id,
            paymentOrderId: response.razorpay_order_id
          };

          const saved = await saveDeliveries([
            delivery,
            ...deliveries
          ]);

          if (!saved) {
            console.error(
              "BOOKING SAVE FAILED AFTER PAYMENT",
              delivery
            );

            toast(
              "Payment succeeded, but delivery could not be saved. Check the console for the exact error.",
              "error"
            );

            setPaymentLoading(false);
            return;
          }

          setBooked(delivery);
          setPaid(true);
          setStep(3);
          setPaymentLoading(false);

          toast(
            "🎉 Payment verified & booking confirmed!",
            "success"
          );
        } catch (error) {
          console.error("Payment verification/booking error:", error);

          toast(
            error?.message ||
              "Payment verification or booking failed.",
            "error"
          );

          setPaymentLoading(false);
        }
      }
    };

    const razorpay = new window.Razorpay(options);

    razorpay.on("payment.failed", function (response) {
      console.error(
        "Razorpay payment failed:",
        response.error
      );

      toast(
        response.error?.description ||
          "Payment failed. Please try again.",
        "error"
      );

      setPaymentLoading(false);
    });

    razorpay.on("payment.cancelled", function () {
      toast("Payment was cancelled.", "info");
      setPaymentLoading(false);
    });

    razorpay.open();

  } catch (error) {
    console.error("Razorpay payment error:", error);

    toast(
      error?.message ||
        "Could not start Razorpay payment.",
      "error"
    );

    setPaymentLoading(false);
  }
};

  if (step === 3 && booked) return <SuccessView delivery={booked} setStep={setStep} setForm={setForm} session={session} setPage={setPage} />;

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: "#0f172a" }}>Send a package</h1>
        <p style={{ color: "#6b7280", marginTop: 4 }}>Fill in the details below. You'll get a tracking code to share with the receiver.</p>
      </div>

      {/* Step indicator */}
      <div style={{ display: "flex", gap: 8, marginBottom: 28, alignItems: "center" }}>
        {["Package details", "Payment"].map((s, i) => (
          <div key={s} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: step > i + 1 ? "#22c55e" : step === i + 1 ? "#6366f1" : "#e5e7eb", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>{step > i + 1 ? "✓" : i + 1}</div>
            <span style={{ fontSize: 13, fontWeight: 600, color: step === i + 1 ? "#6366f1" : "#9ca3af" }}>{s}</span>
            {i < 1 && <div style={{ width: 40, height: 2, background: "#e5e7eb" }} />}
          </div>
        ))}
      </div>

      {step === 1 && (
        <div style={{ display: "grid", gap: 16 }}>
          {/* Item details */}
          <Card>
            <h3 style={{ fontWeight: 700, fontSize: 15, marginBottom: 16, color: "#374151" }}>📦 Item details</h3>
            <Field label="Item name" required error={errors.itemName}>
              <input style={inp} value={form.itemName} onChange={e => set("itemName", e.target.value)} placeholder="e.g. Birthday gift, Laptop, Documents" />
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Category" required error={errors.category}>
                <select style={inp} value={form.category} onChange={e => set("category", e.target.value)}>
                  <option value="">Select</option>
                  {["Electronics", "Documents", "Food & Groceries", "Clothing", "Furniture", "Medicine", "Books", "Gifts", "Other"].map(c => <option key={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Quantity">
                <input style={inp} type="number" min="1" value={form.qty} onChange={e => set("qty", e.target.value)} />
              </Field>
              <Field label="Weight (kg)">
                <input style={inp} type="number" min="0" step="0.1" value={form.weight} onChange={e => set("weight", e.target.value)} placeholder="e.g. 2.5" />
              </Field>
              <Field label="Declared value (₹)">
                <input style={inp} type="number" min="0" value={form.value} onChange={e => set("value", e.target.value)} placeholder="e.g. 5000" />
              </Field>
            </div>
            <Field label="Description / contents">
              <textarea style={{ ...inp, minHeight: 70, resize: "vertical" }} value={form.description} onChange={e => set("description", e.target.value)} placeholder="Briefly describe the item..." />
            </Field>
            {/* Priority */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 13, color: "#6b7280", display: "block", marginBottom: 8 }}>Priority</label>
              <div style={{ display: "flex", gap: 10 }}>
                {[
                  { key: "standard", label: "Standard", icon: "🕐", color: "#6366f1", bg: "#ede9fe", fee: calcFee(form.weight, "standard") },
                  { key: "express", label: "Express", icon: "⚡", color: "#d97706", bg: "#fef3c7", fee: calcFee(form.weight, "express") },
                  { key: "urgent", label: "Urgent", icon: "🔥", color: "#dc2626", bg: "#fee2e2", fee: calcFee(form.weight, "urgent") },
                ].map(p => (
                  <button key={p.key} onClick={() => setPriority(p.key)} style={{ flex: 1, padding: "10px 8px", border: `2px solid ${priority === p.key ? p.color : "#e5e7eb"}`, borderRadius: 10, background: priority === p.key ? p.bg : "#fff", cursor: "pointer", fontFamily: "inherit", textAlign: "center" }}>
                    <div style={{ fontSize: 18 }}>{p.icon}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: priority === p.key ? p.color : "#374151", marginTop: 3 }}>{p.label}</div>
                    <div style={{ fontSize: 11, color: "#9ca3af" }}>₹{p.fee}</div>
                  </button>
                ))}
              </div>
            </div>
            {/* Flags */}
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              {[{ key: "fragile", label: "🫗 Fragile" }, { key: "cold", label: "❄️ Temp sensitive" }, { key: "insure", label: "🛡️ Insurance" }].map(f => (
                <label key={f.key} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, color: "#374151", cursor: "pointer" }}>
                  <input type="checkbox" checked={form[f.key]} onChange={e => set(f.key, e.target.checked)} style={{ width: "auto" }} />
                  {f.label}
                </label>
              ))}
            </div>
          </Card>

          {/* Sender details */}
          <Card>
            <h3 style={{ fontWeight: 700, fontSize: 15, marginBottom: 16, color: "#374151" }}>👤 Sender details</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Full name" required error={errors.senderName}>
                <input style={inp} value={form.senderName} onChange={e => set("senderName", e.target.value)} placeholder="Your name" />
              </Field>
              <Field label="Phone" required error={errors.senderPhone}>
                <input style={inp} value={form.senderPhone} onChange={e => set("senderPhone", e.target.value)} placeholder="+91 98765 43210" />
              </Field>
            </div>
            <Field label="Pickup address" required error={errors.senderAddr}>
              <textarea style={{ ...inp, minHeight: 64, resize: "vertical" }} value={form.senderAddr} onChange={e => set("senderAddr", e.target.value)} placeholder="House/flat no., street, area, city, PIN code" />
            </Field>
          </Card>

          {/* Receiver details */}
          <Card>
            <h3 style={{ fontWeight: 700, fontSize: 15, marginBottom: 16, color: "#374151" }}>📍 Receiver details</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
  <Field label="Receiver name" required error={errors.recvName}>
    <input
      style={inp}
      value={form.recvName}
      onChange={e => set("recvName", e.target.value)}
      placeholder="Receiver's name"
    />
  </Field>

  <Field label="Receiver email" required error={errors.recvEmail}>
    <input
      style={inp}
      type="email"
      value={form.recvEmail}
      onChange={e => set("recvEmail", e.target.value)}
      placeholder="receiver@example.com"
    />
  </Field>

  <Field label="Receiver phone" required error={errors.recvPhone}>
    <input
      style={inp}
      value={form.recvPhone}
      onChange={e => set("recvPhone", e.target.value)}
      placeholder="+91 98765 43210"
    />
  </Field>
</div>
            <Field label="Delivery address" required error={errors.recvAddr}>
              <textarea style={{ ...inp, minHeight: 64, resize: "vertical" }} value={form.recvAddr} onChange={e => set("recvAddr", e.target.value)} placeholder="House/flat no., street, area, city, PIN code" />
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="City">
                <input style={inp} value={form.recvCity} onChange={e => set("recvCity", e.target.value)} placeholder="e.g. Mumbai" />
              </Field>
              <Field label="PIN code">
                <input style={inp} value={form.recvPin} onChange={e => set("recvPin", e.target.value)} placeholder="e.g. 400001" maxLength={6} />
              </Field>
            </div>
            <Field label="Delivery instructions">
              <textarea style={{ ...inp, minHeight: 56, resize: "vertical" }} value={form.instructions} onChange={e => set("instructions", e.target.value)} placeholder="Leave at door, call before delivery, etc." />
            </Field>
            <Field label="Preferred delivery time">
              <select style={inp} value={form.deliveryTime} onChange={e => set("deliveryTime", e.target.value)}>
                <option value="">No preference</option>
                {["Morning (8 AM – 12 PM)", "Afternoon (12 PM – 4 PM)", "Evening (4 PM – 8 PM)"].map(t => <option key={t}>{t}</option>)}
              </select>
            </Field>
          </Card>

          {/* Fee summary */}
          <Card style={{ background: "#f8fafc" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 13, color: "#6b7280" }}>Delivery fee ({priority})</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#6366f1" }}>₹{fee}</div>
              </div>
              <div style={{ textAlign: "right", fontSize: 12, color: "#9ca3af" }}>
                {form.weight && <div>Weight: {form.weight} kg</div>}
                {form.insure && <div style={{ color: "#7c3aed" }}>+ Insurance included</div>}
              </div>
            </div>
          </Card>

          <button onClick={handleBooking} style={{ width: "100%", padding: "14px", background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
            Continue to payment →
          </button>
        </div>
      )}

      {step === 2 && (
        <PaymentPage fee={fee} priority={priority} form={form} onPay={handlePayment} onBack={() => setStep(1)} />
      )}
    </div>
  );
}

// ─── Payment page ─────────────────────────────────────────────────────────────
function PaymentPage({ fee, priority, form, onPay, onBack }) {
  const [method, setMethod] = useState("upi");
  const [upi, setUpi] = useState("");
  const [processing, setProcessing] = useState(false);
  const handlePay = () => {
  if (processing) return;

  setProcessing(true);

  setTimeout(async () => {
    try {
      await onPay();
    } finally {
      setProcessing(false);
    }
  }, 2000);
};
  return (
    <div style={{ maxWidth: 520, margin: "0 auto" }}>
      <button onClick={onBack} style={{ background: "none", border: "none", color: "#6366f1", fontWeight: 600, cursor: "pointer", marginBottom: 20, fontFamily: "inherit", fontSize: 14 }}>← Back to details</button>
      <Card style={{ marginBottom: 16 }}>
        <h3 style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>💳 Payment</h3>
        <div style={{ background: "#f8fafc", borderRadius: 10, padding: "14px 16px", marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: "#6b7280", marginBottom: 6 }}>
            <span>Delivery fee ({priority})</span><span>₹{fee}</span>
          </div>
          {form.insure && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: "#6b7280", marginBottom: 6 }}><span>Insurance</span><span>₹0 (included)</span></div>}
          <div style={{ borderTop: "1px solid #e5e7eb", marginTop: 8, paddingTop: 8, display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 16, color: "#111" }}>
            <span>Total</span><span style={{ color: "#6366f1" }}>₹{fee}</span>
          </div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 13, color: "#6b7280", display: "block", marginBottom: 8 }}>Payment method</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            {[{ k: "upi", label: "UPI", icon: "📲" }, { k: "card", label: "Card", icon: "💳" }, { k: "cod", label: "Cash on delivery", icon: "💵" }].map(m => (
              <button key={m.k} onClick={() => setMethod(m.k)} style={{ padding: "10px 6px", border: `2px solid ${method === m.k ? "#6366f1" : "#e5e7eb"}`, borderRadius: 8, background: method === m.k ? "#ede9fe" : "#fff", cursor: "pointer", fontFamily: "inherit", textAlign: "center" }}>
                <div style={{ fontSize: 20 }}>{m.icon}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: method === m.k ? "#6366f1" : "#374151", marginTop: 3 }}>{m.label}</div>
              </button>
            ))}
          </div>
        </div>
        {method === "upi" && (
          <Field label="UPI ID">
            <input style={inp} value={upi} onChange={e => setUpi(e.target.value)} placeholder="yourname@upi" />
          </Field>
        )}
        {method === "card" && (
          <>
            <Field label="Card number"><input style={inp} placeholder="4242 4242 4242 4242" maxLength={19} /></Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Expiry"><input style={inp} placeholder="MM/YY" maxLength={5} /></Field>
              <Field label="CVV"><input style={inp} placeholder="123" maxLength={3} type="password" /></Field>
            </div>
          </>
        )}
        {method === "cod" && <div style={{ background: "#fef3c7", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#92400e", marginBottom: 14 }}>Cash on delivery — pay when your package arrives.</div>}
        <button onClick={handlePay} disabled={processing} style={{ width: "100%", padding: 14, background: processing ? "#a5b4fc" : "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: processing ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
          {processing ? "Processing payment…" : `Pay ₹${fee}`}
        </button>
        <p style={{ textAlign: "center", fontSize: 12, color: "#9ca3af", marginTop: 10 }}>🔒 Secured by Razorpay · 256-bit SSL encryption</p>
      </Card>
    </div>
  );
}

// ─── Success view ─────────────────────────────────────────────────────────────
function SuccessView({ delivery, setStep, setForm, session, setPage }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(delivery.code).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  return (
    <div style={{ maxWidth: 560, margin: "0 auto" }}>
      <Card style={{ background: "linear-gradient(135deg,#dcfce7,#f0fdf4)", border: "1.5px solid #86efac", textAlign: "center", marginBottom: 20 }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🎉</div>
        <h2 style={{ fontWeight: 800, fontSize: 22, color: "#166534", marginBottom: 6 }}>Booking confirmed!</h2>
        <p style={{ color: "#15803d", fontSize: 14, marginBottom: 20 }}>Payment of ₹{delivery.fee} received. Share this code with the receiver.</p>
        <div style={{ background: "#fff", border: "2px dashed #86efac", borderRadius: 12, padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "center", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
          <QRDisplay value={delivery.code} size={80} />
          <div>
            <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>TRACKING CODE</div>
            <div style={{ fontSize: 30, fontWeight: 800, fontFamily: "monospace", letterSpacing: 4, color: "#166534" }}>{delivery.code}</div>
          </div>
        </div>
        <button onClick={copy} style={{ padding: "8px 20px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 8, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}>
          {copied ? "✓ Copied!" : "📋 Copy code"}
        </button>
      </Card>

      <Card style={{ marginBottom: 14 }}>
        <h3 style={{ fontWeight: 700, fontSize: 15, marginBottom: 14, color: "#374151" }}>Booking summary</h3>
        <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
          {[
            ["Item", `${delivery.itemName} (${delivery.category})`],
            ["Quantity", delivery.qty],
            ["Priority", delivery.priority],
            ["Fee paid", `₹${delivery.fee}`],
            ["Agent assigned", `${delivery.agentName} · ${delivery.agentPhone}`],
            ["To", `${delivery.recvName} — ${delivery.recvAddr}${delivery.recvCity ? ", " + delivery.recvCity : ""}${delivery.recvPin ? " " + delivery.recvPin : ""}`],
            ["Booked at", fmt(delivery.createdAt)],
          ].map(([l, v]) => (
            <tr key={l}><td style={{ color: "#9ca3af", padding: "5px 0", width: 110 }}>{l}</td><td style={{ padding: "5px 0", fontWeight: 500 }}>{v}</td></tr>
          ))}
        </table>
      </Card>

      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={() => { setPage("track"); }} style={{ flex: 1, padding: 12, background: "#ede9fe", color: "#6366f1", border: "none", borderRadius: 10, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: 14 }}>🔍 Track delivery</button>
        <button onClick={() => { setStep(1); setForm({ itemName: "", category: "", weight: "", qty: "1", value: "", description: "", fragile: false, cold: false, insure: false, senderName: session?.name || "", senderEmail: session?.email || "", senderPhone: "", senderAddr: "", recvName: "", recvPhone: "", recvAddr: "", recvCity: "", recvPin: "", instructions: "", deliveryTime: "" }); }} style={{ flex: 1, padding: 12, background: "#fff", color: "#374151", border: "1.5px solid #d1d5db", borderRadius: 10, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: 14 }}>📦 Send another</button>
      </div>
    </div>
  );
}

// ─── Receiver / Track page ────────────────────────────────────────────────────
function ReceiverPage({ deliveries, advanceStatus, session, toast }) {
  const [code, setCode] = useState("");
  const [result, setResult] = useState(null);
  const [notFound, setNotFound] = useState(false);

  const lookup = () => {
    const d = deliveries.find(x => x.code === code.trim().toUpperCase());
    if (d) { setResult(d); setNotFound(false); }
    else { setResult(null); setNotFound(true); }
  };

  // auto-refresh if viewing
  useEffect(() => {
    if (!result) return;
    const updated = deliveries.find(x => x.id === result.id);
    if (updated) setResult(updated);
  }, [deliveries]);

  return (
    <div>
      <h1 style={{ fontSize: 26, fontWeight: 800, color: "#0f172a", marginBottom: 6 }}>Track your delivery</h1>
      <p style={{ color: "#6b7280", marginBottom: 24 }}>Enter the 8-character code your sender shared with you.</p>

      <div style={{ display: "flex", gap: 10, marginBottom: 16, maxWidth: 480 }}>
        <input style={{ ...inp, fontSize: 20, fontWeight: 700, fontFamily: "monospace", letterSpacing: 4, textTransform: "uppercase", textAlign: "center" }} maxLength={8} value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="ABCD1234" onKeyDown={e => e.key === "Enter" && lookup()} />
        <button onClick={lookup} style={{ padding: "0 24px", background: "#6366f1", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: 14, whiteSpace: "nowrap" }}>Track →</button>
      </div>

      {notFound && <div style={{ background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 10, padding: "12px 16px", color: "#991b1b", fontSize: 14, marginBottom: 16 }}>❌ Code not found. Double-check and try again.</div>}

      {result && (
        <div style={{ display: "grid", gap: 16 }}>
          {/* Status card */}
          <Card style={{ borderLeft: `4px solid ${STATUS_COLOR[result.status]}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 11, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Tracking · {result.code}</div>
                <h2 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>{result.itemName}</h2>
                <div style={{ fontSize: 13, color: "#6b7280" }}>{result.category} · Qty {result.qty} · Booked {fmtDate(result.createdAt)}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                <Badge label={`${STATUS_ICON[result.status]} ${STATUS_LABEL[result.status]}`} color={STATUS_COLOR[result.status]} bg={STATUS_COLOR[result.status] + "22"} />
                <Badge label={`${result.priority} · ₹${result.fee} paid`} color="#6366f1" bg="#ede9fe" />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {result.fragile && <Badge label="🫗 Fragile" color="#7c3aed" bg="#ede9fe" />}
              {result.cold && <Badge label="❄️ Temp sensitive" color="#2563eb" bg="#dbeafe" />}
              {result.insure && <Badge label="🛡️ Insured" color="#16a34a" bg="#dcfce7" />}
            </div>
          </Card>

          {/* Timeline */}
          <Card>
            <h3 style={{ fontWeight: 700, fontSize: 15, marginBottom: 16, color: "#374151" }}>📡 Live tracking</h3>
            <TrackingTimeline delivery={result} />
          </Card>

          {/* Details grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Card>
              <div style={{ fontSize: 11, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>📤 Sender</div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{result.senderName}</div>
              <div style={{ fontSize: 13, color: "#6b7280", marginTop: 3 }}>{result.senderPhone}</div>
              <div style={{ fontSize: 13, color: "#6b7280", marginTop: 3, lineHeight: 1.6 }}>{result.senderAddr}</div>
            </Card>
            <Card>
              <div style={{ fontSize: 11, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>📍 Delivery to</div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{result.recvName}</div>
              <div style={{ fontSize: 13, color: "#6b7280", marginTop: 3 }}>{result.recvPhone}</div>
              <div style={{ fontSize: 13, color: "#6b7280", marginTop: 3, lineHeight: 1.6 }}>{result.recvAddr}{result.recvCity ? ", " + result.recvCity : ""}{result.recvPin ? " – " + result.recvPin : ""}</div>
            </Card>
          </div>

          {result.agentName && (
            <Card style={{ background: "#f8fafc" }}>
              <div style={{ fontSize: 11, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>🛵 Delivery agent</div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 44, height: 44, borderRadius: "50%", background: "#ede9fe", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>🧑</div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{result.agentName}</div>
                  <div style={{ fontSize: 13, color: "#6b7280" }}>{result.agentPhone} · ⭐ {AGENTS.find(a => a.id === result.agentId)?.rating || "4.8"}</div>
                </div>
              </div>
            </Card>
          )}

          {result.instructions && (
            <Card>
              <div style={{ fontSize: 11, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>📝 Delivery instructions</div>
              <div style={{ fontSize: 14, color: "#374151", lineHeight: 1.6 }}>{result.instructions}</div>
            </Card>
          )}

          {result.deliveryTime && (
            <Card>
              <div style={{ fontSize: 11, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>🕐 Preferred time</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>{result.deliveryTime}</div>
            </Card>
          )}

          <div style={{ display: "flex", justifyContent: "center" }}>
            <QRDisplay value={result.code} size={100} />
          </div>
        </div>
      )}

      {!result && !notFound && (
        <div style={{ textAlign: "center", padding: "3rem", color: "#9ca3af" }}>
          <div style={{ fontSize: 56, marginBottom: 12 }}>📦</div>
          <p style={{ fontSize: 15 }}>Enter your tracking code above to view delivery details.</p>
        </div>
      )}
    </div>
  );
}

// ─── Agent panel ──────────────────────────────────────────────────────────────
function AgentPanel({ session, deliveries, advanceStatus, toast }) {
 const agentId = session?.agentId;
 console.log("SESSION:", session);
console.log("DELIVERIES:", deliveries);
  const myDeliveries = deliveries.filter(d => d.agentId === agentId);
  const [scanCode, setScanCode] = useState("");
  const [filter, setFilter] = useState("all");
  const [agentLoading, setAgentLoading] = useState(false);

  const filtered = myDeliveries.filter(d => filter === "all" || d.status === filter);

  const scan = () => {
    const d = myDeliveries.find(x => x.code === scanCode.trim().toUpperCase());
    if (d) { toast(`Found: ${d.itemName} → ${d.recvName}`, "info"); setScanCode(""); }
    else toast("Code not found in your assignments", "error");
  };

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 6 }}>Agent panel</h1>
      <p style={{ color: "#6b7280", marginBottom: 24 }}>Welcome, {session?.name}. Manage your assigned deliveries.</p>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 24 }}>
        {[
          { label: "Assigned", value: myDeliveries.length, color: "#6366f1" },
          { label: "Active", value: myDeliveries.filter(d => d.status !== "delivered").length, color: "#f59e0b" },
          { label: "Delivered", value: myDeliveries.filter(d => d.status === "delivered").length, color: "#22c55e" },
          { label: "Rating", value: (AGENTS.find(a => a.id === agentId)?.rating || 4.8) + "⭐", color: "#f97316" },
        ].map(s => (
          <Card key={s.label} style={{ textAlign: "center", padding: "1rem" }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 12, color: "#9ca3af" }}>{s.label}</div>
          </Card>
        ))}
      </div>

      {/* QR scan */}
      <Card style={{ marginBottom: 20 }}>
        <h3 style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>📷 Quick code lookup</h3>
        <div style={{ display: "flex", gap: 10 }}>
          <input style={{ ...inp, fontFamily: "monospace", letterSpacing: 3, textTransform: "uppercase" }} maxLength={8} value={scanCode} onChange={e => setScanCode(e.target.value.toUpperCase())} placeholder="Enter code" onKeyDown={e => e.key === "Enter" && scan()} />
          <button onClick={scan} style={{ padding: "0 18px", background: "#6366f1", color: "#fff", border: "none", borderRadius: 8, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Look up</button>
        </div>
      </Card>

      {/* Filter */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {[["all", "All"], ...STATUS_FLOW.map(s => [s, STATUS_LABEL[s]])].map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} style={{ padding: "6px 14px", border: `1.5px solid ${filter === k ? "#6366f1" : "#e5e7eb"}`, borderRadius: 999, background: filter === k ? "#ede9fe" : "#fff", color: filter === k ? "#6366f1" : "#6b7280", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>{l}</button>
        ))}
      </div>

     {filtered.length === 0 ? (
  <div
    style={{
      textAlign: "center",
      padding: "3rem 2rem",
      color: "#9ca3af",
      background: "#fafafa",
      borderRadius: 12,
      border: "1px solid #f1f5f9"
    }}
  >
    <div style={{ fontSize: 40, marginBottom: 10 }}>
      🛵
    </div>

    <div
      style={{
        fontWeight: 700,
        fontSize: 15,
        color: "#6b7280"
      }}
    >
      {myDeliveries.length === 0
        ? "No deliveries assigned yet."
        : "No deliveries match this filter."}
    </div>

    <div
      style={{
        fontSize: 13,
        marginTop: 5
      }}
    >
      {myDeliveries.length === 0
        ? "Assigned deliveries will appear here."
        : "Try selecting a different delivery status."}
    </div>
  </div>
) : (
  <div style={{ display: "grid", gap: 12 }}>
    {filtered.map(d => (
      <Card key={d.id}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 12
          }}
        >
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>
              {d.itemName}
            </div>

            <div
              style={{
                fontSize: 12,
                color: "#9ca3af",
                marginTop: 2
              }}
            >
              {d.code} · {fmtDate(d.createdAt)}
            </div>
          </div>

          <Badge
            label={`${STATUS_ICON[d.status]} ${STATUS_LABEL[d.status]}`}
            color={STATUS_COLOR[d.status]}
            bg={STATUS_COLOR[d.status] + "22"}
          />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 8,
            marginBottom: 12,
            fontSize: 13
          }}
        >
          <div>
            <span style={{ color: "#9ca3af" }}>From: </span>
            {d.senderName}
          </div>

          <div>
            <span style={{ color: "#9ca3af" }}>To: </span>
            {d.recvName}
          </div>

          <div style={{ gridColumn: "1/-1" }}>
            <span style={{ color: "#9ca3af" }}>Address: </span>
            {d.recvAddr}
            {d.recvCity ? ", " + d.recvCity : ""}
            {d.recvPin ? " " + d.recvPin : ""}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap"
          }}
        >
          {d.fragile && (
            <Badge
              label="🫗 Fragile"
              color="#7c3aed"
              bg="#ede9fe"
            />
          )}

          {d.cold && (
            <Badge
              label="❄️ Cold"
              color="#2563eb"
              bg="#dbeafe"
            />
          )}
        </div>

        {d.status !== "delivered" && (
          <button
            onClick={() => advanceStatus(d.id)}
            style={{
              marginTop: 12,
              width: "100%",
              padding: "9px",
              background: "#f0fdf4",
              color: "#16a34a",
              border: "1.5px solid #86efac",
              borderRadius: 8,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 13
            }}
          >
            ✅ Mark as:{" "}
            {STATUS_LABEL[
              STATUS_FLOW[
                STATUS_FLOW.indexOf(d.status) + 1
              ]
            ]}
          </button>
        )}

        {d.status === "delivered" && (
          <div
            style={{
              marginTop: 10,
              padding: "8px",
              background: "#dcfce7",
              borderRadius: 8,
              color: "#166534",
              fontSize: 13,
              fontWeight: 600,
              textAlign: "center"
            }}
          >
            ✅ Delivered on{" "}
            {fmtDate(d.deliveredAt || d.createdAt)}
          </div>
        )}
      </Card>
    ))}
  </div>
)}
    </div>
  );
}

// ─── Admin panel ──────────────────────────────────────────────────────────────
function AdminPanel({ deliveries, saveDeliveries, advanceStatus, toast, session }) {
  const [tab, setTab] = useState("overview");
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);

 useEffect(() => {
  if (tab !== "users") return;

  let active = true;
const loadUsers = async () => {
  setUsersLoading(true);

  try {
    const data = await Store.getProfiles();

    if (!Array.isArray(data)) {
      throw new Error("Unable to load registered users.");
    }

    if (active) {
      setUsers(data);
    }

  } catch (error) {
    console.error("Failed to load users:", error);

    if (active) {
      setUsers([]);

      toast(
        error?.message ||
          "Unable to load registered users. Please try again.",
        "error"
      );
    }

  } finally {
    if (active) {
      setUsersLoading(false);
    }
  }
};

  loadUsers();

  return () => {
    active = false;
  };
}, [tab]);

  const totalRevenue = deliveries.filter(d => d.paymentStatus === "paid").reduce((s, d) => s + (d.fee || 0), 0);
  const statusCounts = STATUS_FLOW.reduce((acc, s) => ({ ...acc, [s]: deliveries.filter(d => d.status === s).length }), {});

  const filtered = deliveries.filter(d => {
    const q = search.toLowerCase();
    const matchSearch = !q || d.code?.includes(q.toUpperCase()) || d.itemName?.toLowerCase().includes(q) || d.senderName?.toLowerCase().includes(q) || d.recvName?.toLowerCase().includes(q);
    const matchStatus = filterStatus === "all" || d.status === filterStatus;
    return matchSearch && matchStatus;
  });

 const deleteDelivery = async (id) => {
  if (!window.confirm("Delete this delivery?")) return;

  try {
    if (!id) {
      toast("Invalid delivery.", "error");
      return;
    }

    const success = await Store.deleteDeliveryRow(id);

    if (!success) {
      toast(
        "Failed to delete delivery. Please try again.",
        "error"
      );
      return;
    }

    const updated = deliveries.filter(d => d.id !== id);
    saveDeliveries(updated);

    toast("Delivery deleted successfully.", "info");

  } catch (error) {
    console.error("Admin delete delivery failed:", error);

    toast(
      error?.message ||
        "Unable to delete delivery. Please try again.",
      "error"
    );
  }
};

  const tabs = ["overview", "deliveries", "agents", "users"];

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800 }}>Admin panel</h1>
          <p style={{ color: "#6b7280", fontSize: 14 }}>Full control over all deliveries, agents, and users.</p>
        </div>
        <div style={{ background: "#fee2e2", color: "#dc2626", padding: "4px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700 }}>🔑 Admin</div>
      </div>

      <div style={{ display: "flex", gap: 6, borderBottom: "1.5px solid #e5e7eb", marginBottom: 24 }}>
        {tabs.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: "8px 18px", border: "none", background: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 14, fontWeight: 600, color: tab === t ? "#6366f1" : "#9ca3af", borderBottom: `3px solid ${tab === t ? "#6366f1" : "transparent"}`, marginBottom: -2 }}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 14, marginBottom: 24 }}>
            {[
              { label: "Total deliveries", value: deliveries.length, icon: "📦", color: "#6366f1", bg: "#ede9fe" },
              { label: "Revenue collected", value: "₹" + totalRevenue.toLocaleString("en-IN"), icon: "💰", color: "#16a34a", bg: "#dcfce7" },
              { label: "Active deliveries", value: deliveries.filter(d => d.status !== "delivered").length, icon: "🚚", color: "#f59e0b", bg: "#fef3c7" },
              { label: "Delivered", value: statusCounts.delivered || 0, icon: "✅", color: "#22c55e", bg: "#dcfce7" },
            ].map(s => (
              <Card key={s.label} style={{ textAlign: "center" }}>
                <div style={{ width: 40, height: 40, background: s.bg, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, margin: "0 auto 10px" }}>{s.icon}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>{s.label}</div>
              </Card>
            ))}
          </div>

          {/* Status breakdown */}
          <Card style={{ marginBottom: 20 }}>
            <h3 style={{ fontWeight: 700, fontSize: 15, marginBottom: 16 }}>Status breakdown</h3>
            {STATUS_FLOW.map(s => {
              const count = statusCounts[s] || 0;
              const pct = deliveries.length ? Math.round((count / deliveries.length) * 100) : 0;
              return (
                <div key={s} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                    <span>{STATUS_ICON[s]} {STATUS_LABEL[s]}</span>
                    <span style={{ color: "#9ca3af" }}>{count} ({pct}%)</span>
                  </div>
                  <div style={{ background: "#f3f4f6", borderRadius: 999, height: 8 }}>
                    <div style={{ width: pct + "%", background: STATUS_COLOR[s], borderRadius: 999, height: 8, transition: "width .5s" }} />
                  </div>
                </div>
              );
            })}
          </Card>

          {/* Agent performance */}
          <Card>
            <h3 style={{ fontWeight: 700, fontSize: 15, marginBottom: 16 }}>Agent performance</h3>
            {AGENTS.map(a => {
              const assigned = deliveries.filter(d => d.agentId === a.id).length;
              const done = deliveries.filter(d => d.agentId === a.id && d.status === "delivered").length;
              return (
                <div key={a.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #f3f4f6" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 36, height: 36, background: "#ede9fe", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🧑</div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{a.name}</div>
                      <div style={{ fontSize: 12, color: "#9ca3af" }}>{a.phone}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right", fontSize: 12 }}>
                    <div style={{ fontWeight: 600, color: "#6366f1" }}>{assigned} assigned</div>
                    <div style={{ color: "#22c55e" }}>{done} delivered · ⭐{a.rating}</div>
                  </div>
                </div>
              );
            })}
          </Card>
        </div>
      )}

      {tab === "deliveries" && (
        <div>
          <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
            <input style={{ ...inp, maxWidth: 280, flex: 1 }} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by code, item, sender, receiver..." />
            <select style={{ ...inp, width: "auto" }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="all">All statuses</option>
              {STATUS_FLOW.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </div>
          <div style={{ fontSize: 13, color: "#9ca3af", marginBottom: 12 }}>{filtered.length} deliveries</div>
         {filtered.length === 0 ? (
  <div
    style={{
      textAlign: "center",
      padding: "3rem 2rem",
      color: "#9ca3af",
      background: "#fafafa",
      borderRadius: 12,
      border: "1px solid #f1f5f9"
    }}
  >
    <div style={{ fontSize: 40, marginBottom: 10 }}>📦</div>

    <div
      style={{
        fontWeight: 700,
        fontSize: 15,
        color: "#6b7280"
      }}
    >
      {deliveries.length === 0
        ? "No deliveries yet."
        : "No deliveries match your search or filter."}
    </div>

    <div
      style={{
        fontSize: 13,
        marginTop: 5
      }}
    >
      {deliveries.length === 0
        ? "New delivery bookings will appear here."
        : "Try changing your search or status filter."}
    </div>
  </div>
) : (
            <div style={{ display: "grid", gap: 10 }}>
              {filtered.map(d => (
                <Card key={d.id}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{d.itemName} <span style={{ color: "#9ca3af", fontFamily: "monospace", fontWeight: 400, fontSize: 12 }}>{d.code}</span></div>
                      <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>From {d.senderName} → {d.recvName} · {d.recvCity || "—"} · {fmtDate(d.createdAt)}</div>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      <Badge label={`${STATUS_ICON[d.status]} ${STATUS_LABEL[d.status]}`} color={STATUS_COLOR[d.status]} bg={STATUS_COLOR[d.status] + "22"} />
                      <Badge label={`₹${d.fee}`} color="#16a34a" bg="#dcfce7" />
                      {d.status !== "delivered" && (
                        <button onClick={() => advanceStatus(d.id)} style={{ padding: "4px 10px", background: "#ede9fe", color: "#6366f1", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Next status ↑</button>
                      )}
                      <button onClick={() => deleteDelivery(d.id)} style={{ padding: "4px 10px", background: "#fee2e2", color: "#dc2626", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Delete</button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

     {tab === "agents" && (
  <div style={{ display: "grid", gap: 14 }}>
    {AGENTS.length === 0 ? (
      <div
        style={{
          textAlign: "center",
          padding: "2rem",
          color: "#9ca3af"
        }}
      >
        <div style={{ fontSize: 32, marginBottom: 8 }}>🧑‍💼</div>

        <div
          style={{
            fontWeight: 600,
            color: "#6b7280"
          }}
        >
          No delivery agents available.
        </div>

        <div
          style={{
            fontSize: 13,
            marginTop: 4
          }}
        >
          Delivery agents will appear here when they are added.
        </div>
      </div>
    ) : (
      AGENTS.map(a => {
        const all = deliveries.filter(
          d => d.agentId === a.id
        );

        const done = all.filter(
          d => d.status === "delivered"
        ).length;

        return (
          <Card key={a.id}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center"
              }}
            >
              <div
                style={{
                  display: "flex",
                  gap: 14,
                  alignItems: "center"
                }}
              >
                <div
                  style={{
                    width: 52,
                    height: 52,
                    background: "#ede9fe",
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 24
                  }}
                >
                  🧑
                </div>

                <div>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 16
                    }}
                  >
                    {a.name}
                  </div>

                  <div
                    style={{
                      fontSize: 13,
                      color: "#6b7280"
                    }}
                  >
                    {a.phone}
                  </div>
                </div>
              </div>

              <div style={{ textAlign: "right" }}>
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 800,
                    color: "#6366f1"
                  }}
                >
                  {all.length}
                </div>

                <div
                  style={{
                    fontSize: 12,
                    color: "#9ca3af"
                  }}
                >
                  assigned
                </div>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3,1fr)",
                gap: 10,
                marginTop: 14
              }}
            >
              {[
                {
                  l: "Delivered",
                  v: done,
                  c: "#22c55e"
                },
                {
                  l: "Active",
                  v: all.length - done,
                  c: "#f59e0b"
                },
                {
                  l: "Rating",
                  v: "⭐ " + a.rating,
                  c: "#f97316"
                }
              ].map(s => (
                <div
                  key={s.l}
                  style={{
                    background: "#f8fafc",
                    borderRadius: 8,
                    padding: "8px 12px",
                    textAlign: "center"
                  }}
                >
                  <div
                    style={{
                      fontWeight: 700,
                      color: s.c
                    }}
                  >
                    {s.v}
                  </div>

                  <div
                    style={{
                      fontSize: 11,
                      color: "#9ca3af"
                    }}
                  >
                    {s.l}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        );
      })
    )}
  </div>
)}

      {tab === "users" && (
        <div>
          <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 16 }}>Registered users, live from Supabase.</p>
      {usersLoading ? (
  <div
    style={{
      textAlign: "center",
      padding: "3rem 2rem",
      color: "#9ca3af"
    }}
  >
    <div style={{ fontSize: 32, marginBottom: 10 }}>⏳</div>

    <div
      style={{
        fontWeight: 600,
        color: "#6b7280"
      }}
    >
      Loading registered users...
    </div>

    <div
      style={{
        fontSize: 13,
        marginTop: 4
      }}
    >
      Please wait while we fetch users from Supabase.
    </div>
  </div>
) : users.length === 0 ? (
  <div
    style={{
      textAlign: "center",
      padding: "2rem",
      color: "#9ca3af"
    }}
  >
    <div style={{ fontSize: 32, marginBottom: 8 }}>👥</div>

    <div
      style={{
        fontWeight: 600,
        color: "#6b7280"
      }}
    >
      No registered users yet.
    </div>

    <div
      style={{
        fontSize: 13,
        marginTop: 4
      }}
    >
      New users will appear here after they create an account.
    </div>
  </div>
) : (
  users.map(u => (
    <Card key={u.id} style={{ marginBottom: 10 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center"
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center"
          }}
        >
          <div
            style={{
              width: 38,
              height: 38,
              background: "#ede9fe",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
              fontSize: 14,
              color: "#6366f1"
            }}
          >
            {u.name?.[0] || "U"}
          </div>

          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>
              {u.name}
            </div>

            <div
              style={{
                fontSize: 12,
                color: "#9ca3af"
              }}
            >
              {u.email} · {fmtDate(u.createdAt)}
            </div>
          </div>
        </div>

        <Badge
          label={u.role}
          color={
            u.role === "admin"
              ? "#dc2626"
              : u.role === "agent"
                ? "#f59e0b"
                : "#6366f1"
          }
          bg={
            u.role === "admin"
              ? "#fee2e2"
              : u.role === "agent"
                ? "#fef3c7"
                : "#ede9fe"
          }
        />
      </div>
    </Card>
  ))
)}
      
        </div>
      )}
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
// ─── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard({ session, deliveries, setPage }) {

  let myDeliveries = [];

  if (session?.role === "sender") {
    // Sender sees deliveries created by them
    myDeliveries = deliveries.filter(
      d => d.senderId === session?.id
    );

 } else if (session?.role === "receiver") {
  // New deliveries use receiverId
  // Old deliveries still use receiver email
  myDeliveries = deliveries.filter(
    d =>
      d.receiverId === session?.id ||
      (
        !d.receiverId &&
        d.recvEmail?.toLowerCase() === session?.email?.toLowerCase()
      )
  );

  } else if (session?.role === "admin") {
    // Admin sees all deliveries
    myDeliveries = deliveries;

  } else if (session?.role === "agent") {
    // Agent sees only assigned deliveries
    myDeliveries = deliveries.filter(
      d => d.agentId === session?.agentId
    );
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 20 }}>
        My dashboard
      </h1>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3,1fr)",
          gap: 14,
          marginBottom: 24
        }}
      >
        {[
          {
            label: session?.role === "sender" ? "Sent" : "Total deliveries",
            value: myDeliveries.length,
            color: "#6366f1"
          },
          {
            label: "In transit",
            value: myDeliveries.filter(d =>
              ["in_transit", "out_for_delivery"].includes(d.status)
            ).length,
            color: "#f59e0b"
          },
          {
            label: "Delivered",
            value: myDeliveries.filter(
              d => d.status === "delivered"
            ).length,
            color: "#22c55e"
          }
        ].map(s => (
          <Card key={s.label} style={{ textAlign: "center" }}>
            <div
              style={{
                fontSize: 26,
                fontWeight: 800,
                color: s.color
              }}
            >
              {s.value}
            </div>

            <div
              style={{
                fontSize: 12,
                color: "#9ca3af",
                marginTop: 3
              }}
            >
              {s.label}
            </div>
          </Card>
        ))}
      </div>

      <HistoryPage
        session={session}
        deliveries={myDeliveries}
        setPage={setPage}
      />
    </div>
  );
}

// ─── History page ─────────────────────────────────────────────────────────────
function HistoryPage({ session, deliveries, setPage }) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
 let myDeliveries = [];

if (!session) {
  myDeliveries = deliveries;

} else if (session.role === "sender") {
  myDeliveries = deliveries.filter(
    d => d.senderId === session.id
  );

} else if (session.role === "receiver") {
  myDeliveries = deliveries.filter(
    d => d.recvEmail?.toLowerCase() === session.email?.toLowerCase()
  );

} else if (session.role === "agent") {
  myDeliveries = deliveries.filter(
    d => d.agentId === session.agentId
  );

} else if (session.role === "admin") {
  myDeliveries = deliveries;
}
  const filtered = myDeliveries.filter(d => {
    const q = search.toLowerCase();
    const ms = !q || d.itemName?.toLowerCase().includes(q) || d.code?.includes(q.toUpperCase()) || d.recvName?.toLowerCase().includes(q);
    const mf = filter === "all" || d.status === filter;
    return ms && mf;
  });

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 20 }}>Delivery history</h1>
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <input style={{ ...inp, maxWidth: 260, flex: 1 }} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." />
        <select style={{ ...inp, width: "auto" }} value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="all">All</option>
          {STATUS_FLOW.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </div>
      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "3rem", color: "#9ca3af" }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>📭</div>
          <p>{myDeliveries.length === 0 ? "No deliveries yet." : "No results match your filter."}</p>
          {myDeliveries.length === 0 && <button onClick={() => setPage("send")} style={{ marginTop: 12, padding: "10px 20px", background: "#6366f1", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Send your first package</button>}
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {filtered.map(d => (
            <Card key={d.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{d.itemName}</div>
                  <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>
                    <span style={{ fontFamily: "monospace" }}>{d.code}</span> · To {d.recvName} · {fmtDate(d.createdAt)}
                  </div>
                  {d.recvCity && <div style={{ fontSize: 12, color: "#6b7280", marginTop: 1 }}>📍 {d.recvCity}{d.recvPin ? " – " + d.recvPin : ""}</div>}
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <Badge label={`${STATUS_ICON[d.status]} ${STATUS_LABEL[d.status]}`} color={STATUS_COLOR[d.status]} bg={STATUS_COLOR[d.status] + "22"} />
                  <Badge label={`₹${d.fee}`} color="#16a34a" bg="#dcfce7" />
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                {d.fragile && <Badge label="🫗 Fragile" color="#7c3aed" bg="#ede9fe" />}
                {d.cold && <Badge label="❄️ Cold" color="#2563eb" bg="#dbeafe" />}
                {d.insure && <Badge label="🛡️ Insured" color="#16a34a" bg="#dcfce7" />}
                <Badge label={d.priority} color="#6366f1" bg="#ede9fe" />
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Reset Password page ─────────────────────────────────────────────────────
function ResetPasswordPage({ setPage, toast }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleResetPassword = async () => {
    if (busy) return;

    setErr("");

    if (!password || !confirmPassword) {
      setErr("Please enter both password fields.");
      return;
    }

    if (password.length < 6) {
      setErr("Password must be at least 6 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setErr("Passwords do not match.");
      return;
    }

    setBusy(true);

    const { error } = await sb.auth.updateUser({
      password: password
    });

    setBusy(false);

    if (error) {
      setErr(error.message || "Could not update password.");
      return;
    }

    setSuccess(true);
    toast("Password updated successfully! 🔐", "success");
  };

  if (success) {
    return (
      <div style={{ maxWidth: 420, margin: "2rem auto" }}>
        <Card>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 42, marginBottom: 10 }}>✅</div>

            <h2 style={{ fontWeight: 800, fontSize: 22, marginBottom: 8 }}>
              Password updated
            </h2>

            <p style={{ color: "#6b7280", fontSize: 13, marginBottom: 22 }}>
              Your SwiftDeliver password has been changed successfully.
            </p>

            <button
              onClick={() => setPage("login")}
              style={{
                width: "100%",
                padding: 12,
                background: "linear-gradient(135deg,#6366f1,#8b5cf6)",
                color: "#fff",
                border: "none",
                borderRadius: 10,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 15
              }}
            >
              Back to Login
            </button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 420, margin: "2rem auto" }}>
      <Card>
        <h2 style={{ fontWeight: 800, fontSize: 22, marginBottom: 4 }}>
          Reset password
        </h2>

        <p style={{ color: "#6b7280", fontSize: 13, marginBottom: 24 }}>
          Enter a new password for your SwiftDeliver account.
        </p>

        {err && (
          <div
            style={{
              background: "#fee2e2",
              color: "#991b1b",
              padding: "10px 14px",
              borderRadius: 8,
              fontSize: 13,
              marginBottom: 16
            }}
          >
            {err}
          </div>
        )}

        <Field label="New password">
          <input
            style={inp}
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Min 6 characters"
          />
        </Field>

        <Field label="Confirm new password">
          <input
            style={inp}
            type="password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            placeholder="Enter password again"
          />
        </Field>

        <button
          onClick={handleResetPassword}
          disabled={busy}
          style={{
            width: "100%",
            padding: 12,
            background: "linear-gradient(135deg,#6366f1,#8b5cf6)",
            color: "#fff",
            border: "none",
            borderRadius: 10,
            fontWeight: 700,
            cursor: busy ? "default" : "pointer",
            opacity: busy ? .7 : 1,
            fontFamily: "inherit",
            fontSize: 15,
            marginBottom: 12
          }}
        >
          {busy ? "Updating…" : "Update password"}
        </button>

        <div style={{ textAlign: "center", fontSize: 13 }}>
          <button
            onClick={() => setPage("login")}
            style={{
              background: "none",
              border: "none",
              color: "#6366f1",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 13
            }}
          >
            Back to Login
          </button>
        </div>
      </Card>
    </div>
  );
}

// ─── Login page ───────────────────────────────────────────────────────────────
function LoginPage({ login, setPage, toast }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const handleLogin = async () => {
  if (busy) return;

  setErr("");
  setBusy(true);

  try {
    const { user, error } = await Store.signIn(
      email.trim().toLowerCase(),
      password
    );

    if (error) {
      setErr(error.message || "Invalid email or password.");
      return;
    }

    if (!user?.id) {
      setErr("Login succeeded, but user information could not be loaded.");
      return;
    }

    const profile = await Store.getProfile(user.id);

    if (!profile) {
      setErr("Signed in, but couldn't load your profile.");
      return;
    }

    login(profile);
    setPage("home");

  } catch (error) {
    console.error("Login error:", error);

    setErr(
      error?.message ||
      "Unable to log in right now. Please check your internet connection and try again."
    );
  } finally {
    setBusy(false);
  }
};
 const handleForgotPassword = async () => {
  if (busy) return;

  const normalizedEmail = email.trim().toLowerCase();

  if (!normalizedEmail) {
    setErr("Please enter your email address first.");
    return;
  }

  setErr("");
  setBusy(true);

  try {
    const { error } = await Store.resetPassword(normalizedEmail);

    if (error) {
      setErr(
        error.message || "Could not send password reset email."
      );
      return;
    }

    toast(
      "Password reset link sent! Check your email. 📧",
      "success"
    );

  } catch (error) {
    console.error("Password reset error:", error);

    setErr(
      error?.message ||
      "Unable to send the password reset email right now. Please check your internet connection and try again."
    );
  } finally {
    setBusy(false);
  }
};

  

  return (
    <div style={{ maxWidth: 420, margin: "2rem auto" }}>
      <Card>
        <h2 style={{ fontWeight: 800, fontSize: 22, marginBottom: 4 }}>Log in</h2>
        <p style={{ color: "#6b7280", fontSize: 13, marginBottom: 24 }}>Welcome back to SwiftDeliver.</p>
        {err && <div style={{ background: "#fee2e2", color: "#991b1b", padding: "10px 14px", borderRadius: 8, fontSize: 13, marginBottom: 16 }}>{err}</div>}
        <Field label="Email">
          <input style={inp} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" onKeyDown={e => e.key === "Enter" && handleLogin()} />
        </Field>
        <Field label="Password">
          <input style={inp} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" onKeyDown={e => e.key === "Enter" && handleLogin()} />
        </Field>
        <div style={{ textAlign: "right", marginTop: -8, marginBottom: 14 }}>
  <button
    onClick={handleForgotPassword}
    disabled={busy}
    style={{
      background: "none",
      border: "none",
      color: "#6366f1",
      fontWeight: 600,
      cursor: busy ? "default" : "pointer",
      fontFamily: "inherit",
      fontSize: 12,
      padding: 0
    }}
  >
    Forgot password?
  </button>
</div>
        <button onClick={handleLogin} disabled={busy} style={{ width: "100%", padding: 12, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? .7 : 1, fontFamily: "inherit", fontSize: 15, marginBottom: 14 }}>{busy ? "Logging in…" : "Log in"}</button>
        <div style={{ textAlign: "center", fontSize: 13, color: "#9ca3af", marginBottom: 16 }}>Don't have an account? <button onClick={() => setPage("register")} style={{ background: "none", border: "none", color: "#6366f1", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}>Sign up</button></div>

       
      </Card>
    </div>
  );
}

// ─── Register page ────────────────────────────────────────────────────────────
function RegisterPage({ login, setPage, toast }) {
  const [form, setF] = useState({ name: "", email: "", password: "", role: "sender" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const handleRegister = async () => {
  if (busy) return;

  const name = form.name.trim();
  const email = form.email.trim().toLowerCase();

  if (!name || !email || !form.password) {
    setErr("All fields required.");
    return;
  }

  if (form.password.length < 6) {
    setErr("Password must be at least 6 characters.");
    return;
  }

  setErr("");
  setBusy(true);

  try {
    const { user, error } = await Store.signUp(
      name,
      email,
      form.password,
      form.role
    );

    if (error) {
      setErr(error.message || "Could not create account.");
      return;
    }

    if (user) {
      setPage("login");

      toast(
        "Account created! Please check your email and verify your account before logging in. 📧",
        "success"
      );

      return;
    }

    setErr(
      "Account created. Please check your email to verify your account."
    );

  } catch (error) {
    console.error("Registration error:", error);

    setErr(
      error?.message ||
      "Unable to create your account right now. Please check your internet connection and try again."
    );
  } finally {
    setBusy(false);
  }
};
  return (
    <div style={{ maxWidth: 420, margin: "2rem auto" }}>
      <Card>
        <h2 style={{ fontWeight: 800, fontSize: 22, marginBottom: 4 }}>Create account</h2>
        <p style={{ color: "#6b7280", fontSize: 13, marginBottom: 24 }}>Join SwiftDeliver today.</p>
        {err && <div style={{ background: "#fee2e2", color: "#991b1b", padding: "10px 14px", borderRadius: 8, fontSize: 13, marginBottom: 16 }}>{err}</div>}
        <Field label="Full name"><input style={inp} value={form.name} onChange={e => setF(p => ({ ...p, name: e.target.value }))} placeholder="Your full name" /></Field>
        <Field label="Email"><input style={inp} type="email" value={form.email} onChange={e => setF(p => ({ ...p, email: e.target.value }))} placeholder="you@example.com" /></Field>
        <Field label="Password"><input style={inp} type="password" value={form.password} onChange={e => setF(p => ({ ...p, password: e.target.value }))} placeholder="Min 6 characters" /></Field>
        <Field label="Role">
          <select style={inp} value={form.role} onChange={e => setF(p => ({ ...p, role: e.target.value }))}>
            <option value="sender">Sender</option>
            <option value="receiver">Receiver</option>
            <option value="agent">Agent</option>
          </select>
        </Field>
        <button onClick={handleRegister} disabled={busy} style={{ width: "100%", padding: 12, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? .7 : 1, fontFamily: "inherit", fontSize: 15, marginBottom: 12 }}>{busy ? "Creating…" : "Create account"}</button>
        <div style={{ textAlign: "center", fontSize: 13, color: "#9ca3af" }}>Already have an account? <button onClick={() => setPage("login")} style={{ background: "none", border: "none", color: "#6366f1", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}>Log in</button></div>
      </Card>
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────
function Modal({ modal, setModal }) {
  if (!modal) return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: "2rem", maxWidth: 480, width: "100%", position: "relative" }}>
        <button onClick={() => setModal(null)} style={{ position: "absolute", top: 14, right: 14, background: "#f3f4f6", border: "none", borderRadius: "50%", width: 30, height: 30, cursor: "pointer", fontSize: 16, color: "#6b7280" }}>×</button>
        {modal.type === "delivery" && modal.data && (
          <div>
            <h3 style={{ fontWeight: 800, fontSize: 18, marginBottom: 16 }}>{modal.data.itemName}</h3>
            <TrackingTimeline delivery={modal.data} />
          </div>
        )}
      </div>
    </div>
  );
}


// === PART 2: EXTENDED FEATURES ===
// ══════════════════════════════════════════════════════════════════════════════
// SwiftDeliver — Extended Features Module
// Includes: Notifications, Invoice PDF, Ratings, Disputes, Analytics Charts,
//           Settings/Profile, Delivery ETA calculator, COD tracker,
//           Bulk booking, Route map, Export CSV, Feedback system
// ══════════════════════════════════════════════════════════════════════════════


// ─── Primitives shared from Part 1 above ─────────────────────────────────

// ══════════════════════════════════════════════════════════════════════════════
// 1. NOTIFICATIONS CENTER
function NotificationsPage// ══════════════════════════════════════════════════════════════════════════════
({ deliveries, session }) {
  const notifications = generateNotifications(deliveries, session);
  const [filter, setFilter] = useState("all");
  const [read, setRead] = useState(() => {
    try { return JSON.parse(localStorage.getItem("sd_read_notifs")) || []; } catch { return []; }
  });

  const markRead = (id) => {
    const updated = [...new Set([...read, id])];
    setRead(updated);
    localStorage.setItem("sd_read_notifs", JSON.stringify(updated));
  };
  const markAllRead = () => {
    const ids = notifications.map(n => n.id);
    setRead(ids);
    localStorage.setItem("sd_read_notifs", JSON.stringify(ids));
  };

  const filtered = notifications.filter(n => filter === "all" || n.type === filter);
  const unread = notifications.filter(n => !read.includes(n.id)).length;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>Notifications</h1>
          {unread > 0 && <div style={{ fontSize: 13, color: "#6b7280" }}>{unread} unread</div>}
        </div>
        {unread > 0 && (
          <button onClick={markAllRead} style={{ padding: "6px 14px", background: "#f3f4f6", border: "none", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", color: "#374151", fontFamily: "inherit" }}>
            Mark all read
          </button>
        )}
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {[["all", "All"], ["status", "Status updates"], ["payment", "Payments"], ["system", "System"]].map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} style={{ padding: "5px 12px", border: `1.5px solid ${filter === k ? "#6366f1" : "#e5e7eb"}`, borderRadius: 999, background: filter === k ? "#ede9fe" : "#fff", color: filter === k ? "#6366f1" : "#6b7280", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>{l}</button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "3rem", color: "#9ca3af" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🔔</div>
          <p>No notifications yet.</p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {filtered.map(n => (
            <div key={n.id} onClick={() => markRead(n.id)} style={{ background: read.includes(n.id) ? "#fff" : "#f8f7ff", border: `1px solid ${read.includes(n.id) ? "#e5e7eb" : "#c7d2fe"}`, borderRadius: 10, padding: "12px 14px", cursor: "pointer", display: "flex", gap: 12, alignItems: "flex-start" }}>
              <div style={{ fontSize: 22, flexShrink: 0 }}>{n.icon}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: read.includes(n.id) ? 500 : 700, fontSize: 13, color: "#111", marginBottom: 2 }}>{n.title}</div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>{n.body}</div>
                <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>{fmt(n.at)}</div>
              </div>
              {!read.includes(n.id) && <div style={{ width: 8, height: 8, background: "#6366f1", borderRadius: "50%", flexShrink: 0, marginTop: 4 }} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
function generateNotifications(deliveries, session) {
  if (!session) return [];

  const notifs = [];

  // Show only deliveries related to the logged-in user
  const userDeliveries = deliveries.filter(d => {

    // Admin can see everything
    if (session.role === "admin") return true;

    // Sender sees their own deliveries
    if (d.senderId === session.id) return true;

    // Receiver sees deliveries sent to their email
    if (
      session.role === "receiver" &&
      d.recvEmail &&
      session.email &&
      d.recvEmail.toLowerCase() === session.email.toLowerCase()
    ) {
      return true;
    }

    // Agent sees deliveries assigned to their agent ID
if (
  session.role === "agent" &&
  d.agentId &&
  session.agentId &&
  d.agentId === session.agentId
) {
  return true;
}
    return false;
  });

  userDeliveries.forEach(d => {

    // 📦 Booking notification
    notifs.push({
      id: `bk-${d.id}`,
      type: "status",
      icon: "📦",
      title: "Delivery booked",
      body: `${d.itemName} booked successfully. Code: ${d.code}`,
      at: d.createdAt
    });

    // 💳 Payment notification
    if (d.paymentStatus === "paid") {
      notifs.push({
        id: `py-${d.id}`,
        type: "payment",
        icon: "💳",
        title: "Payment confirmed",
        body: `₹${d.fee} received for delivery ${d.code}`,
        at: d.createdAt
      });
    }

    // 🚚 Status update notifications
    (d.timeline || [])
      .filter(t => t.status !== "booked")
      .forEach(t => {

        notifs.push({
          id: `tl-${d.id}-${t.status}`,
          type: "status",
          icon: STATUS_ICON[t.status] || "📦",
          title: `Status: ${STATUS_LABEL[t.status] || t.status}`,
          body: `${d.itemName} (${d.code}) — ${
            t.note || "Delivery status updated"
          }`,
          at: t.at
        });

      });

    // 🎉 Delivered notification
    if (d.status === "delivered") {

      notifs.push({
        id: `dl-${d.id}`,
        type: "system",
        icon: "🎉",
        title: "Delivered successfully!",
        body: `${d.itemName} has been successfully delivered.`,
        at: d.deliveredAt || d.updatedAt || d.createdAt
      });

    }

  });

  return notifs
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 50);
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. INVOICE GENERATOR
// ══════════════════════════════════════════════════════════════════════════════
function InvoicePage({ delivery }) {
  if (!delivery) return <div style={{ textAlign: "center", padding: "3rem", color: "#9ca3af" }}>No delivery selected.</div>;

  const printInvoice = () => window.print();

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h2 style={{ fontWeight: 800, fontSize: 20 }}>Invoice</h2>
        <button onClick={printInvoice} style={{ padding: "8px 18px", background: "#6366f1", color: "#fff", border: "none", borderRadius: 8, fontWeight: 600, cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>🖨️ Print / Save PDF</button>
      </div>

      <Card style={{ maxWidth: 620, margin: "0 auto" }} id="invoice-print">
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, paddingBottom: 20, borderBottom: "2px solid #e5e7eb" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <div style={{ width: 30, height: 30, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🚀</div>
              <span style={{ fontWeight: 800, fontSize: 18, color: "#111" }}>SwiftDeliver</span>
            </div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>swiftdeliver.in · support@swiftdeliver.in</div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>GSTIN: 27AABCS1429B1Z2</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: "#6366f1" }}>INVOICE</div>
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 3 }}>INV-{delivery.code}</div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>Date: {fmtDate(delivery.createdAt)}</div>
            <div style={{ marginTop: 6 }}><Badge label={delivery.paymentStatus === "paid" ? "✅ PAID" : "⏳ PENDING"} color={delivery.paymentStatus === "paid" ? "#16a34a" : "#d97706"} bg={delivery.paymentStatus === "paid" ? "#dcfce7" : "#fef3c7"} /></div>
          </div>
        </div>

        {/* Addresses */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 11, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Bill From (Sender)</div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{delivery.senderName}</div>
            <div style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.7 }}>{delivery.senderPhone}<br />{delivery.senderAddr}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Ship To (Receiver)</div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{delivery.recvName}</div>
            <div style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.7 }}>{delivery.recvPhone}<br />{delivery.recvAddr}{delivery.recvCity ? ", " + delivery.recvCity : ""}{delivery.recvPin ? " – " + delivery.recvPin : ""}</div>
          </div>
        </div>

        {/* Line items */}
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 20 }}>
          <thead>
            <tr style={{ background: "#f8fafc" }}>
              {["Description", "Category", "Qty", "Weight", "Amount"].map(h => (
                <th key={h} style={{ textAlign: "left", padding: "8px 10px", fontSize: 11, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, borderBottom: "1px solid #e5e7eb" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: "10px 10px", fontSize: 13, borderBottom: "1px solid #f3f4f6" }}>{delivery.itemName}</td>
              <td style={{ padding: "10px 10px", fontSize: 13, color: "#6b7280", borderBottom: "1px solid #f3f4f6" }}>{delivery.category}</td>
              <td style={{ padding: "10px 10px", fontSize: 13, borderBottom: "1px solid #f3f4f6" }}>{delivery.qty || 1}</td>
              <td style={{ padding: "10px 10px", fontSize: 13, color: "#6b7280", borderBottom: "1px solid #f3f4f6" }}>{delivery.weight ? delivery.weight + " kg" : "—"}</td>
              <td style={{ padding: "10px 10px", fontSize: 13, fontWeight: 600, borderBottom: "1px solid #f3f4f6" }}>₹{delivery.fee}</td>
            </tr>
            {delivery.insure && (
              <tr>
                <td colSpan={4} style={{ padding: "10px 10px", fontSize: 13, color: "#6b7280", borderBottom: "1px solid #f3f4f6" }}>Insurance coverage</td>
                <td style={{ padding: "10px 10px", fontSize: 13, fontWeight: 600, borderBottom: "1px solid #f3f4f6" }}>₹0</td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Totals */}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <div style={{ minWidth: 200 }}>
            {[["Subtotal", `₹${delivery.fee}`], ["GST (18%)", `₹${Math.round(delivery.fee * 0.18)}`], ["Total", `₹${Math.round(delivery.fee * 1.18)}`]].map(([l, v], i) => (
              <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: i === 2 ? 15 : 13, fontWeight: i === 2 ? 800 : 400, color: i === 2 ? "#6366f1" : "#374151", borderTop: i === 2 ? "2px solid #e5e7eb" : "none", marginTop: i === 2 ? 4 : 0, paddingTop: i === 2 ? 8 : 4 }}>
                <span>{l}</span><span>{v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={{ marginTop: 28, paddingTop: 16, borderTop: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 2 }}>Tracking code</div>
            <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 16, letterSpacing: 3, color: "#6366f1" }}>{delivery.code}</div>
          </div>
          <div style={{ textAlign: "right", fontSize: 11, color: "#9ca3af" }}>
            <div>Priority: {delivery.priority}</div>
            <div>Agent: {delivery.agentName || "—"}</div>
            <div>Payment: {delivery.paymentMethod || "Razorpay"}</div>
          </div>
        </div>

        <div style={{ marginTop: 20, fontSize: 11, color: "#9ca3af", textAlign: "center" }}>
          Thank you for using SwiftDeliver! For support: support@swiftdeliver.in · 1800-123-4567
        </div>
      </Card>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. DELIVERY RATING SYSTEM
// ══════════════════════════════════════════════════════════════════════════════
function RatingPage({ delivery, onSubmit }) {
  const [stars, setStars] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [tags, setTags] = useState([]);
  const [submitted, setSubmitted] = useState(!!delivery?.rating);
  const TAGS = ["Fast delivery", "Handled with care", "Agent was polite", "On time", "Good packaging", "Easy tracking"];

  const submit = () => {
    if (stars === 0) return;
    onSubmit({ stars, comment, tags });
    setSubmitted(true);
  };

  if (submitted) return (
    <Card style={{ textAlign: "center", padding: "2rem" }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>🌟</div>
      <h3 style={{ fontWeight: 800, fontSize: 18, marginBottom: 6 }}>Thank you for your feedback!</h3>
      <p style={{ color: "#6b7280", fontSize: 13 }}>Your rating helps us improve the service.</p>
      {delivery?.rating && (
        <div style={{ marginTop: 14, display: "flex", justifyContent: "center", gap: 4 }}>
          {[1, 2, 3, 4, 5].map(s => <span key={s} style={{ fontSize: 24, color: s <= delivery.rating.stars ? "#f59e0b" : "#e5e7eb" }}>★</span>)}
        </div>
      )}
    </Card>
  );

  return (
    <Card>
      <h3 style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>Rate your delivery</h3>
      <p style={{ color: "#6b7280", fontSize: 13, marginBottom: 20 }}>{delivery?.itemName} → {delivery?.recvName}</p>

      {/* Stars */}
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 10 }}>How was your experience?</div>
        <div style={{ display: "flex", justifyContent: "center", gap: 6 }}>
          {[1, 2, 3, 4, 5].map(s => (
            <span key={s} onClick={() => setStars(s)} onMouseEnter={() => setHover(s)} onMouseLeave={() => setHover(0)} style={{ fontSize: 36, cursor: "pointer", color: s <= (hover || stars) ? "#f59e0b" : "#e5e7eb", transition: "color .15s" }}>★</span>
          ))}
        </div>
        <div style={{ fontSize: 13, color: "#9ca3af", marginTop: 6 }}>
          {["", "Poor", "Fair", "Good", "Great", "Excellent!"][hover || stars] || "Tap to rate"}
        </div>
      </div>

      {/* Tags */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>What went well?</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
          {TAGS.map(t => (
            <button key={t} onClick={() => setTags(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t])} style={{ padding: "5px 12px", border: `1.5px solid ${tags.includes(t) ? "#6366f1" : "#e5e7eb"}`, borderRadius: 999, background: tags.includes(t) ? "#ede9fe" : "#fff", color: tags.includes(t) ? "#6366f1" : "#6b7280", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>{t}</button>
          ))}
        </div>
      </div>

      <Field label="Additional comments">
        <textarea style={{ ...inp, minHeight: 72, resize: "vertical" }} value={comment} onChange={e => setComment(e.target.value)} placeholder="Tell us more about your experience..." />
      </Field>

      <button onClick={submit} disabled={stars === 0} style={{ width: "100%", padding: 11, background: stars === 0 ? "#e5e7eb" : "linear-gradient(135deg,#6366f1,#8b5cf6)", color: stars === 0 ? "#9ca3af" : "#fff", border: "none", borderRadius: 9, fontWeight: 700, cursor: stars === 0 ? "not-allowed" : "pointer", fontSize: 14, fontFamily: "inherit" }}>
        Submit rating
      </button>
    </Card>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. DISPUTE / SUPPORT SYSTEM
// ══════════════════════════════════════════════════════════════════════════════
function DisputePage({ deliveries, session, toast }) {
  const [disputes, setDisputes] = useState([]);
  const [loadingDisputes, setLoadingDisputes] = useState(true);
  const [form, setForm] = useState({ deliveryCode: "", type: "", description: "" });
  const [view, setView] = useState("list"); // "list" | "new"
  const [errors, setErrors] = useState({});

 useEffect(() => {
  const loadDisputes = async () => {
    try {
      const d = await Store.getDisputes();
      setDisputes(d || []);
    } catch (e) {
      console.error("Failed to load disputes:", e);
      toast(
        e?.message || "Unable to load support cases. Please try again.",
        "error"
      );
    } finally {
      setLoadingDisputes(false);
    }
  };

  loadDisputes();
}, []);

  const saveDisputes = (d) => { setDisputes(d); Store.setDisputes(d); };

  const submit = () => {
  const e = {};

  if (!form.deliveryCode.trim()) {
    e.deliveryCode = "Required";
  }

  if (!form.type) {
    e.type = "Required";
  }

  if (!form.description.trim()) {
    e.description = "Required";
  }

  const deliveryCode = form.deliveryCode.trim().toUpperCase();

  const delivery = deliveries.find(
    d => d.code === deliveryCode
  );

  if (!delivery && deliveryCode) {
    e.deliveryCode = "Code not found";
  }

  if (
    delivery &&
    session?.role !== "admin" &&
    delivery.senderId !== session?.id
  ) {
    e.deliveryCode = "This delivery does not belong to your account";
  }

  setErrors(e);

  if (Object.keys(e).length > 0) return;

  const dispute = {
    id: genId(),
    ...form,
    deliveryCode,
    status: "open",
    createdAt: now(),
    userId: session?.id,
    userName: session?.name || "Guest",
    messages: [
      {
        from: "user",
        text: form.description.trim(),
        at: now()
      }
    ]
  };

  saveDisputes([dispute, ...disputes]);

  setForm({
    deliveryCode: "",
    type: "",
    description: ""
  });

  setView("list");

  toast &&
    toast(
      "Dispute submitted. We'll respond within 24 hours.",
      "success"
    );
};

  const addReply = (disputeId, text) => {
  const target = disputes.find(d => d.id === disputeId);

  if (!target) return;

  if (
    session?.role !== "admin" &&
    target.userId !== session?.id
  ) {
    toast &&
      toast("Access denied. You can only reply to your own dispute.", "error");
    return;
  }

  const updated = disputes.map(d =>
    d.id === disputeId
      ? {
          ...d,
          messages: [
            ...(d.messages || []),
            {
              from: session?.role === "admin" ? "support" : "user",
              text,
              at: now()
            }
          ],
          status:
            session?.role === "admin"
              ? "in_review"
              : d.status
        }
      : d
  );

  saveDisputes(updated);
};

 const closeDispute = (id) => {
  const target = disputes.find(d => d.id === id);

  if (!target) return;

  if (
    session?.role !== "admin" &&
    target.userId !== session?.id
  ) {
    toast &&
      toast("Access denied. You can only update your own dispute.", "error");
    return;
  }

  const updated = disputes.map(d =>
    d.id === id
      ? {
          ...d,
          status: "resolved"
        }
      : d
  );

  saveDisputes(updated);

  toast &&
    toast("Dispute marked as resolved.", "success");
};

  const myDisputes = session
  ? session.role === "admin"
    ? disputes
    : disputes.filter(d => d.userId === session.id)
  : [];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div><h1 style={{ fontSize: 22, fontWeight: 800 }}>Support & Disputes</h1><p style={{ color: "#6b7280", fontSize: 13 }}>Report issues with your delivery</p></div>
        <button onClick={() => setView(v => v === "new" ? "list" : "new")} style={{ padding: "8px 16px", background: "#6366f1", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>
          {view === "new" ? "← My cases" : "+ New case"}
        </button>
      </div>

      {view === "new" && (
        <Card style={{ marginBottom: 20 }}>
          <h3 style={{ fontWeight: 700, fontSize: 15, marginBottom: 16 }}>📋 Open a support case</h3>
          <Field label="Delivery code" required error={errors.deliveryCode}>
            <input style={{ ...inp, textTransform: "uppercase", fontFamily: "monospace", letterSpacing: 2 }} maxLength={8} value={form.deliveryCode} onChange={e => setForm(p => ({ ...p, deliveryCode: e.target.value.toUpperCase() }))} placeholder="ABCD1234" />
          </Field>
          <Field label="Issue type" required error={errors.type}>
            <select style={inp} value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}>
              <option value="">Select an issue</option>
              {["Package damaged", "Package lost", "Wrong item delivered", "Late delivery", "Agent behaviour", "Payment issue", "Refund request", "Other"].map(t => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Describe the issue" required error={errors.description}>
            <textarea style={{ ...inp, minHeight: 90, resize: "vertical" }} value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="Please describe your issue in detail..." />
          </Field>
          <button onClick={submit} style={{ width: "100%", padding: 11, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff", border: "none", borderRadius: 9, fontWeight: 700, cursor: "pointer", fontSize: 14, fontFamily: "inherit" }}>Submit case</button>
        </Card>
      )}

      {myDisputes.length === 0 && view === "list" ? (
        <div style={{ textAlign: "center", padding: "3rem", color: "#9ca3af" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🛡️</div>
          <p>{loadingDisputes ? "Loading…" : "No support cases yet. We hope everything is going smoothly!"}</p>
        </div>
      ) : (
        view === "list" && <div style={{ display: "grid", gap: 12 }}>
          {myDisputes.map(d => (
            <Card key={d.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{d.type}</div>
                  <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>Code: {d.deliveryCode} · {fmtDate(d.createdAt)}</div>
                </div>
                <Badge label={d.status === "open" ? "🟡 Open" : d.status === "in_review" ? "🔵 In review" : "✅ Resolved"} color={d.status === "resolved" ? "#16a34a" : d.status === "in_review" ? "#2563eb" : "#d97706"} bg={d.status === "resolved" ? "#dcfce7" : d.status === "in_review" ? "#dbeafe" : "#fef3c7"} />
              </div>
              <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
                {(d.messages || []).map((m, i) => (
                  <div key={i} style={{ background: m.from === "user" ? "#f8fafc" : "#ede9fe", borderRadius: 8, padding: "8px 12px", fontSize: 13 }}>
                    <div style={{ fontSize: 10, color: "#9ca3af", marginBottom: 3 }}>{m.from === "user" ? "👤 You" : "🛡️ Support"} · {fmt(m.at)}</div>
                    <div>{m.text}</div>
                  </div>
                ))}
              </div>
              {d.status !== "resolved" && (
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => addReply(d.id, "Thank you for your report. We are investigating and will update you within 4–6 hours.")} style={{ flex: 1, padding: "7px", background: "#f3f4f6", color: "#374151", border: "none", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Simulate support reply</button>
                  <button onClick={() => closeDispute(d.id)} style={{ padding: "7px 12px", background: "#dcfce7", color: "#16a34a", border: "none", borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Mark resolved</button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 5. ANALYTICS CHARTS (pure JS/CSS, no library)
// ══════════════════════════════════════════════════════════════════════════════
function AnalyticsPage({ deliveries }) {
  const last7 = getLast7Days(deliveries);
  const revenueByPriority = getRevenueByPriority(deliveries);
  const categoryBreakdown = getCategoryBreakdown(deliveries);
  const totalRevenue = deliveries.filter(d => d.paymentStatus === "paid").reduce((s, d) => s + (d.fee || 0), 0);
  const avgFee = deliveries.length ? Math.round(totalRevenue / deliveries.length) : 0;
  const deliveryRate = deliveries.length ? Math.round((deliveries.filter(d => d.status === "delivered").length / deliveries.length) * 100) : 0;

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>Analytics</h1>
      <p style={{ color: "#6b7280", fontSize: 13, marginBottom: 24 }}>Overview of platform performance</p>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12, marginBottom: 24 }}>
        {[
          { label: "Total revenue", value: "₹" + totalRevenue.toLocaleString("en-IN"), icon: "💰", color: "#16a34a", sub: "all time" },
          { label: "Avg. fee", value: "₹" + avgFee, icon: "📊", color: "#6366f1", sub: "per delivery" },
          { label: "Delivery rate", value: deliveryRate + "%", icon: "✅", color: "#22c55e", sub: "successfully delivered" },
          { label: "Total bookings", value: deliveries.length, icon: "📦", color: "#f59e0b", sub: "all time" },
        ].map(k => (
          <Card key={k.label}>
            <div style={{ fontSize: 20, marginBottom: 6 }}>{k.icon}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#374151", marginTop: 2 }}>{k.label}</div>
            <div style={{ fontSize: 11, color: "#9ca3af" }}>{k.sub}</div>
          </Card>
        ))}
      </div>

      {/* Bar chart - last 7 days */}
      <Card style={{ marginBottom: 16 }}>
        <h3 style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>📅 Deliveries — Last 7 days</h3>
        <p style={{ fontSize: 12, color: "#9ca3af", marginBottom: 16 }}>Number of bookings per day</p>
        <BarChart data={last7} color="#6366f1" valueKey="count" labelKey="label" />
      </Card>

      {/* Revenue by priority */}
      <Card style={{ marginBottom: 16 }}>
        <h3 style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>🏷️ Revenue by priority</h3>
        <p style={{ fontSize: 12, color: "#9ca3af", marginBottom: 16 }}>Total earnings split by delivery tier</p>
        <div style={{ display: "grid", gap: 10 }}>
          {revenueByPriority.map(r => (
            <div key={r.label}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                <span style={{ fontWeight: 600 }}>{r.icon} {r.label}</span>
                <span style={{ color: "#9ca3af" }}>₹{r.revenue.toLocaleString("en-IN")} ({r.count} deliveries)</span>
              </div>
              <div style={{ background: "#f3f4f6", borderRadius: 999, height: 10 }}>
                <div style={{ width: (totalRevenue ? (r.revenue / totalRevenue) * 100 : 0) + "%", background: r.color, borderRadius: 999, height: 10, transition: "width .7s" }} />
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Category breakdown */}
      <Card>
        <h3 style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>📦 Category breakdown</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 10 }}>
          {categoryBreakdown.map(c => (
            <div key={c.label} style={{ background: "#f8fafc", borderRadius: 8, padding: "10px 12px", textAlign: "center" }}>
              <div style={{ fontSize: 20, marginBottom: 4 }}>{c.icon}</div>
              <div style={{ fontWeight: 700, fontSize: 16, color: "#6366f1" }}>{c.count}</div>
              <div style={{ fontSize: 11, color: "#9ca3af" }}>{c.label}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function BarChart({ data, color, valueKey, labelKey }) {
  const max = Math.max(...data.map(d => d[valueKey]), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 100 }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 600 }}>{d[valueKey] || ""}</div>
          <div style={{ width: "100%", background: d[valueKey] ? color : "#f3f4f6", borderRadius: "4px 4px 0 0", height: Math.max((d[valueKey] / max) * 70, d[valueKey] ? 4 : 2), transition: "height .5s", opacity: d[valueKey] ? 1 : 0.4 }} />
          <div style={{ fontSize: 10, color: "#9ca3af", textAlign: "center" }}>{d[labelKey]}</div>
        </div>
      ))}
    </div>
  );
}

function getLast7Days(deliveries) {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const label = d.toLocaleDateString("en-IN", { weekday: "short" });
    const dateStr = d.toISOString().slice(0, 10);
    const count = deliveries.filter(x => x.createdAt?.slice(0, 10) === dateStr).length;
    days.push({ label, count });
  }
  return days;
}

function getRevenueByPriority(deliveries) {
  return [
    { label: "Standard", icon: "🕐", color: "#6366f1", ...getStat(deliveries, "standard") },
    { label: "Express", icon: "⚡", color: "#f59e0b", ...getStat(deliveries, "express") },
    { label: "Urgent", icon: "🔥", color: "#ef4444", ...getStat(deliveries, "urgent") },
  ];
}
function getStat(deliveries, priority) {
  const filtered = deliveries.filter(d => d.priority === priority && d.paymentStatus === "paid");
  return { count: filtered.length, revenue: filtered.reduce((s, d) => s + (d.fee || 0), 0) };
}
function getCategoryBreakdown(deliveries) {
  const icons = { Electronics: "💻", Documents: "📄", Food: "🍱", Clothing: "👕", Medicine: "💊", Books: "📚", Gifts: "🎁", Other: "📦", "Food & Groceries": "🥗", Furniture: "🪑" };
  const counts = {};
  deliveries.forEach(d => { counts[d.category] = (counts[d.category] || 0) + 1; });
  return Object.entries(counts).map(([label, count]) => ({ label, count, icon: icons[label] || "📦" })).sort((a, b) => b.count - a.count);
}

// ══════════════════════════════════════════════════════════════════════════════
// 6. SETTINGS & PROFILE PAGE
// ══════════════════════════════════════════════════════════════════════════════
function SettingsPage({ session, onUpdateSession, toast }) {
  const [tab, setTab] = useState("profile");
  const [form, setForm] = useState({ name: session?.name || "", email: session?.email || "", phone: session?.phone || "", address: session?.address || "" });
  const [notifPrefs, setNotifPrefs] = useState(() => {
    try { return JSON.parse(localStorage.getItem("sd_notif_prefs")) || { statusUpdates: true, payments: true, promotions: false, sms: false }; } catch { return { statusUpdates: true, payments: true, promotions: false, sms: false }; }
  });

  const saveProfile = async () => {
    if (session?.id) {
      const { error } = await sb.from("profiles").update({ name: form.name, phone: form.phone, address: form.address }).eq("id", session.id);
      if (error) { toast && toast("Could not save profile: " + error.message, "error"); return; }
    }
    onUpdateSession && onUpdateSession({ ...session, ...form });
    toast && toast("Profile updated!", "success");
  };

  const saveNotifPrefs = (prefs) => {
    setNotifPrefs(prefs);
    localStorage.setItem("sd_notif_prefs", JSON.stringify(prefs));
    toast && toast("Notification preferences saved.", "success");
  };

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 20 }}>Settings</h1>
      <div style={{ display: "flex", gap: 4, borderBottom: "1.5px solid #e5e7eb", marginBottom: 20 }}>
        {["profile", "notifications", "security", "about"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: "7px 16px", border: "none", background: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, color: tab === t ? "#6366f1" : "#9ca3af", borderBottom: `3px solid ${tab === t ? "#6366f1" : "transparent"}`, marginBottom: -2, fontFamily: "inherit" }}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === "profile" && (
        <div style={{ maxWidth: 520 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
            <div style={{ width: 60, height: 60, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 24, fontWeight: 800 }}>{form.name?.[0]?.toUpperCase() || "?"}</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{form.name}</div>
              <div style={{ fontSize: 13, color: "#6b7280" }}>{session?.role} · Joined {fmtDate(session?.createdAt || now())}</div>
            </div>
          </div>
          <Card>
            <h3 style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>Profile information</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Full name"><input style={inp} value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} /></Field>
              <Field label="Email"><input style={inp} type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} /></Field>
              <Field label="Phone"><input style={inp} value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="+91 98765 43210" /></Field>
              <Field label="Role"><input style={{ ...inp, background: "#f8fafc" }} value={session?.role || ""} readOnly /></Field>
            </div>
            <Field label="Default address">
              <textarea style={{ ...inp, minHeight: 64, resize: "vertical" }} value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} placeholder="Your default pickup/delivery address" />
            </Field>
            <button onClick={saveProfile} style={{ padding: "9px 20px", background: "#6366f1", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>Save changes</button>
          </Card>
        </div>
      )}

      {tab === "notifications" && (
        <div style={{ maxWidth: 520 }}>
          <Card>
            <h3 style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>Notification preferences</h3>
            {[
              { key: "statusUpdates", label: "Status updates", desc: "Get notified when your delivery status changes" },
              { key: "payments", label: "Payment alerts", desc: "Notifications for payments and receipts" },
              { key: "promotions", label: "Promotions & offers", desc: "Special offers and discount codes" },
              { key: "sms", label: "SMS notifications", desc: "Also receive notifications via SMS" },
            ].map(n => (
              <div key={n.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: "1px solid #f3f4f6" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{n.label}</div>
                  <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 1 }}>{n.desc}</div>
                </div>
                <div onClick={() => saveNotifPrefs({ ...notifPrefs, [n.key]: !notifPrefs[n.key] })} style={{ width: 40, height: 22, borderRadius: 999, background: notifPrefs[n.key] ? "#6366f1" : "#d1d5db", cursor: "pointer", position: "relative", transition: "background .2s" }}>
                  <div style={{ width: 18, height: 18, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: notifPrefs[n.key] ? 20 : 2, transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,.2)" }} />
                </div>
              </div>
            ))}
          </Card>
        </div>
      )}

      {tab === "security" && (
        <div style={{ maxWidth: 520 }}>
          <Card style={{ marginBottom: 14 }}>
            <h3 style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>Change password</h3>
            <Field label="Current password"><input style={inp} type="password" placeholder="••••••••" /></Field>
            <Field label="New password"><input style={inp} type="password" placeholder="••••••••" /></Field>
            <Field label="Confirm new password"><input style={inp} type="password" placeholder="••••••••" /></Field>
            <button onClick={() => toast && toast("Password updated!", "success")} style={{ padding: "9px 20px", background: "#6366f1", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>Update password</button>
          </Card>
          <Card style={{ background: "#fff9f9", border: "1px solid #fecaca" }}>
            <h3 style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, color: "#991b1b" }}>⚠️ Danger zone</h3>
            <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 14 }}>Permanently delete your account and all associated data.</p>
            <button onClick={() => toast && toast("This is a demo — account deletion disabled.", "info")} style={{ padding: "8px 16px", background: "#fee2e2", color: "#dc2626", border: "1px solid #fca5a5", borderRadius: 8, fontWeight: 700, cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>Delete account</button>
          </Card>
        </div>
      )}

      {tab === "about" && (
        <div style={{ maxWidth: 520 }}>
          <Card>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
              <div style={{ width: 44, height: 44, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>🚀</div>
              <div><div style={{ fontWeight: 800, fontSize: 16 }}>SwiftDeliver</div><div style={{ fontSize: 12, color: "#9ca3af" }}>Version 2.0.0 · Full-stack platform</div></div>
            </div>
            {[["Tech stack", "React 18 · LocalStorage · Pure CSS"],["Authentication","Role-based: Sender, Receiver, Agent, Admin"],["Features","Tracking, Payments, Agents, Invoices, Disputes, Analytics"],["License","MIT · Open source"],["Support","support@swiftdeliver.in · 1800-123-4567"]].map(([l, v]) => (
              <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #f3f4f6", fontSize: 13 }}>
                <span style={{ color: "#9ca3af" }}>{l}</span><span style={{ fontWeight: 500, maxWidth: "60%", textAlign: "right" }}>{v}</span>
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 7. ETA CALCULATOR
// ══════════════════════════════════════════════════════════════════════════════
function ETACalculator() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [priority, setPriority] = useState("standard");
  const [result, setResult] = useState(null);

  const CITIES = ["Mumbai", "Delhi", "Bengaluru", "Hyderabad", "Chennai", "Kolkata", "Pune", "Ahmedabad", "Jaipur", "Kanpur", "Lucknow", "Surat", "Nagpur", "Indore", "Bhopal"];

  const calculate = () => {
    if (!from || !to) return;
    const isSameCity = from === to;
    const etaDays = { standard: isSameCity ? 1 : 3, express: isSameCity ? 0.5 : 1.5, urgent: isSameCity ? 0.25 : 0.75 };
    const days = etaDays[priority];
    const delivery = new Date();
    delivery.setDate(delivery.getDate() + Math.ceil(days));
    const fee = { standard: 60, express: 120, urgent: 250 }[priority];
    setResult({ days, delivery: delivery.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" }), fee, distance: isSameCity ? "Within city" : `${from} → ${to}` });
  };

  return (
    <Card style={{ maxWidth: 480 }}>
      <h3 style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>⏱️ ETA Calculator</h3>
      <p style={{ fontSize: 12, color: "#9ca3af", marginBottom: 16 }}>Estimate delivery time and cost before booking</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="From city">
          <select style={inp} value={from} onChange={e => setFrom(e.target.value)}>
            <option value="">Select</option>
            {CITIES.map(c => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="To city">
          <select style={inp} value={to} onChange={e => setTo(e.target.value)}>
            <option value="">Select</option>
            {CITIES.map(c => <option key={c}>{c}</option>)}
          </select>
        </Field>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {[["standard", "🕐 Standard", "#6366f1"], ["express", "⚡ Express", "#d97706"], ["urgent", "🔥 Urgent", "#dc2626"]].map(([k, l, c]) => (
          <button key={k} onClick={() => setPriority(k)} style={{ flex: 1, padding: "8px 4px", border: `2px solid ${priority === k ? c : "#e5e7eb"}`, borderRadius: 8, background: priority === k ? c + "11" : "#fff", color: priority === k ? c : "#6b7280", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>{l}</button>
        ))}
      </div>
      <button onClick={calculate} style={{ width: "100%", padding: 11, background: "#6366f1", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer", fontSize: 13, fontFamily: "inherit", marginBottom: result ? 14 : 0 }}>Calculate ETA</button>
      {result && (
        <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 10, padding: "14px 16px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {[["📍 Route", result.distance], ["📅 Estimated delivery", result.delivery], ["💰 Starting fee", `₹${result.fee}`], ["⏱️ ETA", result.days < 1 ? `${Math.round(result.days * 24)} hours` : `${Math.ceil(result.days)} day(s)`]].map(([l, v]) => (
              <div key={l} style={{ background: "#fff", borderRadius: 8, padding: "8px 10px" }}>
                <div style={{ fontSize: 11, color: "#9ca3af" }}>{l}</div>
                <div style={{ fontWeight: 700, fontSize: 13, marginTop: 2, color: "#111" }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 8. CSV EXPORT
// ══════════════════════════════════════════════════════════════════════════════
function exportToCSV(deliveries, filename = "swiftdeliver_export.csv") {
  const headers = ["Code", "Item", "Category", "Qty", "Weight", "Priority", "Fee", "Status", "Sender", "Sender Phone", "Sender Address", "Receiver", "Receiver Phone", "Receiver Address", "City", "PIN", "Agent", "Booked At", "Delivered At"];
  const rows = deliveries.map(d => [
    d.code, d.itemName, d.category, d.qty, d.weight || "", d.priority, d.fee, d.status,
    d.senderName, d.senderPhone, d.senderAddr,
    d.recvName, d.recvPhone, d.recvAddr, d.recvCity || "", d.recvPin || "",
    d.agentName || "", fmtDate(d.createdAt), d.deliveredAt ? fmtDate(d.deliveredAt) : "",
  ].map(v => `"${String(v || "").replace(/"/g, '""')}"`));

  const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ══════════════════════════════════════════════════════════════════════════════
// 9. BULK BOOKING TABLE (sender can add multiple packages at once)
// ══════════════════════════════════════════════════════════════════════════════
function BulkBookingPage({ session, saveDeliveries, deliveries, toast }) {
  const emptyRow = () => ({ id: genId(), itemName: "", category: "", weight: "", recvName: "", recvPhone: "", recvAddr: "", recvCity: "", priority: "standard" });
  const [rows, setRows] = useState([emptyRow()]);
  const [senderName, setSenderName] = useState(session?.name || "");
  const [senderPhone, setSenderPhone] = useState(session?.phone || "");
  const [senderAddr, setSenderAddr] = useState(session?.address || "");
  const [submitted, setSubmitted] = useState(null);

  const updateRow = (id, key, val) => setRows(p => p.map(r => r.id === id ? { ...r, [key]: val } : r));
  const addRow = () => setRows(p => [...p, emptyRow()]);
  const removeRow = (id) => setRows(p => p.filter(r => r.id !== id));

  const AGENTS = [{ id: "ag1", name: "Ravi Kumar", phone: "+91 98001 11001" }, { id: "ag2", name: "Priya Sharma", phone: "+91 98001 22002" }, { id: "ag3", name: "Arjun Singh", phone: "+91 98001 33003" }];

  const submit = () => {
    const valid = rows.every(r => r.itemName && r.recvName && r.recvPhone && r.recvAddr);
    if (!senderName || !senderPhone || !senderAddr) { toast && toast("Fill in sender details", "error"); return; }
    if (!valid) { toast && toast("Complete all item/receiver fields", "error"); return; }

    const newDeliveries = rows.map(r => {
      const agent = AGENTS[Math.floor(Math.random() * AGENTS.length)];
      const fee = Math.round(({ standard: 60, express: 120, urgent: 250 }[r.priority] || 60) + (parseFloat(r.weight) || 0) * 18);
      return { id: genId(), code: (() => { const c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; return Array.from({ length: 8 }, () => c[Math.floor(Math.random() * c.length)]).join(""); })(), status: "booked", priority: r.priority, fee, itemName: r.itemName, category: r.category, weight: r.weight, qty: "1", senderName, senderPhone, senderAddr, recvName: r.recvName, recvPhone: r.recvPhone, recvAddr: r.recvAddr, recvCity: r.recvCity, senderId: session?.id, agentId: agent.id, agentName: agent.name, agentPhone: agent.phone, createdAt: now(), timeline: [{ status: "booked", at: now(), note: "Bulk booking" }], paymentStatus: "paid" };
    });
    saveDeliveries([...newDeliveries, ...deliveries]);
    setSubmitted(newDeliveries);
    toast && toast(`✅ ${newDeliveries.length} deliveries booked!`, "success");
  };

  if (submitted) return (
    <div>
      <h2 style={{ fontWeight: 800, fontSize: 20, marginBottom: 20 }}>✅ Bulk booking confirmed</h2>
      <div style={{ display: "grid", gap: 10, marginBottom: 20 }}>
        {submitted.map(d => (
          <Card key={d.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div><div style={{ fontWeight: 700, fontSize: 14 }}>{d.itemName}</div><div style={{ fontSize: 12, color: "#6b7280" }}>→ {d.recvName}</div></div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: "monospace", fontWeight: 800, color: "#6366f1", letterSpacing: 2 }}>{d.code}</div>
              <div style={{ fontSize: 12, color: "#9ca3af" }}>₹{d.fee}</div>
            </div>
          </Card>
        ))}
      </div>
      <button onClick={() => { setSubmitted(null); setRows([emptyRow()]); }} style={{ padding: "10px 20px", background: "#6366f1", color: "#fff", border: "none", borderRadius: 9, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Book more</button>
    </div>
  );

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>Bulk booking</h1>
      <p style={{ color: "#6b7280", fontSize: 13, marginBottom: 20 }}>Book multiple deliveries in one go</p>

      <Card style={{ marginBottom: 16 }}>
        <h3 style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>👤 Sender details (applies to all)</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Full name"><input style={inp} value={senderName} onChange={e => setSenderName(e.target.value)} /></Field>
          <Field label="Phone"><input style={inp} value={senderPhone} onChange={e => setSenderPhone(e.target.value)} /></Field>
        </div>
        <Field label="Pickup address"><textarea style={{ ...inp, minHeight: 54, resize: "vertical" }} value={senderAddr} onChange={e => setSenderAddr(e.target.value)} /></Field>
      </Card>

      <div style={{ display: "grid", gap: 12, marginBottom: 14 }}>
        {rows.map((row, idx) => (
          <Card key={row.id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: "#6366f1" }}>Package {idx + 1}</div>
              {rows.length > 1 && <button onClick={() => removeRow(row.id)} style={{ background: "#fee2e2", border: "none", color: "#dc2626", borderRadius: 6, padding: "3px 8px", cursor: "pointer", fontSize: 11, fontWeight: 700, fontFamily: "inherit" }}>Remove</button>}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="Item name"><input style={inp} value={row.itemName} onChange={e => updateRow(row.id, "itemName", e.target.value)} placeholder="e.g. Laptop" /></Field>
              <Field label="Category"><select style={inp} value={row.category} onChange={e => updateRow(row.id, "category", e.target.value)}><option value="">Select</option>{["Electronics", "Documents", "Food", "Clothing", "Medicine", "Books", "Gifts", "Other"].map(c => <option key={c}>{c}</option>)}</select></Field>
              <Field label="Weight (kg)"><input style={inp} type="number" value={row.weight} onChange={e => updateRow(row.id, "weight", e.target.value)} placeholder="0" /></Field>
              <Field label="Priority"><select style={inp} value={row.priority} onChange={e => updateRow(row.id, "priority", e.target.value)}><option value="standard">Standard (₹60+)</option><option value="express">Express (₹120+)</option><option value="urgent">Urgent (₹250+)</option></select></Field>
              <Field label="Receiver name"><input style={inp} value={row.recvName} onChange={e => updateRow(row.id, "recvName", e.target.value)} /></Field>
              <Field label="Receiver phone"><input style={inp} value={row.recvPhone} onChange={e => updateRow(row.id, "recvPhone", e.target.value)} /></Field>
              <Field label="Address" children={<input style={inp} value={row.recvAddr} onChange={e => updateRow(row.id, "recvAddr", e.target.value)} placeholder="Street, area, PIN" />} />
              <Field label="City"><input style={inp} value={row.recvCity} onChange={e => updateRow(row.id, "recvCity", e.target.value)} /></Field>
            </div>
          </Card>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={addRow} style={{ padding: "10px 18px", background: "#f3f4f6", color: "#374151", border: "none", borderRadius: 9, fontWeight: 700, cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>+ Add package</button>
        <button onClick={submit} style={{ flex: 1, padding: 11, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff", border: "none", borderRadius: 9, fontWeight: 700, cursor: "pointer", fontSize: 14, fontFamily: "inherit" }}>
          🚀 Book {rows.length} package{rows.length > 1 ? "s" : ""} · ₹{rows.reduce((s, r) => s + Math.round(({ standard: 60, express: 120, urgent: 250 }[r.priority] || 60) + (parseFloat(r.weight) || 0) * 18), 0)}
        </button>
      </div>
    </div>
  );
}


// === PART 3: ADVANCED FEATURES ===
// ══════════════════════════════════════════════════════════════════════════════
// SwiftDeliver — Part 3: Complete Backend + Advanced Features
// GPS Tracking · Proof of Delivery · COD Tracker · Refunds · Scheduling
// Live Chat · Delivery Zones · Promo Codes · Full Admin CRUD · API Docs
// ══════════════════════════════════════════════════════════════════════════════


// ─── Primitives shared from Part 1 ──────────────────────────────────────────

// ── Backend simulation (localStorage as "DB") ─────────────────────────────────
const DB = {
  table: (name) => ({
    all: () => { try { return JSON.parse(localStorage.getItem(`sd_${name}`)) || []; } catch { return []; } },
    save: (rows) => localStorage.setItem(`sd_${name}`, JSON.stringify(rows)),
    find: (id) => DB.table(name).all().find(r => r.id === id),
    insert: (row) => { const all = DB.table(name).all(); const n = { id: genId(), createdAt: now(), ...row }; DB.table(name).save([n, ...all]); return n; },
    update: (id, patch) => { const all = DB.table(name).all().map(r => r.id === id ? { ...r, ...patch, updatedAt: now() } : r); DB.table(name).save(all); return all.find(r => r.id === id); },
    delete: (id) => DB.table(name).save(DB.table(name).all().filter(r => r.id !== id)),
    where: (fn) => DB.table(name).all().filter(fn),
  }),
};

// ══════════════════════════════════════════════════════════════════════════════
// 1. GPS / LIVE LOCATION TRACKER (simulated)
// ══════════════════════════════════════════════════════════════════════════════
function LiveTrackerPage({ delivery }) {
  const [agentPos, setAgentPos] = useState({ lat: 28.6139, lng: 77.2090, bearing: 45 });
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const timerRef = useRef(null);

  // Simulated agent route (Delhi sample)
  const WAYPOINTS = [
    { lat: 28.6139, lng: 77.2090 }, { lat: 28.6189, lng: 77.2140 },
    { lat: 28.6240, lng: 77.2200 }, { lat: 28.6300, lng: 77.2280 },
    { lat: 28.6380, lng: 77.2350 }, { lat: 28.6450, lng: 77.2420 },
  ];
  const wpIdx = useRef(0);

  const startTracking = () => {
    setRunning(true);
    timerRef.current = setInterval(() => {
      setElapsed(e => e + 1);
      wpIdx.current = Math.min(wpIdx.current + 1, WAYPOINTS.length - 1);
      const pos = WAYPOINTS[wpIdx.current];
      const prev = WAYPOINTS[Math.max(wpIdx.current - 1, 0)];
      const bearing = Math.atan2(pos.lng - prev.lng, pos.lat - prev.lat) * (180 / Math.PI);
      setAgentPos({ ...pos, bearing });
      if (wpIdx.current === WAYPOINTS.length - 1) { clearInterval(timerRef.current); setRunning(false); }
    }, 1200);
  };

  const reset = () => { clearInterval(timerRef.current); wpIdx.current = 0; setAgentPos({ ...WAYPOINTS[0], bearing: 45 }); setElapsed(0); setRunning(false); };
  useEffect(() => () => clearInterval(timerRef.current), []);

  const eta = Math.max(0, Math.round(((WAYPOINTS.length - 1 - wpIdx.current) * 1.2) / 60 * 60));
  const pct = Math.round((wpIdx.current / (WAYPOINTS.length - 1)) * 100);

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>📡 Live GPS Tracking</h1>
      <p style={{ color: "#6b7280", fontSize: 13, marginBottom: 20 }}>Real-time agent location simulation{delivery ? ` · ${delivery.code}` : ""}</p>

      {/* Map simulation */}
      <Card style={{ marginBottom: 14, overflow: "hidden", padding: 0 }}>
        <div style={{ position: "relative", height: 280, background: "linear-gradient(135deg,#e0f2fe,#dbeafe)", borderRadius: 12, overflow: "hidden" }}>
          {/* Grid lines */}
          {[...Array(8)].map((_, i) => (
            <div key={`h${i}`} style={{ position: "absolute", left: 0, right: 0, top: `${(i + 1) * 12.5}%`, height: 1, background: "rgba(148,163,184,.3)" }} />
          ))}
          {[...Array(8)].map((_, i) => (
            <div key={`v${i}`} style={{ position: "absolute", top: 0, bottom: 0, left: `${(i + 1) * 12.5}%`, width: 1, background: "rgba(148,163,184,.3)" }} />
          ))}

          {/* Route path */}
          <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} viewBox="0 0 100 100" preserveAspectRatio="none">
            <polyline points={WAYPOINTS.map((w, i) => `${10 + i * 16},${80 - i * 12}`).join(" ")} fill="none" stroke="#6366f1" strokeWidth="1.5" strokeDasharray="4,2" opacity="0.6" />
            <polyline points={WAYPOINTS.slice(0, wpIdx.current + 1).map((w, i) => `${10 + i * 16},${80 - i * 12}`).join(" ")} fill="none" stroke="#6366f1" strokeWidth="2.5" />
          </svg>

          {/* Destination pin */}
          <div style={{ position: "absolute", right: "8%", top: "12%", fontSize: 24, filter: "drop-shadow(0 2px 4px rgba(0,0,0,.3))" }}>📍</div>
          <div style={{ position: "absolute", right: "5%", top: "28%", background: "#fff", borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 700, color: "#374151", boxShadow: "0 2px 8px rgba(0,0,0,.1)" }}>Delivery point</div>

          {/* Pickup pin */}
          <div style={{ position: "absolute", left: "6%", bottom: "18%", fontSize: 20 }}>🏠</div>

          {/* Agent marker */}
          <div style={{
            position: "absolute",
            left: `${8 + wpIdx.current * 16}%`,
            bottom: `${15 + wpIdx.current * 11}%`,
            transition: "all 1s ease",
            transform: `rotate(${agentPos.bearing}deg)`,
            fontSize: 24,
            filter: "drop-shadow(0 2px 6px rgba(99,102,241,.5))",
          }}>🛵</div>

          {/* ETA chip */}
          <div style={{ position: "absolute", top: 12, left: 12, background: "#fff", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, boxShadow: "0 2px 8px rgba(0,0,0,.1)" }}>
            <span style={{ color: "#6366f1" }}>ETA: </span>
            <span>{wpIdx.current === WAYPOINTS.length - 1 ? "Arrived!" : `~${Math.max(1, Math.round((WAYPOINTS.length - 1 - wpIdx.current) * 0.5))} min`}</span>
          </div>

          {/* Map attribution */}
          <div style={{ position: "absolute", bottom: 8, right: 12, fontSize: 10, color: "#94a3b8" }}>Simulated map view</div>
        </div>
      </Card>

      {/* Progress bar */}
      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 8 }}>
          <span style={{ fontWeight: 600 }}>Delivery progress</span>
          <span style={{ color: "#6366f1", fontWeight: 700 }}>{pct}%</span>
        </div>
        <div style={{ background: "#f3f4f6", borderRadius: 999, height: 10, marginBottom: 10 }}>
          <div style={{ width: pct + "%", background: "linear-gradient(90deg,#6366f1,#8b5cf6)", borderRadius: 999, height: 10, transition: "width 1s" }} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          {[
            { l: "Status", v: wpIdx.current === WAYPOINTS.length - 1 ? "✅ Delivered" : running ? "🛵 Moving" : "⏸ Paused", c: "#6366f1" },
            { l: "Elapsed", v: `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`, c: "#f59e0b" },
            { l: "Agent", v: delivery?.agentName || "Ravi Kumar", c: "#374151" },
          ].map(s => (
            <div key={s.l} style={{ background: "#f8fafc", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: s.c }}>{s.v}</div>
              <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 1 }}>{s.l}</div>
            </div>
          ))}
        </div>
      </Card>

      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={startTracking} disabled={running || wpIdx.current === WAYPOINTS.length - 1} style={{ flex: 1, padding: 11, background: running || wpIdx.current === WAYPOINTS.length - 1 ? "#e5e7eb" : "linear-gradient(135deg,#6366f1,#8b5cf6)", color: running || wpIdx.current === WAYPOINTS.length - 1 ? "#9ca3af" : "#fff", border: "none", borderRadius: 9, fontWeight: 700, cursor: running || wpIdx.current === WAYPOINTS.length - 1 ? "not-allowed" : "pointer", fontSize: 14, fontFamily: "inherit" }}>
          {running ? "🟢 Tracking live..." : wpIdx.current === WAYPOINTS.length - 1 ? "✅ Delivered!" : "▶ Start live tracking"}
        </button>
        <button onClick={reset} style={{ padding: "11px 18px", background: "#f3f4f6", color: "#374151", border: "none", borderRadius: 9, fontWeight: 700, cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>↺ Reset</button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. PROOF OF DELIVERY (POD) SYSTEM
// ══════════════════════════════════════════════════════════════════════════════
function ProofOfDeliveryPage({ delivery, onConfirm, toast }) {
  const [otp, setOtp] = useState(["", "", "", ""]);
  const [step, setStep] = useState("otp"); // "otp" | "sign" | "done"
  const [generated, setGenerated] = useState(null);
  const [signed, setSigned] = useState(false);
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const refs = [useRef(), useRef(), useRef(), useRef()];

  const genOtp = () => {
    const o = Math.floor(1000 + Math.random() * 9000).toString();
    setGenerated(o);
    toast && toast(`OTP sent to receiver: ${o}`, "info");
  };

  const verifyOtp = () => {
    const entered = otp.join("");
    if (entered === generated) { setStep("sign"); toast && toast("OTP verified! Please collect signature.", "success"); }
    else toast && toast("Incorrect OTP. Try again.", "error");
  };

  const handleOtpChange = (i, v) => {
    if (!/^\d*$/.test(v)) return;
    const n = [...otp]; n[i] = v.slice(-1); setOtp(n);
    if (v && i < 3) refs[i + 1].current?.focus();
  };

  // Signature canvas
  useEffect(() => {
    if (step !== "sign" || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.strokeStyle = "#1e293b"; ctx.lineWidth = 2.5; ctx.lineCap = "round";

    const getPos = (e) => {
      const r = canvas.getBoundingClientRect();
      const touch = e.touches?.[0];
      return { x: (touch ? touch.clientX : e.clientX) - r.left, y: (touch ? touch.clientY : e.clientY) - r.top };
    };

    const start = (e) => { drawing.current = true; ctx.beginPath(); const p = getPos(e); ctx.moveTo(p.x, p.y); };
    const move = (e) => { if (!drawing.current) return; e.preventDefault(); const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); setSigned(true); };
    const end = () => { drawing.current = false; };

    canvas.addEventListener("mousedown", start); canvas.addEventListener("mousemove", move); canvas.addEventListener("mouseup", end);
    canvas.addEventListener("touchstart", start, { passive: false }); canvas.addEventListener("touchmove", move, { passive: false }); canvas.addEventListener("touchend", end);
    return () => {
      canvas.removeEventListener("mousedown", start); canvas.removeEventListener("mousemove", move); canvas.removeEventListener("mouseup", end);
      canvas.removeEventListener("touchstart", start); canvas.removeEventListener("touchmove", move); canvas.removeEventListener("touchend", end);
    };
  }, [step]);

  const clearSig = () => { const canvas = canvasRef.current; if (!canvas) return; canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height); setSigned(false); };

  const confirmDelivery = () => {
    const sig = canvasRef.current?.toDataURL();
    onConfirm && onConfirm({ otp: generated, signature: sig, confirmedAt: now() });
    setStep("done");
    toast && toast("✅ Delivery confirmed with signature!", "success");
  };

  if (step === "done") return (
    <Card style={{ textAlign: "center", padding: "2rem" }}>
      <div style={{ fontSize: 52, marginBottom: 14 }}>✅</div>
      <h2 style={{ fontWeight: 800, fontSize: 20, color: "#166534", marginBottom: 6 }}>Proof of delivery confirmed</h2>
      <p style={{ color: "#6b7280", fontSize: 13, marginBottom: 16 }}>OTP verified · Signature collected · Delivery complete</p>
      <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
        <Badge label="OTP: ✓" color="#16a34a" bg="#dcfce7" />
        <Badge label="Signature: ✓" color="#2563eb" bg="#dbeafe" />
        <Badge label="Timestamp: ✓" color="#7c3aed" bg="#ede9fe" />
      </div>
    </Card>
  );

  return (
    <div style={{ maxWidth: 440 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>🖊️ Proof of Delivery</h1>
      <p style={{ color: "#6b7280", fontSize: 13, marginBottom: 20 }}>OTP verification + digital signature collection</p>

      {/* Step indicator */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 22 }}>
        {[{ i: 1, l: "OTP" }, { i: 2, l: "Sign" }, { i: 3, l: "Done" }].map((s, idx) => (
          <div key={s.i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: step === "otp" && idx === 0 ? "#6366f1" : step === "sign" && idx <= 1 ? "#6366f1" : step === "done" ? "#22c55e" : "#e5e7eb", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>{idx + 1}</div>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#9ca3af" }}>{s.l}</span>
            {idx < 2 && <div style={{ width: 30, height: 2, background: "#e5e7eb" }} />}
          </div>
        ))}
      </div>

      {step === "otp" && (
        <Card>
          <h3 style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>Step 1: OTP Verification</h3>
          <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 16 }}>Generate and send a 4-digit OTP to the receiver's phone, then enter it to verify.</p>
          {!generated ? (
            <button onClick={genOtp} style={{ width: "100%", padding: 11, background: "#6366f1", color: "#fff", border: "none", borderRadius: 9, fontWeight: 700, cursor: "pointer", fontSize: 14, fontFamily: "inherit", marginBottom: 12 }}>📱 Send OTP to receiver</button>
          ) : (
            <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "#166534", textAlign: "center", fontWeight: 700 }}>
              OTP sent: {generated} (simulated SMS)
            </div>
          )}
          {generated && (
            <>
              <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 10 }}>Enter 4-digit OTP</div>
              <div style={{ display: "flex", gap: 10, justifyContent: "center", marginBottom: 16 }}>
                {otp.map((v, i) => (
                  <input key={i} ref={refs[i]} value={v} onChange={e => handleOtpChange(i, e.target.value)} onKeyDown={e => e.key === "Backspace" && !v && i > 0 && refs[i - 1].current?.focus()} maxLength={1} style={{ width: 52, height: 56, textAlign: "center", fontSize: 24, fontWeight: 800, border: "2px solid #d1d5db", borderRadius: 10, outline: "none", fontFamily: "monospace" }} />
                ))}
              </div>
              <button onClick={verifyOtp} style={{ width: "100%", padding: 11, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff", border: "none", borderRadius: 9, fontWeight: 700, cursor: "pointer", fontSize: 14, fontFamily: "inherit" }}>Verify OTP →</button>
            </>
          )}
        </Card>
      )}

      {step === "sign" && (
        <Card>
          <h3 style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>Step 2: Digital Signature</h3>
          <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 14 }}>Ask the receiver to sign below to confirm receipt.</p>
          <div style={{ border: "2px dashed #d1d5db", borderRadius: 10, overflow: "hidden", marginBottom: 10, position: "relative" }}>
            <canvas ref={canvasRef} width={400} height={160} style={{ width: "100%", display: "block", touchAction: "none", cursor: "crosshair" }} />
            {!signed && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", color: "#d1d5db", fontSize: 14 }}>✍️ Sign here</div>}
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <button onClick={clearSig} style={{ flex: 1, padding: 9, background: "#f3f4f6", color: "#374151", border: "none", borderRadius: 7, fontWeight: 600, cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>🗑 Clear</button>
          </div>
          <button onClick={confirmDelivery} disabled={!signed} style={{ width: "100%", padding: 11, background: signed ? "linear-gradient(135deg,#16a34a,#22c55e)" : "#e5e7eb", color: signed ? "#fff" : "#9ca3af", border: "none", borderRadius: 9, fontWeight: 700, cursor: signed ? "pointer" : "not-allowed", fontSize: 14, fontFamily: "inherit" }}>
            ✅ Confirm delivery
          </button>
        </Card>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. COD (CASH ON DELIVERY) TRACKER
// ══════════════════════════════════════════════════════════════════════════════
function CODTrackerPage({ deliveries, saveDeliveries, toast }) {
  const codDeliveries = deliveries.filter(d => d.paymentMethod === "Cash on delivery" || d.paymentStatus === "cod_pending");
  const [filter, setFilter] = useState("all");

  const markCollected = (id, amount) => {
    const updated = deliveries.map(d => d.id === id ? { ...d, paymentStatus: "paid", paymentMethod: "Cash on delivery", codCollectedAt: now(), codAmount: amount } : d);
    saveDeliveries(updated);
    toast && toast(`COD of ₹${amount} marked as collected`, "success");
  };

  const totalPending = codDeliveries.filter(d => d.paymentStatus !== "paid").reduce((s, d) => s + (d.fee || 0), 0);
  const totalCollected = codDeliveries.filter(d => d.paymentStatus === "paid").reduce((s, d) => s + (d.fee || 0), 0);

  const filtered = codDeliveries.filter(d => filter === "all" || (filter === "pending" && d.paymentStatus !== "paid") || (filter === "collected" && d.paymentStatus === "paid"));

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>💵 COD Tracker</h1>
      <p style={{ color: "#6b7280", fontSize: 13, marginBottom: 20 }}>Track and manage cash-on-delivery collections</p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
        {[
          { l: "COD orders", v: codDeliveries.length, c: "#6366f1", i: "📦" },
          { l: "Pending", v: "₹" + totalPending.toLocaleString("en-IN"), c: "#f59e0b", i: "⏳" },
          { l: "Collected", v: "₹" + totalCollected.toLocaleString("en-IN"), c: "#22c55e", i: "✅" },
        ].map(s => (
          <Card key={s.l} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 20, marginBottom: 5 }}>{s.i}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: s.c }}>{s.v}</div>
            <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>{s.l}</div>
          </Card>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {[["all", "All"], ["pending", "Pending"], ["collected", "Collected"]].map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} style={{ padding: "5px 14px", border: `1.5px solid ${filter === k ? "#6366f1" : "#e5e7eb"}`, borderRadius: 999, background: filter === k ? "#ede9fe" : "#fff", color: filter === k ? "#6366f1" : "#6b7280", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>{l}</button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "3rem", color: "#9ca3af" }}>
          <div style={{ fontSize: 48, marginBottom: 10 }}>💵</div>
          <p>No COD deliveries yet. When senders choose "Cash on delivery", they'll appear here.</p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {filtered.map(d => (
            <Card key={d.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{d.itemName}</div>
                  <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 1 }}>{d.code} · {d.recvName} · {fmtDate(d.createdAt)}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontWeight: 800, fontSize: 16, color: "#6366f1" }}>₹{d.fee}</div>
                  <Badge label={d.paymentStatus === "paid" ? "✅ Collected" : "⏳ Pending"} color={d.paymentStatus === "paid" ? "#16a34a" : "#d97706"} bg={d.paymentStatus === "paid" ? "#dcfce7" : "#fef3c7"} />
                </div>
              </div>
              <div style={{ fontSize: 12, color: "#6b7280", marginBottom: d.paymentStatus !== "paid" ? 10 : 0 }}>
                📍 {d.recvAddr}{d.recvCity ? ", " + d.recvCity : ""} · Agent: {d.agentName || "—"}
              </div>
              {d.paymentStatus !== "paid" && (
                <button onClick={() => markCollected(d.id, d.fee)} style={{ width: "100%", padding: 9, background: "#f0fdf4", color: "#16a34a", border: "1.5px solid #86efac", borderRadius: 8, fontWeight: 700, cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>
                  ✅ Mark ₹{d.fee} as collected
                </button>
              )}
              {d.paymentStatus === "paid" && d.codCollectedAt && (
                <div style={{ fontSize: 11, color: "#9ca3af", textAlign: "right" }}>Collected: {fmt(d.codCollectedAt)}</div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. REFUND MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════════
function RefundPage({ deliveries, saveDeliveries, session, toast }) {
  const [refunds, setRefunds] = useState(() => DB.table("refunds").all());
  const [form, setForm] = useState({ code: "", reason: "", amount: "" });
  const [view, setView] = useState("list");
  const [errors, setErrors] = useState({});

  const saveRefunds = (r) => { setRefunds(r); DB.table("refunds").save(r); };

  const requestRefund = () => {
    const e = {};
    if (!form.code) e.code = "Required";
    if (!form.reason) e.reason = "Required";
    const delivery = deliveries.find(d => d.code === form.code.toUpperCase());
    if (!delivery && form.code) e.code = "Code not found";
    if (delivery && delivery.paymentStatus !== "paid") e.code = "No paid payment found for this delivery";
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    const refund = { id: genId(), code: form.code.toUpperCase(), reason: form.reason, amount: form.amount || delivery?.fee, requestedAt: now(), status: "pending", userId: session?.id, userName: session?.name };
    saveRefunds([refund, ...refunds]);
    setForm({ code: "", reason: "", amount: "" });
    setView("list");
    toast && toast("Refund request submitted. Processing takes 3–5 business days.", "success");
  };

  const processRefund = (id, action) => {
    const updated = refunds.map(r => r.id === id ? { ...r, status: action, processedAt: now() } : r);
    saveRefunds(updated);
    if (action === "approved") {
      const refund = refunds.find(r => r.id === id);
      const updDeliveries = deliveries.map(d => d.code === refund?.code ? { ...d, refundStatus: "approved", refundAmount: refund?.amount } : d);
      saveDeliveries(updDeliveries);
    }
    toast && toast(`Refund ${action}`, action === "approved" ? "success" : "info");
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>💸 Refund Management</h1>
          <p style={{ color: "#6b7280", fontSize: 13 }}>Request and track delivery refunds</p>
        </div>
        <button onClick={() => setView(v => v === "new" ? "list" : "new")} style={{ padding: "7px 14px", background: "#6366f1", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>
          {view === "new" ? "← All refunds" : "+ Request refund"}
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { l: "Total requests", v: refunds.length, c: "#6366f1" },
          { l: "Pending", v: refunds.filter(r => r.status === "pending").length, c: "#f59e0b" },
          { l: "Approved", v: "₹" + refunds.filter(r => r.status === "approved").reduce((s, r) => s + Number(r.amount || 0), 0).toLocaleString("en-IN"), c: "#22c55e" },
        ].map(s => (
          <Card key={s.l} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: s.c }}>{s.v}</div>
            <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>{s.l}</div>
          </Card>
        ))}
      </div>

      {view === "new" && (
        <Card style={{ marginBottom: 20 }}>
          <h3 style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Request a refund</h3>
          <Field label="Delivery code" required error={errors.code}>
            <input style={{ ...inp, textTransform: "uppercase", fontFamily: "monospace", letterSpacing: 2 }} maxLength={8} value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value.toUpperCase() }))} placeholder="ABCD1234" />
          </Field>
          <Field label="Reason for refund" required error={errors.reason}>
            <select style={inp} value={form.reason} onChange={e => setForm(p => ({ ...p, reason: e.target.value }))}>
              <option value="">Select reason</option>
              {["Package damaged", "Package lost", "Wrong item", "Late delivery", "Duplicate payment", "Other"].map(r => <option key={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Refund amount (₹) — leave blank for full refund">
            <input style={inp} type="number" min="0" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} placeholder="Full amount if blank" />
          </Field>
          <button onClick={requestRefund} style={{ width: "100%", padding: 11, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff", border: "none", borderRadius: 9, fontWeight: 700, cursor: "pointer", fontSize: 14, fontFamily: "inherit" }}>Submit refund request</button>
        </Card>
      )}

      {view === "list" && (refunds.length === 0 ? (
        <div style={{ textAlign: "center", padding: "3rem", color: "#9ca3af" }}>
          <div style={{ fontSize: 48, marginBottom: 10 }}>💸</div>
          <p>No refund requests yet.</p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {refunds.map(r => (
            <Card key={r.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{r.reason}</div>
                  <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 1 }}>Code: {r.code} · By {r.userName} · {fmtDate(r.requestedAt)}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontWeight: 800, fontSize: 15, color: "#6366f1" }}>₹{r.amount}</div>
                  <Badge label={r.status === "pending" ? "⏳ Pending" : r.status === "approved" ? "✅ Approved" : "❌ Rejected"} color={r.status === "approved" ? "#16a34a" : r.status === "rejected" ? "#dc2626" : "#d97706"} bg={r.status === "approved" ? "#dcfce7" : r.status === "rejected" ? "#fee2e2" : "#fef3c7"} />
                </div>
              </div>
              {r.status === "pending" && session?.role === "admin" && (
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => processRefund(r.id, "approved")} style={{ flex: 1, padding: 8, background: "#dcfce7", color: "#16a34a", border: "none", borderRadius: 7, fontWeight: 700, cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>✅ Approve</button>
                  <button onClick={() => processRefund(r.id, "rejected")} style={{ flex: 1, padding: 8, background: "#fee2e2", color: "#dc2626", border: "none", borderRadius: 7, fontWeight: 700, cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>❌ Reject</button>
                </div>
              )}
              {r.processedAt && <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 6 }}>Processed: {fmt(r.processedAt)}</div>}
            </Card>
          ))}
        </div>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 5. DELIVERY SCHEDULING SYSTEM
// ══════════════════════════════════════════════════════════════════════════════
function SchedulePage({ deliveries, saveDeliveries, toast }) {
  const [view, setView] = useState("calendar"); // "calendar" | "list"
  const today = new Date();
  const [month, setMonth] = useState(today.getMonth());
  const [year, setYear] = useState(today.getFullYear());

  const getDaysInMonth = (m, y) => new Date(y, m + 1, 0).getDate();
  const getFirstDay = (m, y) => new Date(y, m, 1).getDay();

  const daysInMonth = getDaysInMonth(month, year);
  const firstDay = getFirstDay(month, year);

  const deliveriesOnDay = (day) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return deliveries.filter(d => d.createdAt?.startsWith(dateStr) || d.scheduledDate?.startsWith(dateStr));
  };

  const scheduleDelivery = (id, date) => {
    const updated = deliveries.map(d => d.id === id ? { ...d, scheduledDate: date } : d);
    saveDeliveries(updated);
    toast && toast(`Delivery rescheduled to ${fmtDate(date)}`, "success");
  };

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>📅 Scheduling</h1>
          <p style={{ color: "#6b7280", fontSize: 13 }}>View and manage delivery schedules</p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {[["calendar", "🗓 Calendar"], ["list", "📋 List"]].map(([k, l]) => (
            <button key={k} onClick={() => setView(k)} style={{ padding: "6px 12px", border: `1.5px solid ${view === k ? "#6366f1" : "#e5e7eb"}`, borderRadius: 7, background: view === k ? "#ede9fe" : "#fff", color: view === k ? "#6366f1" : "#6b7280", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>{l}</button>
          ))}
        </div>
      </div>

      {view === "calendar" && (
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <button onClick={() => { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); }} style={{ background: "none", border: "1px solid #e5e7eb", borderRadius: 7, padding: "4px 10px", cursor: "pointer", fontSize: 14 }}>←</button>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{monthNames[month]} {year}</div>
            <button onClick={() => { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); }} style={{ background: "none", border: "1px solid #e5e7eb", borderRadius: 7, padding: "4px 10px", cursor: "pointer", fontSize: 14 }}>→</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2, marginBottom: 6 }}>
            {dayNames.map(d => <div key={d} style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: "#9ca3af", padding: "4px 0" }}>{d}</div>)}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2 }}>
            {[...Array(firstDay)].map((_, i) => <div key={`e${i}`} />)}
            {[...Array(daysInMonth)].map((_, i) => {
              const day = i + 1;
              const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
              const onDay = deliveriesOnDay(day);
              return (
                <div key={day} style={{ borderRadius: 8, padding: "6px 4px", background: isToday ? "#ede9fe" : "#f8fafc", border: `1px solid ${isToday ? "#c7d2fe" : "transparent"}`, textAlign: "center", minHeight: 48 }}>
                  <div style={{ fontSize: 12, fontWeight: isToday ? 800 : 500, color: isToday ? "#6366f1" : "#374151", marginBottom: 3 }}>{day}</div>
                  {onDay.slice(0, 2).map(d => <div key={d.id} style={{ width: "80%", margin: "0 auto 2px", height: 4, background: "#6366f1", borderRadius: 999 }} title={d.itemName} />)}
                  {onDay.length > 2 && <div style={{ fontSize: 9, color: "#9ca3af" }}>+{onDay.length - 2}</div>}
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 12, fontSize: 12, color: "#9ca3af", display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 12, height: 4, background: "#6366f1", borderRadius: 999 }} /> = delivery booked/scheduled
          </div>
        </Card>
      )}

      {view === "list" && (
        <div>
          <h3 style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>Reschedule deliveries</h3>
          {deliveries.filter(d => d.status !== "delivered").length === 0 ? (
            <div style={{ textAlign: "center", padding: "2rem", color: "#9ca3af" }}>No active deliveries to reschedule.</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {deliveries.filter(d => d.status !== "delivered").map(d => (
                <Card key={d.id}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{d.itemName}</div>
                      <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 1 }}>{d.code} · {d.recvName}</div>
                      {d.scheduledDate && <div style={{ fontSize: 12, color: "#6366f1", marginTop: 2 }}>📅 Scheduled: {fmtDate(d.scheduledDate)}</div>}
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input type="date" style={{ ...inp, width: "auto" }} min={new Date().toISOString().slice(0, 10)} defaultValue={d.scheduledDate?.slice(0, 10) || ""} onChange={e => scheduleDelivery(d.id, e.target.value)} />
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 6. PROMO CODE SYSTEM
// ══════════════════════════════════════════════════════════════════════════════
function PromoCodePage({ session, toast }) {
  const [codes, setCodes] = useState(() => DB.table("promos").all().length ? DB.table("promos").all() : [
    { id: "p1", code: "SWIFT10", discount: 10, type: "percent", minOrder: 100, uses: 0, maxUses: 100, active: true, createdAt: now() },
    { id: "p2", code: "FLAT50", discount: 50, type: "flat", minOrder: 200, uses: 3, maxUses: 50, active: true, createdAt: now() },
    { id: "p3", code: "NEWUSER", discount: 20, type: "percent", minOrder: 0, uses: 12, maxUses: 200, active: true, createdAt: now() },
  ]);
  const [form, setForm] = useState({ code: "", discount: "", type: "percent", minOrder: "", maxUses: "" });
  const [testCode, setTestCode] = useState("");
  const [testAmount, setTestAmount] = useState("");
  const [testResult, setTestResult] = useState(null);

  const saveCodes = (c) => { setCodes(c); DB.table("promos").save(c); };

  const addCode = () => {
    if (!form.code || !form.discount) { toast && toast("Code and discount required", "error"); return; }
    const nc = { id: genId(), ...form, code: form.code.toUpperCase(), discount: Number(form.discount), minOrder: Number(form.minOrder) || 0, maxUses: Number(form.maxUses) || 999, uses: 0, active: true, createdAt: now() };
    saveCodes([nc, ...codes]);
    setForm({ code: "", discount: "", type: "percent", minOrder: "", maxUses: "" });
    toast && toast("Promo code created!", "success");
  };

  const toggleCode = (id) => saveCodes(codes.map(c => c.id === id ? { ...c, active: !c.active } : c));

  const testPromo = () => {
    const code = codes.find(c => c.code === testCode.toUpperCase() && c.active);
    const amount = Number(testAmount);
    if (!code) { setTestResult({ error: "Code not found or inactive" }); return; }
    if (amount < code.minOrder) { setTestResult({ error: `Minimum order ₹${code.minOrder} required` }); return; }
    if (code.uses >= code.maxUses) { setTestResult({ error: "Code usage limit reached" }); return; }
    const savings = code.type === "percent" ? Math.round(amount * code.discount / 100) : code.discount;
    setTestResult({ savings, final: amount - savings, code });
  };

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>🏷️ Promo Codes</h1>
      <p style={{ color: "#6b7280", fontSize: 13, marginBottom: 20 }}>Create and manage discount codes</p>

      {/* Test promo */}
      <Card style={{ marginBottom: 16, background: "#f8f7ff", border: "1px solid #c7d2fe" }}>
        <h3 style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>🧪 Test a promo code</h3>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input style={{ ...inp, flex: 1, minWidth: 120, textTransform: "uppercase", fontFamily: "monospace", letterSpacing: 2 }} value={testCode} onChange={e => setTestCode(e.target.value.toUpperCase())} placeholder="SWIFT10" />
          <input style={{ ...inp, flex: 1, minWidth: 100 }} type="number" value={testAmount} onChange={e => setTestAmount(e.target.value)} placeholder="Order amount ₹" />
          <button onClick={testPromo} style={{ padding: "8px 16px", background: "#6366f1", color: "#fff", border: "none", borderRadius: 7, fontWeight: 700, cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>Test</button>
        </div>
        {testResult && (
          <div style={{ marginTop: 10, padding: "10px 12px", background: testResult.error ? "#fee2e2" : "#dcfce7", border: `1px solid ${testResult.error ? "#fca5a5" : "#86efac"}`, borderRadius: 8, fontSize: 13 }}>
            {testResult.error ? <span style={{ color: "#991b1b" }}>❌ {testResult.error}</span> : (
              <span style={{ color: "#166534" }}>✅ Saves ₹{testResult.savings} — Final: <strong>₹{testResult.final}</strong> ({testResult.code.discount}{testResult.code.type === "percent" ? "%" : "₹ off"})</span>
            )}
          </div>
        )}
      </Card>

      {/* Add code */}
      {session?.role === "admin" && (
        <Card style={{ marginBottom: 16 }}>
          <h3 style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>➕ Create promo code</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Code"><input style={{ ...inp, textTransform: "uppercase", fontFamily: "monospace" }} value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value.toUpperCase() }))} placeholder="SUMMER20" /></Field>
            <Field label="Discount type"><select style={inp} value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}><option value="percent">Percentage (%)</option><option value="flat">Flat amount (₹)</option></select></Field>
            <Field label={`Discount (${form.type === "percent" ? "%" : "₹"})`}><input style={inp} type="number" value={form.discount} onChange={e => setForm(p => ({ ...p, discount: e.target.value }))} placeholder="e.g. 10" /></Field>
            <Field label="Min order (₹)"><input style={inp} type="number" value={form.minOrder} onChange={e => setForm(p => ({ ...p, minOrder: e.target.value }))} placeholder="0" /></Field>
            <Field label="Max uses"><input style={inp} type="number" value={form.maxUses} onChange={e => setForm(p => ({ ...p, maxUses: e.target.value }))} placeholder="Unlimited" /></Field>
          </div>
          <button onClick={addCode} style={{ padding: "9px 18px", background: "#6366f1", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>Create code</button>
        </Card>
      )}

      {/* Code list */}
      <div style={{ display: "grid", gap: 10 }}>
        {codes.map(c => (
          <Card key={c.id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 16, letterSpacing: 2, color: "#6366f1" }}>{c.code}</span>
                  <Badge label={c.active ? "Active" : "Inactive"} color={c.active ? "#16a34a" : "#9ca3af"} bg={c.active ? "#dcfce7" : "#f3f4f6"} />
                </div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>
                  {c.discount}{c.type === "percent" ? "% off" : "₹ off"} · Min ₹{c.minOrder} · {c.uses}/{c.maxUses} used
                </div>
              </div>
              {session?.role === "admin" && (
                <button onClick={() => toggleCode(c.id)} style={{ padding: "5px 12px", background: c.active ? "#fee2e2" : "#dcfce7", color: c.active ? "#dc2626" : "#16a34a", border: "none", borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                  {c.active ? "Deactivate" : "Activate"}
                </button>
              )}
            </div>
            {/* Usage bar */}
            <div style={{ marginTop: 10 }}>
              <div style={{ background: "#f3f4f6", borderRadius: 999, height: 4 }}>
                <div style={{ width: `${Math.min((c.uses / c.maxUses) * 100, 100)}%`, background: "#6366f1", borderRadius: 999, height: 4 }} />
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 7. LIVE CHAT / SUPPORT CHAT
// ══════════════════════════════════════════════════════════════════════════════
function LiveChatPage({ session, toast }) {
  const [messages, setMessages] = useState([
    { id: "m1", from: "support", text: "Hi! Welcome to SwiftDeliver support. How can I help you today? 👋", at: now() },
  ]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const bottomRef = useRef(null);

  const QUICK = ["Track my delivery", "Request a refund", "Change delivery address", "Agent contact details", "Payment issue", "Cancel my order"];

  const AUTO_REPLIES = {
    track: "To track your delivery, go to the **Track** page and enter your 8-character code. You can see live status updates there.",
    refund: "For refunds, please visit the **Refunds** section. Refunds take 3–5 business days and will be returned to your original payment method.",
    address: "You can update the delivery address by contacting the agent directly. Agent details are shown on your tracking page.",
    agent: "Your assigned agent's name and phone number are displayed on your tracking page under 'Delivery Agent'.",
    payment: "For payment issues, please use the Disputes section to raise a case. Our team responds within 4–6 hours.",
    cancel: "To cancel a delivery, please raise a dispute with reason 'Other' and our team will assist you within 24 hours.",
    default: "Thank you for reaching out! A support agent will be with you shortly. In the meantime, you can check our FAQ or use the Disputes section for urgent issues.",
  };

  const getReply = (msg) => {
    const m = msg.toLowerCase();
    if (m.includes("track") || m.includes("code") || m.includes("status")) return AUTO_REPLIES.track;
    if (m.includes("refund") || m.includes("money back")) return AUTO_REPLIES.refund;
    if (m.includes("address") || m.includes("location")) return AUTO_REPLIES.address;
    if (m.includes("agent") || m.includes("driver") || m.includes("contact")) return AUTO_REPLIES.agent;
    if (m.includes("payment") || m.includes("pay") || m.includes("charge")) return AUTO_REPLIES.payment;
    if (m.includes("cancel")) return AUTO_REPLIES.cancel;
    return AUTO_REPLIES.default;
  };

  const send = (text) => {
    if (!text.trim()) return;
    const userMsg = { id: genId(), from: "user", text, at: now() };
    setMessages(p => [...p, userMsg]);
    setInput("");
    setTyping(true);
    setTimeout(() => {
      setTyping(false);
      const reply = { id: genId(), from: "support", text: getReply(text), at: now() };
      setMessages(p => [...p, reply]);
    }, 1200 + Math.random() * 800);
  };

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, typing]);

  return (
    <div style={{ maxWidth: 520 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>💬 Live Chat Support</h1>
      <p style={{ color: "#6b7280", fontSize: 13, marginBottom: 16 }}>Chat with our support team</p>

      {/* Chat window */}
      <Card style={{ padding: 0, overflow: "hidden" }}>
        {/* Header */}
        <div style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)", padding: "12px 16px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 36, height: 36, background: "rgba(255,255,255,.2)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🛡️</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: "#fff" }}>SwiftDeliver Support</div>
            <div style={{ fontSize: 11, color: "#c4b5fd", display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{ width: 7, height: 7, background: "#4ade80", borderRadius: "50%" }} /> Online — typically replies in minutes
            </div>
          </div>
        </div>

        {/* Messages */}
        <div style={{ height: 340, overflowY: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10, background: "#f8fafc" }}>
          {messages.map(m => (
            <div key={m.id} style={{ display: "flex", justifyContent: m.from === "user" ? "flex-end" : "flex-start", gap: 8, alignItems: "flex-end" }}>
              {m.from === "support" && <div style={{ width: 28, height: 28, background: "#ede9fe", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>🛡️</div>}
              <div style={{ maxWidth: "75%", background: m.from === "user" ? "#6366f1" : "#fff", color: m.from === "user" ? "#fff" : "#111", padding: "9px 12px", borderRadius: m.from === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px", fontSize: 13, boxShadow: "0 1px 4px rgba(0,0,0,.08)", lineHeight: 1.5 }}>
                {m.text}
                <div style={{ fontSize: 10, opacity: 0.6, marginTop: 4, textAlign: "right" }}>{new Date(m.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</div>
              </div>
            </div>
          ))}
          {typing && (
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <div style={{ width: 28, height: 28, background: "#ede9fe", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>🛡️</div>
              <div style={{ background: "#fff", padding: "10px 14px", borderRadius: "12px 12px 12px 2px", boxShadow: "0 1px 4px rgba(0,0,0,.08)", display: "flex", gap: 4, alignItems: "center" }}>
                {[0, 1, 2].map(i => <div key={i} style={{ width: 7, height: 7, background: "#d1d5db", borderRadius: "50%", animation: `bounce 1s infinite ${i * 0.15}s` }} />)}
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Quick replies */}
        <div style={{ padding: "8px 12px", borderTop: "1px solid #f3f4f6", display: "flex", gap: 6, overflowX: "auto" }}>
          {QUICK.map(q => (
            <button key={q} onClick={() => send(q)} style={{ whiteSpace: "nowrap", padding: "4px 10px", border: "1px solid #e5e7eb", borderRadius: 999, background: "#fff", color: "#6b7280", fontSize: 11, fontWeight: 500, cursor: "pointer", fontFamily: "inherit" }}>{q}</button>
          ))}
        </div>

        {/* Input */}
        <div style={{ padding: "10px 12px", borderTop: "1px solid #e5e7eb", display: "flex", gap: 8 }}>
          <input style={{ ...inp, borderRadius: 999 }} value={input} onChange={e => setInput(e.target.value)} placeholder="Type a message..." onKeyDown={e => e.key === "Enter" && send(input)} />
          <button onClick={() => send(input)} disabled={!input.trim()} style={{ padding: "0 18px", background: input.trim() ? "#6366f1" : "#e5e7eb", color: input.trim() ? "#fff" : "#9ca3af", border: "none", borderRadius: 999, fontWeight: 700, cursor: input.trim() ? "pointer" : "not-allowed", fontSize: 16 }}>→</button>
        </div>
      </Card>

      <style>{`@keyframes bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-6px)}}`}</style>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 8. API DOCUMENTATION PAGE
// ══════════════════════════════════════════════════════════════════════════════
function ApiDocsPage() {
  const [activeEndpoint, setActiveEndpoint] = useState(null);
  const ENDPOINTS = [
    { method: "POST", path: "/api/deliveries", tag: "Deliveries", desc: "Create a new delivery booking", body: { itemName: "Laptop", category: "Electronics", weight: 2.5, priority: "express", senderName: "John Doe", senderPhone: "+91 98765 43210", senderAddr: "123 MG Road, Delhi", recvName: "Jane Smith", recvPhone: "+91 91234 56789", recvAddr: "45 Park St, Mumbai – 400001" }, response: { id: "abc12345", code: "XYZABC12", status: "booked", fee: 165, agentId: "ag1", createdAt: "2025-01-01T10:00:00.000Z" } },
    { method: "GET", path: "/api/deliveries/:code", tag: "Deliveries", desc: "Get delivery by tracking code", response: { id: "abc12345", code: "XYZABC12", status: "in_transit", itemName: "Laptop", timeline: [{ status: "booked", at: "2025-01-01T10:00:00.000Z" }, { status: "picked_up", at: "2025-01-01T12:30:00.000Z" }] } },
    { method: "PATCH", path: "/api/deliveries/:id/status", tag: "Deliveries", desc: "Advance delivery status (agents only)", body: { status: "out_for_delivery", note: "Leaving warehouse" }, response: { id: "abc12345", status: "out_for_delivery", updatedAt: "2025-01-01T15:00:00.000Z" } },
    { method: "GET", path: "/api/deliveries", tag: "Deliveries", desc: "List all deliveries (admin only, paginated)", response: { data: [], total: 42, page: 1, perPage: 20 } },
    { method: "POST", path: "/api/auth/register", tag: "Auth", desc: "Register a new user account", body: { name: "John Doe", email: "john@example.com", password: "secret123", role: "sender" }, response: { user: { id: "u1", name: "John Doe", role: "sender" }, token: "eyJhbGci..." } },
    { method: "POST", path: "/api/auth/login", tag: "Auth", desc: "Login and get JWT token", body: { email: "john@example.com", password: "secret123" }, response: { token: "eyJhbGci...", user: { id: "u1", name: "John Doe", role: "sender" } } },
    { method: "POST", path: "/api/refunds", tag: "Refunds", desc: "Submit a refund request", body: { deliveryCode: "XYZABC12", reason: "Package damaged", amount: 165 }, response: { id: "r1", status: "pending", createdAt: "2025-01-01T16:00:00.000Z" } },
    { method: "GET", path: "/api/analytics/overview", tag: "Analytics", desc: "Get platform analytics (admin only)", response: { totalDeliveries: 342, totalRevenue: 48600, deliveryRate: 87, byStatus: { booked: 12, delivered: 298 } } },
    { method: "POST", path: "/api/promos/validate", tag: "Promos", desc: "Validate a promo code", body: { code: "SWIFT10", amount: 500 }, response: { valid: true, discount: 50, finalAmount: 450 } },
    { method: "POST", path: "/api/disputes", tag: "Support", desc: "Open a support case", body: { deliveryCode: "XYZABC12", type: "Package damaged", description: "Box arrived crushed" }, response: { id: "d1", status: "open", caseNumber: "CAS-001" } },
  ];

  const TAGS = [...new Set(ENDPOINTS.map(e => e.tag))];
  const [activeTag, setActiveTag] = useState("Deliveries");
  const METHOD_COLORS = { GET: { c: "#16a34a", bg: "#dcfce7" }, POST: { c: "#2563eb", bg: "#dbeafe" }, PATCH: { c: "#d97706", bg: "#fef3c7" }, DELETE: { c: "#dc2626", bg: "#fee2e2" } };

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>📚 API Documentation</h1>
      <p style={{ color: "#6b7280", fontSize: 13, marginBottom: 6 }}>SwiftDeliver REST API · Base URL: <code style={{ background: "#f3f4f6", padding: "1px 6px", borderRadius: 4, fontSize: 12 }}>https://api.swiftdeliver.in/v1</code></p>
      <div style={{ background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#92400e", marginBottom: 20 }}>
        🔑 All authenticated endpoints require: <code style={{ background: "#fff7ed", padding: "1px 5px", borderRadius: 3 }}>Authorization: Bearer &lt;token&gt;</code>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
        {TAGS.map(t => (
          <button key={t} onClick={() => setActiveTag(t)} style={{ padding: "5px 14px", border: `1.5px solid ${activeTag === t ? "#6366f1" : "#e5e7eb"}`, borderRadius: 999, background: activeTag === t ? "#ede9fe" : "#fff", color: activeTag === t ? "#6366f1" : "#6b7280", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>{t}</button>
        ))}
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {ENDPOINTS.filter(e => e.tag === activeTag).map((e, i) => {
          const mc = METHOD_COLORS[e.method];
          const isOpen = activeEndpoint === i;
          return (
            <Card key={i} style={{ padding: 0, overflow: "hidden" }}>
              <div onClick={() => setActiveEndpoint(isOpen ? null : i)} style={{ padding: "12px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}>
                <Badge label={e.method} color={mc.c} bg={mc.bg} />
                <code style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: "#374151", flex: 1 }}>{e.path}</code>
                <span style={{ fontSize: 12, color: "#9ca3af", marginRight: 4 }}>{e.desc}</span>
                <span style={{ color: "#9ca3af", fontSize: 14 }}>{isOpen ? "▲" : "▼"}</span>
              </div>
              {isOpen && (
                <div style={{ borderTop: "1px solid #f3f4f6", padding: "14px" }}>
                  <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 14 }}>{e.desc}</p>
                  {e.body && (
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Request body</div>
                      <pre style={{ background: "#1e293b", color: "#e2e8f0", borderRadius: 8, padding: "12px 14px", fontSize: 12, overflowX: "auto", margin: 0 }}>{JSON.stringify(e.body, null, 2)}</pre>
                    </div>
                  )}
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Response</div>
                    <pre style={{ background: "#1e293b", color: "#86efac", borderRadius: 8, padding: "12px 14px", fontSize: 12, overflowX: "auto", margin: 0 }}>{JSON.stringify(e.response, null, 2)}</pre>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════════════════
// ROOT APP — assembles all pages
// ══════════════════════════════════════════════════════════════════════════════
function App() {
  const [page, setPage] = React.useState("home");
  const [session, setSession] = React.useState(null);
  const [deliveries, setDeliveriesState] = React.useState([]);
  const [agents, setAgents] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [startupError, setStartupError] = React.useState("");
  const [toasts, setToasts] = React.useState([]);
  const notifications = generateNotifications(deliveries, session);

const [readNotifications, setReadNotifications] = React.useState(() => {
  try {
    return JSON.parse(localStorage.getItem("sd_read_notifs")) || [];
  } catch {
    return [];
  }
});

const unreadCount = notifications.filter(
  n => !readNotifications.includes(n.id)
).length;
  const [modal, setModal] = React.useState(null);
    // Test Supabase database connection
  const testSupabaseConnection = async () => {
    const { data, error } = await supabase
      .from("agents")
      .select("*");

    if (error) {
      console.error("Supabase Error:", error);
    } else {
      console.log("Supabase Connected Successfully!");
      console.log("Agents Data:", data);
    }
  };
    React.useEffect(() => {
    testSupabaseConnection();
  }, []);
  const [darkMode, setDarkMode] = React.useState(() => Store.get("sd_dark") === true);

  const toggleDark = () => {
    const next = !darkMode;
    setDarkMode(next);
    Store.set("sd_dark", next);
  };

  const loadSessionProfile = async (authUser) => {
  if (!authUser) {
    setSession(null);
    return;
  }

  try {
    const profile = await Store.getProfile(authUser.id);

    if (!profile) {
      console.error("Profile not found for authenticated user.");
      setSession(null);
      return;
    }

    setSession(profile);

  } catch (e) {
    console.error("loadSessionProfile failed:", e);

    setSession(null);

    addToast(
      e?.message ||
        "Unable to load your profile. Please refresh and try again.",
      "error"
    );
  }
};
React.useEffect(() => {
  // Initial data loading
  (async () => {
    try {
      const sess = await Store.getCurrentSession();
      await loadSessionProfile(sess?.user || null);

     const d = await Store.getDeliveries();

if (!Array.isArray(d)) {
  throw new Error("Unable to load delivery data.");
}

setDeliveriesState(d);

const a = await Store.getAgents();

if (!Array.isArray(a)) {
  throw new Error("Unable to load delivery agents.");
}

setAgents(a);

    } catch (e) {
  console.error("Startup load failed:", e);
  setStartupError(
    e?.message || "Unable to load SwiftDeliver. Please try again."
  );
} finally {
  setLoading(false);
}
  })();

  // Auth listener
  let listener;
try {
  ({ data: listener } = sb.auth.onAuthStateChange((_event, sess) => {

    if (_event === "PASSWORD_RECOVERY") {
      setPage("reset-password");
      return;
    }

    loadSessionProfile(sess?.user || null);
  }));

  // Check whether this page was opened from a password reset link
  const hash = window.location.hash || "";
  const search = window.location.search || "";

  if (
    hash.includes("type=recovery") ||
    search.includes("type=recovery")
  ) {
    setPage("reset-password");
  }

} catch (e) {
    console.error("Auth listener failed:", e);
  }

  // 🔥 SUPABASE REALTIME LISTENER
 // 🔥 SUPABASE REALTIME LISTENER
const deliveryChannel = sb
  .channel("deliveries-realtime-" + Date.now())
  .on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "deliveries",
    },
    (payload) => {
      console.log("🔥 REALTIME EVENT RECEIVED:", payload);

     Store.getDeliveries()
  .then((updatedDeliveries) => {
    console.log("🔥 UPDATED DELIVERIES:", updatedDeliveries);

    if (!Array.isArray(updatedDeliveries)) {
      throw new Error("Unable to refresh delivery data.");
    }

    setDeliveriesState(updatedDeliveries);
  })
  .catch((error) => {
    console.error("Realtime delivery refresh failed:", error);

    addToast(
      error?.message ||
        "Unable to refresh delivery updates. Please try again.",
      "error"
    );
  });
    }
  )
  .subscribe((status) => {
  console.log("🔥 REALTIME STATUS:", status);
});

// 🔄 Automatic fallback check every 2 seconds
const deliveryPolling = setInterval(async () => {
  try {
    const updatedDeliveries = await Store.getDeliveries();

    setDeliveriesState((currentDeliveries) => {
      const currentData = JSON.stringify(currentDeliveries);
      const newData = JSON.stringify(updatedDeliveries);

      if (currentData !== newData) {
        console.log("🔄 Automatic delivery update detected");
        return updatedDeliveries;
      }

      return currentDeliveries;
    });
  } catch (error) {
    console.error("Automatic delivery check failed:", error);
  }
}, 2000);

// Cleanup listeners
return () => {
  listener?.subscription?.unsubscribe();

  sb.removeChannel(deliveryChannel);

  clearInterval(deliveryPolling);
};

}, []);

 const saveDeliveries = async (d) => {
  try {
    const success = await Store.setDeliveries(d);

    if (!success) {
      console.error("Failed to save deliveries to Supabase");

      addToast(
        "Unable to save changes. Please try again.",
        "error"
      );

      return false;
    }

    setDeliveriesState(d);

    return true;

  } catch (error) {
    console.error("saveDeliveries failed:", error);

    addToast(
      error?.message ||
        "Unable to save changes. Please check your connection and try again.",
      "error"
    );

    return false;
  }
};

 const advanceStatus = async (id) => {
  try {
    const delivery = deliveries.find(d => d.id === id);

    if (!delivery) {
      addToast("Delivery not found.", "error");
      return;
    }

    const idx = STATUS_FLOW.indexOf(delivery.status);

    if (idx < 0) {
      addToast("Invalid delivery status.", "error");
      return;
    }

    if (idx >= STATUS_FLOW.length - 1) {
      addToast("Delivery is already completed.", "info");
      return;
    }

    const next = STATUS_FLOW[idx + 1];

    const updated = deliveries.map(d => {
      if (d.id !== id) return d;

      return {
        ...d,
        status: next,
        timeline: [
          ...(d.timeline || []),
          {
            status: next,
            at: now(),
            note: `Delivery status changed to ${next}`
          }
        ]
      };
    });

    const success = await saveDeliveries(updated);

    if (success) {
      addToast(
        "Delivery status updated successfully!",
        "success"
      );
    } else {
      addToast(
        "Failed to update delivery status. Please try again.",
        "error"
      );
    }

  } catch (error) {
    console.error("Advance status failed:", error);

    addToast(
      error?.message ||
        "Unable to update delivery status. Please try again.",
      "error"
    );
  }
};

  const addToast = (msg, type = "success") => {
    const t = { id: genId(), msg, type };
    setToasts(p => [...p, t]);
    setTimeout(() => setToasts(p => p.filter(x => x.id !== t.id)), 3500);
  };

  const login = (user) => { setSession(user); addToast("Welcome, " + user.name + "!"); };
  const logout = async () => { await Store.signOut(); setSession(null); setPage("home"); addToast("Logged out", "info"); };
if (loading) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#6b7280",
        fontSize: 14
      }}
    >
      Loading SwiftDeliver…
    </div>
  );
}

if (startupError) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "#f9fafb"
      }}
    >
      <div
        style={{
          maxWidth: 480,
          width: "100%",
          textAlign: "center",
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 16,
          padding: 28,
          boxShadow: "0 10px 30px rgba(0,0,0,0.06)"
        }}
      >
        <h2 style={{ margin: "0 0 10px", color: "#111827" }}>
          Unable to load SwiftDeliver
        </h2>

        <p style={{ margin: "0 0 20px", color: "#6b7280", fontSize: 14 }}>
          {startupError}
        </p>

        <button
          onClick={() => window.location.reload()}
          style={{
            border: "none",
            borderRadius: 10,
            padding: "10px 18px",
            background: "#111827",
            color: "#fff",
            cursor: "pointer",
            fontWeight: 600
          }}
        >
          Retry
        </button>
      </div>
    </div>
  );
}

  const shared = { session, deliveries, agents, saveDeliveries, advanceStatus, toast: addToast, setPage, login, logout, setModal };

  const renderPage = () => {
    if (page === "home")         return <HomePage setPage={setPage} session={session} deliveries={deliveries} />;
    if (page === "send")         return <SenderPage {...shared} />;
    if (page === "track")        return <ReceiverPage {...shared} />;
   if (page === "agent") {
  if (session?.role !== "agent") {
    addToast("Access denied. Agent account required.", "error");
    setPage("home");
    return <HomePage setPage={setPage} session={session} deliveries={deliveries} />;
  }

  return <AgentPanel {...shared} />;
}

if (page === "admin") {
  if (session?.role !== "admin") {
    addToast("Access denied. Admin account required.", "error");
    setPage("home");
    return <HomePage setPage={setPage} session={session} deliveries={deliveries} />;
  }

  return <AdminPanel {...shared} />;
}
    if (page === "dashboard")    return <Dashboard session={session} deliveries={deliveries} setPage={setPage} />;
    if (page === "history")      return <HistoryPage session={session} deliveries={deliveries} setPage={setPage} />;
    if (page === "reset-password") return <ResetPasswordPage setPage={setPage} toast={addToast} />;
    if (page === "login")        return <LoginPage login={login} setPage={setPage} toast={addToast} />;
    if (page === "register")     return <RegisterPage login={login} setPage={setPage} toast={addToast} />;
    if (page === "notifications") return <NotificationsPage deliveries={deliveries} session={session} />;
    if (page === "invoice") {
      const myD = deliveries.filter(d => session?.role === "admin" || d.senderId === session?.id);
      return <InvoicePage delivery={myD[0] || null} />;
    }
    if (page === "ratings") {
      const done = deliveries.filter(d => d.status === "delivered" && (session?.role === "admin" || d.senderId === session?.id));
      return <RatingPage delivery={done[0] || null} onSubmit={(r) => addToast("Rating submitted!", "success")} />;
    }
    if (page === "disputes")     return <DisputePage deliveries={deliveries} session={session} toast={addToast} />;
    if (page === "analytics") {
  if (session?.role !== "admin") {
    addToast("Access denied. Admin account required.", "error");
    setPage("home");
    return <HomePage setPage={setPage} session={session} deliveries={deliveries} />;
  }

  return <AnalyticsPage deliveries={deliveries} />;
}
    if (page === "settings")     return <SettingsPage session={session} onUpdateSession={(u) => setSession(u)} toast={addToast} />;
    if (page === "bulk")         return <BulkBookingPage {...shared} />;
    if (page === "tracker") {
      const d = deliveries[0] || null;
      return <LiveTrackerPage delivery={d} />;
    }
    if (page === "cod")          return <CODTrackerPage deliveries={deliveries} saveDeliveries={saveDeliveries} toast={addToast} />;
    if (page === "refunds")      return <RefundPage deliveries={deliveries} saveDeliveries={saveDeliveries} session={session} toast={addToast} />;
    if (page === "schedule")     return <SchedulePage deliveries={deliveries} saveDeliveries={saveDeliveries} toast={addToast} />;
    if (page === "promo")        return <PromoCodePage session={session} toast={addToast} />;
    if (page === "chat")         return <LiveChatPage session={session} toast={addToast} />;
    if (page === "apidocs")      return <ApiDocsPage />;
    if (page === "eta")          return <ETACalculator />;
    return <HomePage setPage={setPage} session={session} deliveries={deliveries} />;
  };

  const ALL_PAGES = [
    { label: "Home", page: "home", icon: "🏠" },
    { label: "Send", page: "send", icon: "📦" },
    { label: "Track", page: "track", icon: "📡" },
    { label: "Notifications", page: "notifications", icon: "🔔" },
    { label: "Analytics", page: "analytics", icon: "📊" },
    { label: "Disputes", page: "disputes", icon: "⚖️" },
    { label: "Settings", page: "settings", icon: "⚙️" },
    { label: "Bulk Booking", page: "bulk", icon: "📋" },
    { label: "COD Tracker", page: "cod", icon: "💵" },
    { label: "Refunds", page: "refunds", icon: "↩️" },
    { label: "Schedule", page: "schedule", icon: "📅" },
    { label: "Promo Codes", page: "promo", icon: "🎉" },
    { label: "Live Chat", page: "chat", icon: "💬" },
    { label: "API Docs", page: "apidocs", icon: "📚" },
    { label: "ETA Calc", page: "eta", icon: "⏱" },
    ...(session?.role === "admin"  ? [{ label: "Admin", page: "admin", icon: "🛠" }] : []),
    ...(session?.role === "agent"  ? [{ label: "Agent Panel", page: "agent", icon: "🛵" }] : []),
    ...(session ? [{ label: "Dashboard", page: "dashboard", icon: "📈" }, { label: "History", page: "history", icon: "🗂" }, { label: "Invoice", page: "invoice", icon: "🧾" }, { label: "Ratings", page: "ratings", icon: "⭐" }] : []),
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", filter: darkMode ? "invert(1) hue-rotate(180deg)" : "none", transition: "filter .25s" }}>
      {!SUPABASE_CONFIGURED && (
        <div style={{ background: "#fef3c7", color: "#92400e", textAlign: "center", padding: "8px 16px", fontSize: 13, fontWeight: 600 }}>
          ⚠️ Supabase not configured yet — login, sign up, and bookings won't work until you set SUPABASE_URL / SUPABASE_ANON_KEY near the top of the file.
        </div>
      )}
      <style>{darkMode ? "canvas{filter:invert(1) hue-rotate(180deg);}" : ""}</style>
      {toasts.map(t => <Toast key={t.id} msg={t.msg} type={t.type} onClose={() => setToasts(p => p.filter(x => x.id !== t.id))} />)}
      {modal && <Modal modal={modal} setModal={setModal} />}

      {/* Navbar */}
      <nav style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "0 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", height: 58, position: "sticky", top: 0, zIndex: 100, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }} onClick={() => setPage("home")}>
          <div style={{ width: 34, height: 34, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🚀</div>
          <span style={{ fontWeight: 800, fontSize: 17, color: "#0f172a" }}>SwiftDeliver</span>
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
         {[
  ["Send", "send"],
  ["Track", "track"],
  ["🔔 Notifications", "notifications"],
  ["Analytics", "analytics"],
  ["Disputes", "disputes"],
  ["Chat", "chat"],
  ["ETA", "eta"],
  ["Promo", "promo"],
            ...(session?.role==="admin"?[["Admin","admin"]]:session?.role==="agent"?[["Agent","agent"]]:[]),
            ...(session?[["History","history"],["Settings","settings"]]:[])]
            .map(([l, p]) => (
  <button
    key={p}
    onClick={() => setPage(p)}
    style={{
      position: "relative",
      padding: "5px 12px",
      border: "none",
      background: page === p ? "#ede9fe" : "transparent",
      color: page === p ? "#6366f1" : "#6b7280",
      borderRadius: 7,
      fontWeight: 600,
      fontSize: 12,
      cursor: "pointer"
    }}
  >
    {l}

    {p === "notifications" && unreadCount > 0 && (
      <span
        style={{
          position: "absolute",
          top: -7,
          right: -5,
          minWidth: 17,
          height: 17,
          padding: "0 4px",
          borderRadius: "50%",
          background: "#ef4444",
          color: "#fff",
          fontSize: 9,
          fontWeight: 700,
          display: "flex",
          alignItems: "center",
          justifyContent: "center"
        }}
      >
        {unreadCount > 99 ? "99+" : unreadCount}
      </span>
    )}
  </button>
))}
          <button onClick={toggleDark} title={darkMode ? "Switch to light mode" : "Switch to dark mode"} style={{ padding: "5px 10px", border: "1px solid #e5e7eb", background: "#fff", borderRadius: 7, fontSize: 14, cursor: "pointer", lineHeight: 1 }}>{darkMode ? "☀️" : "🌙"}</button>
          {session ? (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#6366f1", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 13, fontWeight: 700 }}>{session.name[0]}</div>
              <button onClick={logout} style={{ padding: "5px 12px", border: "1px solid #e5e7eb", background: "#fff", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", color: "#374151" }}>Log out</button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setPage("login")} style={{ padding: "5px 12px", border: "1px solid #d1d5db", background: "transparent", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", color: "#374151" }}>Log in</button>
              <button onClick={() => setPage("register")} style={{ padding: "5px 12px", border: "none", background: "#6366f1", color: "#fff", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Sign up</button>
            </div>
          )}
        </div>
      </nav>

      <div style={{ maxWidth: 960, margin: "0 auto", padding: "1.5rem 1rem 5rem" }}>
        {renderPage()}
      </div>
    </div>
  );
}

export default App;
