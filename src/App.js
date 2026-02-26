
import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

// ─── SUPABASE ─────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const SAMPLE_CATEGORIES = ["Elektronik", "Giyim", "Gıda", "Kırtasiye", "Temizlik", "Araç-Gereç"];
const SAMPLE_BRANDS = ["Samsung", "Nike", "Ülker", "Staedtler", "Mr. Muscle", "Bosch"];
const generateId = () => Math.random().toString(36).substr(2, 9);
const now = () => new Date().toISOString();

// DB row -> app object mappers
const mapProduct = (r) => ({
  id: r.id, name: r.name, sku: r.sku, barcode: r.barcode || "",
  category: r.category || "", brand: r.brand || "", variant: r.variant || "",
  minStock: r.min_stock, stock: r.stock, description: r.description || "",
  createdAt: r.created_at,
});
const mapMovement = (r) => ({
  id: r.id, productId: r.product_id, productName: r.product_name,
  type: r.type, quantity: r.quantity, prevStock: r.prev_stock,
  nextStock: r.next_stock, user: r.username, note: r.note || "",
  createdAt: r.created_at,
});
const mapUser = (r) => ({
  id: r.id, name: r.name, username: r.username,
  password: r.password_hash, role: r.role,
});

// ─── ICONS ────────────────────────────────────────────────────────────────────
const Icon = ({ name, size = 18 }) => {
  const icons = {
    dashboard: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>,
    products: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>,
    movements: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>,
    barcode: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 5v14M7 5v14M11 5v14M15 5v14M19 5v14M21 5v14"/><rect x="1" y="3" width="22" height="18" rx="2"/></svg>,
    reports: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>,
    settings: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 0-14.14 0"/><path d="M4.93 19.07a10 10 0 0 0 14.14 0"/></svg>,
    logout: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
    plus: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
    search: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
    warning: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
    trending_up: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
    trending_down: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>,
    download: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
    upload: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
    check: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>,
    x: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
    edit: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
    eye: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
    inventory: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 8h14M5 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>,
    scan: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="3" y1="12" x2="21" y2="12"/></svg>,
    refresh: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>,
  };
  return icons[name] || null;
};

// ─── UTILS ────────────────────────────────────────────────────────────────────
const formatDate = (iso) => {
  const d = new Date(iso);
  return d.toLocaleDateString("tr-TR") + " " + d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
};

const downloadCSV = (data, filename) => {
  if (!data.length) return;
  const headers = Object.keys(data[0]).join(",");
  const rows = data.map(r => Object.values(r).map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + headers + "\n" + rows], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
};

// ─── LOGIN ────────────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!username || !password) { setError("Kullanıcı adı ve şifre gerekli"); return; }
    setLoading(true);
    setError("");
    try {
      const { data, error: dbErr } = await supabase
        .from("app_users")
        .select("*")
        .eq("username", username)
        .eq("password_hash", password)
        .eq("is_active", true)
        .single();
      if (dbErr || !data) { setError("Kullanıcı adı veya şifre hatalı"); }
      else { onLogin(mapUser(data)); }
    } catch (e) { setError("Bağlantı hatası, lütfen tekrar deneyin"); }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&display=swap');`}</style>
      <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 24, padding: "48px 40px", width: 400, backdropFilter: "blur(20px)" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ width: 56, height: 56, background: "linear-gradient(135deg, #3b82f6, #8b5cf6)", borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
            <Icon name="inventory" size={28} />
          </div>
          <h1 style={{ color: "#f8fafc", fontSize: 24, fontWeight: 700, margin: 0 }}>StokPro</h1>
          <p style={{ color: "#64748b", margin: "6px 0 0", fontSize: 14 }}>Stok Takip & Sayım Sistemi</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={{ color: "#94a3b8", fontSize: 13, fontWeight: 500, display: "block", marginBottom: 6 }}>Kullanıcı Adı</label>
            <input value={username} onChange={e => setUsername(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()}
              style={{ width: "100%", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "12px 14px", color: "#f1f5f9", fontSize: 15, outline: "none", boxSizing: "border-box" }}
              placeholder="admin" />
          </div>
          <div>
            <label style={{ color: "#94a3b8", fontSize: 13, fontWeight: 500, display: "block", marginBottom: 6 }}>Şifre</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()}
              style={{ width: "100%", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "12px 14px", color: "#f1f5f9", fontSize: 15, outline: "none", boxSizing: "border-box" }}
              placeholder="••••••••" />
          </div>
          {error && <p style={{ color: "#ef4444", fontSize: 13, margin: 0 }}>{error}</p>}
          <button onClick={handleLogin} style={{ background: "linear-gradient(135deg, #3b82f6, #8b5cf6)", border: "none", borderRadius: 10, padding: "13px", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer", marginTop: 4 }}>
            Giriş Yap
          </button>
        </div>

      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);
  const [page, setPage] = useState("dashboard");
  const [products, setProducts] = useState([]);
  const [movements, setMovements] = useState([]);
  const [appUsers, setAppUsers] = useState([]);
  const [notification, setNotification] = useState(null);
  const [loading, setLoading] = useState(false);

  const notify = (msg, type = "success") => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 3000);
  };

  // Load data from Supabase after login
  useEffect(() => {
    if (!user) return;
    const loadData = async () => {
      setLoading(true);
      try {
        const [{ data: prods }, { data: moves }, { data: users }] = await Promise.all([
          supabase.from("products").select("*").order("created_at", { ascending: false }),
          supabase.from("movements").select("*").order("created_at", { ascending: false }),
          supabase.from("app_users").select("*"),
        ]);
        if (prods) setProducts(prods.map(mapProduct));
        if (moves) setMovements(moves.map(mapMovement));
        if (users) setAppUsers(users.map(mapUser));
      } catch (e) { notify("Veriler yüklenirken hata oluştu", "error"); }
      setLoading(false);
    };
    loadData();
  }, [user]);

  if (!user) return <LoginScreen onLogin={setUser} appUsers={appUsers} setAppUsers={setAppUsers} />;
  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#0f172a", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
      <div style={{ width: 48, height: 48, border: "3px solid #1e293b", borderTop: "3px solid #3b82f6", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <div style={{ color: "#475569", fontSize: 14 }}>Veriler yükleniyor...</div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  const criticalProducts = products.filter(p => p.stock <= p.minStock);

  const pages = {
    dashboard: <Dashboard products={products} movements={movements} criticalProducts={criticalProducts} setPage={setPage} />,
    products: <ProductsPage products={products} setProducts={setProducts} movements={movements} setMovements={setMovements} user={user} notify={notify} />,
    movements: <MovementsPage movements={movements} products={products} setMovements={setMovements} setProducts={setProducts} user={user} notify={notify} />,
    counting: <CountingPage products={products} setProducts={setProducts} movements={movements} setMovements={setMovements} user={user} notify={notify} />,
    reports: <ReportsPage products={products} movements={movements} criticalProducts={criticalProducts} />,
    settings: <SettingsPage user={user} setUser={setUser} appUsers={appUsers} setAppUsers={setAppUsers} notify={notify} />,
  };

  const navItems = [
    { id: "dashboard", label: "Özet", icon: "dashboard" },
    { id: "products", label: "Ürünler", icon: "products" },
    { id: "movements", label: "Hareketler", icon: "movements" },
    { id: "counting", label: "Sayım", icon: "scan" },
    { id: "reports", label: "Raporlar", icon: "reports" },
    { id: "settings", label: "Ayarlar", icon: "settings" },
  ];

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#0f172a", fontFamily: "'DM Sans', sans-serif", color: "#f1f5f9" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=Space+Mono:wght@700&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: #334155; border-radius: 3px; }
        input, select, textarea { font-family: 'DM Sans', sans-serif; }
        .nav-item:hover { background: rgba(255,255,255,0.06) !important; }
        .table-row:hover { background: rgba(59,130,246,0.06) !important; }
        .btn-hover:hover { opacity: 0.88; transform: translateY(-1px); }
        .card-hover:hover { border-color: rgba(59,130,246,0.3) !important; }
        @keyframes slideIn { from { opacity:0; transform:translateY(-10px); } to { opacity:1; transform:translateY(0); } }
        @keyframes pulse { 0%,100%{opacity:1;} 50%{opacity:0.6;} }
      `}</style>

      {/* Sidebar */}
      <aside style={{ width: 220, background: "#0b1120", borderRight: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", position: "fixed", height: "100vh", zIndex: 100 }}>
        <div style={{ padding: "24px 20px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 36, height: 36, background: "linear-gradient(135deg, #3b82f6, #8b5cf6)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Icon name="inventory" size={20} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, color: "#f8fafc" }}>StokPro</div>
              <div style={{ fontSize: 11, color: "#475569" }}>v1.0</div>
            </div>
          </div>
        </div>

        <nav style={{ flex: 1, padding: "12px 10px", display: "flex", flexDirection: "column", gap: 2 }}>
          {navItems.map(item => (
            <button key={item.id} className="nav-item" onClick={() => setPage(item.id)}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, border: "none", background: page === item.id ? "rgba(59,130,246,0.15)" : "transparent", color: page === item.id ? "#60a5fa" : "#64748b", cursor: "pointer", fontSize: 14, fontWeight: page === item.id ? 600 : 400, transition: "all 0.15s", textAlign: "left", width: "100%", position: "relative" }}>
              <Icon name={item.icon} size={16} />
              {item.label}
              {item.id === "products" && criticalProducts.length > 0 && (
                <span style={{ marginLeft: "auto", background: "#ef4444", color: "#fff", borderRadius: 6, padding: "1px 6px", fontSize: 11, fontWeight: 700 }}>{criticalProducts.length}</span>
              )}
            </button>
          ))}
        </nav>

        <div style={{ padding: "12px 10px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ padding: "10px 12px", marginBottom: 8 }}>
            <div style={{ color: "#f1f5f9", fontSize: 13, fontWeight: 600 }}>{user.name}</div>
            <div style={{ color: "#475569", fontSize: 11 }}>{user.role === "admin" ? "Yönetici" : user.role === "user" ? "Personel" : "Görüntüleyici"}</div>
          </div>
          <button className="nav-item" onClick={() => setUser(null)}
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, border: "none", background: "transparent", color: "#64748b", cursor: "pointer", fontSize: 14, transition: "all 0.15s", width: "100%" }}>
            <Icon name="logout" size={16} /> Çıkış Yap
          </button>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, marginLeft: 220, padding: "28px 32px", overflow: "auto" }}>
        {pages[page]}
      </main>

      {/* Notification */}
      {notification && (
        <div style={{ position: "fixed", top: 20, right: 20, background: notification.type === "success" ? "#166534" : "#991b1b", border: `1px solid ${notification.type === "success" ? "#16a34a" : "#dc2626"}`, borderRadius: 12, padding: "12px 20px", color: "#fff", fontSize: 14, fontWeight: 500, animation: "slideIn 0.2s ease", zIndex: 9999, display: "flex", alignItems: "center", gap: 8 }}>
          {notification.type === "success" ? <Icon name="check" size={16} /> : <Icon name="warning" size={16} />}
          {notification.msg}
        </div>
      )}
    </div>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
function Dashboard({ products, movements, criticalProducts, setPage }) {
  const totalStock = products.reduce((s, p) => s + p.stock, 0);
  const todayMoves = movements.filter(m => new Date(m.createdAt).toDateString() === new Date().toDateString());
  const recentMoves = [...movements].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 6);

  const StatCard = ({ title, value, sub, color, icon }) => (
    <div className="card-hover" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: "20px 24px", transition: "border-color 0.2s" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ color: "#64748b", fontSize: 13, marginBottom: 8 }}>{title}</div>
          <div style={{ fontSize: 32, fontWeight: 700, color: color || "#f8fafc" }}>{value}</div>
          {sub && <div style={{ color: "#475569", fontSize: 12, marginTop: 4 }}>{sub}</div>}
        </div>
        <div style={{ width: 44, height: 44, background: `${color || "#3b82f6"}20`, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", color: color || "#3b82f6" }}>
          <Icon name={icon} size={22} />
        </div>
      </div>
    </div>
  );

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, color: "#f8fafc" }}>Kontrol Paneli</h1>
        <p style={{ color: "#475569", margin: "4px 0 0", fontSize: 14 }}>{new Date().toLocaleDateString("tr-TR", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
        <StatCard title="Toplam Ürün" value={products.length} sub="Tanımlı ürün" icon="products" color="#3b82f6" />
        <StatCard title="Toplam Stok" value={totalStock.toLocaleString("tr-TR")} sub="Tüm ürünler" icon="inventory" color="#8b5cf6" />
        <StatCard title="Kritik Stok" value={criticalProducts.length} sub="Min. seviye altı" icon="warning" color={criticalProducts.length > 0 ? "#ef4444" : "#22c55e"} />
        <StatCard title="Bugünkü Hareket" value={todayMoves.length} sub="Giriş/Çıkış" icon="movements" color="#f59e0b" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Recent movements */}
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Son Hareketler</h3>
            <button onClick={() => setPage("movements")} style={{ background: "none", border: "none", color: "#3b82f6", cursor: "pointer", fontSize: 13 }}>Tümü →</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {recentMoves.map(m => (
              <div key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "rgba(255,255,255,0.02)", borderRadius: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: m.type === "Giriş" ? "#16a34a20" : m.type === "Çıkış" ? "#dc262620" : "#f59e0b20", display: "flex", alignItems: "center", justifyContent: "center", color: m.type === "Giriş" ? "#22c55e" : m.type === "Çıkış" ? "#f87171" : "#f59e0b" }}>
                    <Icon name={m.type === "Giriş" ? "trending_up" : "trending_down"} size={14} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "#e2e8f0" }}>{m.productName}</div>
                    <div style={{ fontSize: 11, color: "#475569" }}>{m.user} · {formatDate(m.createdAt)}</div>
                  </div>
                </div>
                <span style={{ color: m.type === "Giriş" ? "#22c55e" : "#f87171", fontWeight: 600, fontSize: 14 }}>{m.type === "Giriş" ? "+" : "-"}{m.quantity}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Critical stocks */}
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>⚠️ Kritik Stok Uyarıları</h3>
            <button onClick={() => setPage("products")} style={{ background: "none", border: "none", color: "#3b82f6", cursor: "pointer", fontSize: 13 }}>Tümü →</button>
          </div>
          {criticalProducts.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 0", color: "#22c55e" }}>
              <Icon name="check" size={32} /><div style={{ marginTop: 10, fontSize: 14 }}>Tüm stoklar yeterli seviyede</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {criticalProducts.map(p => (
                <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 10 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "#fca5a5" }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: "#7f1d1d" }}>Min: {p.minStock} · Mevcut: {p.stock}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ color: p.stock === 0 ? "#ef4444" : "#f97316", fontWeight: 700, fontSize: 20 }}>{p.stock}</div>
                    <div style={{ fontSize: 10, color: "#7f1d1d" }}>adet</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── PRODUCTS PAGE ────────────────────────────────────────────────────────────
function ProductsPage({ products, setProducts, movements, setMovements, user, notify }) {
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("");
  const [modal, setModal] = useState(null); // null | "add" | "edit" | "view" | "move"
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({});
  const [moveForm, setMoveForm] = useState({ type: "Giriş", quantity: "", note: "" });

  const canEdit = user.role !== "viewer";

  const filtered = products.filter(p => {
    const s = search.toLowerCase();
    return (!s || p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s) || p.barcode.includes(s)) &&
      (!filterCat || p.category === filterCat);
  });

  const openAdd = () => { setForm({ name: "", sku: "", barcode: "", category: "", brand: "", variant: "", minStock: 5, description: "", stock: 0 }); setModal("add"); };
  const openEdit = (p) => { setForm({ ...p }); setSelected(p); setModal("edit"); };
  const openView = (p) => { setSelected(p); setModal("view"); };
  const openMove = (p) => { setSelected(p); setMoveForm({ type: "Giriş", quantity: "", note: "" }); setModal("move"); };

  const saveProduct = async () => {
    if (!form.name || !form.sku) { notify("Ürün adı ve SKU zorunludur", "error"); return; }
    const dbObj = {
      name: form.name, sku: form.sku, barcode: form.barcode || "",
      category: form.category || "", brand: form.brand || "", variant: form.variant || "",
      min_stock: Number(form.minStock) || 0, stock: Number(form.stock) || 0,
      description: form.description || "",
    };
    if (modal === "add") {
      const { data, error } = await supabase.from("products").insert([dbObj]).select().single();
      if (error) { notify("Ürün eklenemedi: " + error.message, "error"); return; }
      setProducts(prev => [mapProduct(data), ...prev]);
      notify("Ürün eklendi");
    } else {
      const { error } = await supabase.from("products").update(dbObj).eq("id", form.id);
      if (error) { notify("Ürün güncellenemedi: " + error.message, "error"); return; }
      setProducts(prev => prev.map(p => p.id === form.id ? { ...p, ...form, stock: Number(form.stock), minStock: Number(form.minStock) } : p));
      notify("Ürün güncellendi");
    }
    setModal(null);
  };

  const saveMove = async () => {
    const qty = parseInt(moveForm.quantity);
    if (!qty || qty <= 0) { notify("Geçerli bir miktar girin", "error"); return; }
    const prev = selected.stock;
    let next = moveForm.type === "Giriş" ? prev + qty : prev - qty;
    if (next < 0) { notify("Stok yetersiz", "error"); return; }
    const { error: prodErr } = await supabase.from("products").update({ stock: next }).eq("id", selected.id);
    if (prodErr) { notify("Stok güncellenemedi", "error"); return; }
    const mvRow = { product_id: selected.id, product_name: selected.name, type: moveForm.type, quantity: qty, prev_stock: prev, next_stock: next, username: user.username, note: moveForm.note || "" };
    const { data: mvData, error: mvErr } = await supabase.from("movements").insert([mvRow]).select().single();
    if (mvErr) { notify("Hareket kaydedilemedi", "error"); return; }
    setProducts(ps => ps.map(p => p.id === selected.id ? { ...p, stock: next } : p));
    setMovements(ms => [mapMovement(mvData), ...ms]);
    notify(`${moveForm.type} işlemi kaydedildi`);
    setModal(null);
  };

  const exportCSV = () => {
    downloadCSV(products.map(p => ({ "Ürün Adı": p.name, SKU: p.sku, Barkod: p.barcode, Kategori: p.category, Marka: p.brand, Varyant: p.variant, "Mevcut Stok": p.stock, "Min Stok": p.minStock, Açıklama: p.description || "" })), "urunler.csv");
  };

  const downloadTemplate = () => {
    downloadCSV([{ "Ürün Adı": "Örnek Ürün", SKU: "URN-001", Barkod: "1234567890", Kategori: "Elektronik", Marka: "Marka", Varyant: "Renk/Beden", "Mevcut Stok": 10, "Min Stok": 5, Açıklama: "Opsiyonel" }], "urun-sablonu.csv");
  };

  const handleCSVImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const text = ev.target.result;
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) { notify("CSV dosyası boş veya hatalı", "error"); return; }
      const headers = lines[0].split(",").map(h => h.replace(/^"|"$/g, "").trim());
      const colMap = {
        name: headers.findIndex(h => h.includes("Ürün") || h.toLowerCase() === "name"),
        sku: headers.findIndex(h => h.includes("SKU") || h.toLowerCase() === "sku"),
        barcode: headers.findIndex(h => h.includes("Barkod") || h.toLowerCase() === "barcode"),
        category: headers.findIndex(h => h.includes("Kategori") || h.toLowerCase() === "category"),
        brand: headers.findIndex(h => h.includes("Marka") || h.toLowerCase() === "brand"),
        variant: headers.findIndex(h => h.includes("Varyant") || h.toLowerCase() === "variant"),
        stock: headers.findIndex(h => h.includes("Mevcut Stok") || h.toLowerCase() === "stock"),
        minStock: headers.findIndex(h => h.includes("Min Stok") || h.toLowerCase() === "min"),
        description: headers.findIndex(h => h.includes("Açıklama") || h.toLowerCase() === "description"),
      };
      if (colMap.name === -1 || colMap.sku === -1) { notify("CSV'de 'Ürün Adı' ve 'SKU' sütunları zorunludur", "error"); return; }
      const parseRow = (line) => {
        const cols = []; let cur = ""; let inQ = false;
        for (let c of line) { if (c === '"') inQ = !inQ; else if (c === "," && !inQ) { cols.push(cur.trim()); cur = ""; } else cur += c; }
        cols.push(cur.trim()); return cols;
      };
      let added = 0; let updated = 0; let errors = 0;
      const toInsert = []; const toUpdate = [];
      lines.slice(1).forEach(line => {
        const cols = parseRow(line);
        const name = cols[colMap.name]?.replace(/^"|"$/g, "") || "";
        const sku = cols[colMap.sku]?.replace(/^"|"$/g, "") || "";
        if (!name || !sku) { errors++; return; }
        const existing = products.find(p => p.sku === sku);
        const productData = {
          name, sku,
          barcode: colMap.barcode >= 0 ? (cols[colMap.barcode]?.replace(/^"|"$/g, "") || "") : "",
          category: colMap.category >= 0 ? (cols[colMap.category]?.replace(/^"|"$/g, "") || "") : "",
          brand: colMap.brand >= 0 ? (cols[colMap.brand]?.replace(/^"|"$/g, "") || "") : "",
          variant: colMap.variant >= 0 ? (cols[colMap.variant]?.replace(/^"|"$/g, "") || "") : "",
          stock: colMap.stock >= 0 ? (parseInt(cols[colMap.stock]) || 0) : 0,
          min_stock: colMap.minStock >= 0 ? (parseInt(cols[colMap.minStock]) || 0) : 0,
          description: colMap.description >= 0 ? (cols[colMap.description]?.replace(/^"|"$/g, "") || "") : "",
        };
        if (existing) { toUpdate.push({ ...productData, id: existing.id }); updated++; }
        else { toInsert.push(productData); added++; }
      });
      if (toInsert.length > 0) await supabase.from("products").insert(toInsert);
      for (const p of toUpdate) { await supabase.from("products").update(p).eq("id", p.id); }
      const { data: fresh } = await supabase.from("products").select("*").order("created_at", { ascending: false });
      if (fresh) setProducts(fresh.map(mapProduct));
      notify(`CSV yüklendi: ${added} yeni ürün eklendi, ${updated} güncellendi${errors > 0 ? ", " + errors + " hatalı satır atlandı" : ""}`);
      e.target.value = "";
    };
    reader.readAsText(file, "UTF-8");
  };

  const Field = ({ label, field, type = "text", options, span }) => (
    <div style={{ gridColumn: span ? "1/-1" : undefined }}>
      <label style={{ color: "#94a3b8", fontSize: 12, fontWeight: 500, display: "block", marginBottom: 5 }}>{label}</label>
      {options ? (
        <select value={form[field] || ""} onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
          style={{ width: "100%", background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "9px 12px", color: "#f1f5f9", fontSize: 14, outline: "none" }}>
          <option value="">Seçin...</option>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input type={type} value={form[field] || ""} onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
          style={{ width: "100%", background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "9px 12px", color: "#f1f5f9", fontSize: 14, outline: "none" }} />
      )}
    </div>
  );

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Ürün Yönetimi</h1>
          <p style={{ color: "#475569", margin: "4px 0 0", fontSize: 13 }}>{products.length} ürün kayıtlı</p>
        </div>
        {canEdit && (
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={exportCSV} className="btn-hover" style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 18px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, color: "#94a3b8", cursor: "pointer", fontSize: 14, transition: "all 0.15s" }}>
              <Icon name="download" size={15} /> CSV İndir
            </button>
            <button onClick={downloadTemplate} className="btn-hover" style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 18px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, color: "#94a3b8", cursor: "pointer", fontSize: 14, transition: "all 0.15s" }}>
              <Icon name="download" size={15} /> Şablon İndir
            </button>
            <label className="btn-hover" style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 18px", background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.25)", borderRadius: 10, color: "#4ade80", cursor: "pointer", fontSize: 14, fontWeight: 500, transition: "all 0.15s" }}>
              <Icon name="upload" size={15} /> CSV Yükle
              <input type="file" accept=".csv" onChange={handleCSVImport} style={{ display: "none" }} />
            </label>
            <button onClick={openAdd} className="btn-hover" style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 18px", background: "linear-gradient(135deg, #3b82f6, #8b5cf6)", border: "none", borderRadius: 10, color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600, transition: "all 0.15s" }}>
              <Icon name="plus" size={15} /> Yeni Ürün
            </button>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <div style={{ flex: 1, position: "relative" }}>
          <div style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#475569" }}><Icon name="search" size={16} /></div>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Ürün adı, SKU veya barkod ile ara..."
            style={{ width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "10px 12px 10px 38px", color: "#f1f5f9", fontSize: 14, outline: "none" }} />
        </div>
        <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "10px 14px", color: "#94a3b8", fontSize: 14, outline: "none" }}>
          <option value="">Tüm Kategoriler</option>
          {SAMPLE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
              {["Ürün Adı", "SKU", "Kategori", "Marka", "Stok", "Min", "Durum", ""].map(h => (
                <th key={h} style={{ padding: "12px 16px", textAlign: "left", color: "#475569", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => (
              <tr key={p.id} className="table-row" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", transition: "background 0.1s" }}>
                <td style={{ padding: "13px 16px" }}>
                  <div style={{ fontWeight: 500, color: "#e2e8f0", fontSize: 14 }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: "#475569" }}>{p.barcode}</div>
                </td>
                <td style={{ padding: "13px 16px", color: "#64748b", fontSize: 13, fontFamily: "'Space Mono', monospace" }}>{p.sku}</td>
                <td style={{ padding: "13px 16px" }}><span style={{ background: "rgba(59,130,246,0.1)", color: "#60a5fa", borderRadius: 6, padding: "3px 9px", fontSize: 12 }}>{p.category}</span></td>
                <td style={{ padding: "13px 16px", color: "#94a3b8", fontSize: 13 }}>{p.brand}</td>
                <td style={{ padding: "13px 16px", fontWeight: 700, fontSize: 18, color: p.stock === 0 ? "#ef4444" : p.stock <= p.minStock ? "#f97316" : "#f8fafc" }}>{p.stock}</td>
                <td style={{ padding: "13px 16px", color: "#475569", fontSize: 13 }}>{p.minStock}</td>
                <td style={{ padding: "13px 16px" }}>
                  {p.stock === 0 ? <span style={{ background: "#ef444420", color: "#f87171", borderRadius: 6, padding: "3px 9px", fontSize: 12 }}>Tükendi</span>
                    : p.stock <= p.minStock ? <span style={{ background: "#f97316 20", color: "#fb923c", borderRadius: 6, padding: "3px 9px", fontSize: 12 }}>Kritik</span>
                    : <span style={{ background: "#16a34a20", color: "#4ade80", borderRadius: 6, padding: "3px 9px", fontSize: 12 }}>Normal</span>}
                </td>
                <td style={{ padding: "13px 16px" }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => openView(p)} style={{ background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 7, padding: "6px 8px", color: "#94a3b8", cursor: "pointer" }}><Icon name="eye" size={14} /></button>
                    {canEdit && <>
                      <button onClick={() => openMove(p)} style={{ background: "rgba(59,130,246,0.15)", border: "none", borderRadius: 7, padding: "6px 8px", color: "#60a5fa", cursor: "pointer" }}><Icon name="movements" size={14} /></button>
                      <button onClick={() => openEdit(p)} style={{ background: "rgba(139,92,246,0.15)", border: "none", borderRadius: 7, padding: "6px 8px", color: "#a78bfa", cursor: "pointer" }}><Icon name="edit" size={14} /></button>
                    </>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div style={{ textAlign: "center", padding: "48px 0", color: "#475569" }}>Sonuç bulunamadı</div>}
      </div>

      {/* Add/Edit Modal */}
      {(modal === "add" || modal === "edit") && (
        <Modal title={modal === "add" ? "Yeni Ürün Ekle" : "Ürün Düzenle"} onClose={() => setModal(null)}
          footer={<><button onClick={() => setModal(null)} style={btnStyle("ghost")}>İptal</button><button onClick={saveProduct} style={btnStyle("primary")}>Kaydet</button></>}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Field label="Ürün Adı *" field="name" span />
            <Field label="SKU / Stok Kodu *" field="sku" />
            <Field label="Barkod (EAN)" field="barcode" />
            <Field label="Kategori" field="category" options={SAMPLE_CATEGORIES} />
            <Field label="Marka" field="brand" options={SAMPLE_BRANDS} />
            <Field label="Varyant (renk, ölçü vb.)" field="variant" />
            <Field label="Başlangıç Stoku" field="stock" type="number" />
            <Field label="Minimum Stok Seviyesi" field="minStock" type="number" />
            <Field label="Açıklama" field="description" span />
          </div>
        </Modal>
      )}

      {/* View Modal */}
      {modal === "view" && selected && (
        <Modal title="Ürün Detayı" onClose={() => setModal(null)}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {[["Ürün Adı", selected.name], ["SKU", selected.sku], ["Barkod", selected.barcode], ["Kategori", selected.category], ["Marka", selected.brand], ["Varyant", selected.variant], ["Mevcut Stok", selected.stock], ["Min. Stok", selected.minStock], ["Açıklama", selected.description]].map(([k, v]) => (
              <div key={k} style={{ gridColumn: k === "Ürün Adı" || k === "Açıklama" ? "1/-1" : undefined }}>
                <div style={{ color: "#475569", fontSize: 12, marginBottom: 3 }}>{k}</div>
                <div style={{ color: "#f1f5f9", fontWeight: 500 }}>{v || "-"}</div>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {/* Move Modal */}
      {modal === "move" && selected && (
        <Modal title={`Stok Hareketi — ${selected.name}`} onClose={() => setModal(null)}
          footer={<><button onClick={() => setModal(null)} style={btnStyle("ghost")}>İptal</button><button onClick={saveMove} style={btnStyle("primary")}>Kaydet</button></>}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", gap: 10 }}>
              {["Giriş", "Çıkış", "Düzeltme"].map(t => (
                <button key={t} onClick={() => setMoveForm(m => ({ ...m, type: t }))}
                  style={{ flex: 1, padding: "10px", borderRadius: 9, border: `1px solid ${moveForm.type === t ? "#3b82f6" : "rgba(255,255,255,0.1)"}`, background: moveForm.type === t ? "rgba(59,130,246,0.15)" : "transparent", color: moveForm.type === t ? "#60a5fa" : "#64748b", cursor: "pointer", fontWeight: 500, fontSize: 14 }}>{t}</button>
              ))}
            </div>
            <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: "12px 16px", display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#64748b", fontSize: 13 }}>Mevcut Stok</span>
              <span style={{ color: "#f8fafc", fontWeight: 700, fontSize: 18 }}>{selected.stock}</span>
            </div>
            <div>
              <label style={{ color: "#94a3b8", fontSize: 12, display: "block", marginBottom: 5 }}>Miktar</label>
              <input type="number" min="1" value={moveForm.quantity} onChange={e => setMoveForm(m => ({ ...m, quantity: e.target.value }))}
                style={{ width: "100%", background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "10px 12px", color: "#f1f5f9", fontSize: 15, outline: "none" }} />
            </div>
            <div>
              <label style={{ color: "#94a3b8", fontSize: 12, display: "block", marginBottom: 5 }}>Açıklama / Referans No</label>
              <input value={moveForm.note} onChange={e => setMoveForm(m => ({ ...m, note: e.target.value }))}
                style={{ width: "100%", background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "10px 12px", color: "#f1f5f9", fontSize: 14, outline: "none" }} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── MOVEMENTS PAGE ───────────────────────────────────────────────────────────
function MovementsPage({ movements, products, setMovements, setProducts, user, notify }) {
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterDate, setFilterDate] = useState("");
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ productId: "", type: "Giriş", quantity: "", note: "" });

  const canEdit = user.role !== "viewer";

  const filtered = movements.filter(m => {
    const s = search.toLowerCase();
    return (!s || m.productName.toLowerCase().includes(s) || m.note.toLowerCase().includes(s)) &&
      (!filterType || m.type === filterType) &&
      (!filterDate || m.createdAt.startsWith(filterDate));
  }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const saveMove = async () => {
    const product = products.find(p => p.id === form.productId);
    if (!product) { notify("Ürün seçin", "error"); return; }
    const qty = parseInt(form.quantity);
    if (!qty || qty <= 0) { notify("Geçerli miktar girin", "error"); return; }
    const prev = product.stock;
    const next = form.type === "Giriş" ? prev + qty : Math.max(0, prev - qty);
    const { error: prodErr } = await supabase.from("products").update({ stock: next }).eq("id", product.id);
    if (prodErr) { notify("Stok güncellenemedi", "error"); return; }
    const mvRow = { product_id: product.id, product_name: product.name, type: form.type, quantity: qty, prev_stock: prev, next_stock: next, username: user.username, note: form.note || "" };
    const { data: mvData, error: mvErr } = await supabase.from("movements").insert([mvRow]).select().single();
    if (mvErr) { notify("Hareket kaydedilemedi", "error"); return; }
    setProducts(ps => ps.map(p => p.id === product.id ? { ...p, stock: next } : p));
    setMovements(ms => [mapMovement(mvData), ...ms]);
    notify(`${form.type} hareketi kaydedildi`);
    setModal(false);
  };

  const exportCSV = () => downloadCSV(filtered.map(m => ({ Tarih: formatDate(m.createdAt), Ürün: m.productName, Tür: m.type, Miktar: m.quantity, "Önceki Stok": m.prevStock, "Sonraki Stok": m.nextStock, Kullanıcı: m.user, Açıklama: m.note })), "hareketler.csv");

  const typeColor = (t) => t === "Giriş" ? "#22c55e" : t === "Çıkış" ? "#f87171" : "#fbbf24";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Stok Hareketleri</h1>
          <p style={{ color: "#475569", margin: "4px 0 0", fontSize: 13 }}>{movements.length} hareket kaydı — geriye dönük silinemez</p>
        </div>
        {canEdit && (
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={exportCSV} className="btn-hover" style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 18px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, color: "#94a3b8", cursor: "pointer", fontSize: 14, transition: "all 0.15s" }}>
              <Icon name="download" size={15} /> CSV İndir
            </button>
            <button onClick={() => { setForm({ productId: "", type: "Giriş", quantity: "", note: "" }); setModal(true); }} className="btn-hover"
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 18px", background: "linear-gradient(135deg, #3b82f6, #8b5cf6)", border: "none", borderRadius: 10, color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600, transition: "all 0.15s" }}>
              <Icon name="plus" size={15} /> Yeni Hareket
            </button>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <div style={{ flex: 1, position: "relative" }}>
          <div style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#475569" }}><Icon name="search" size={16} /></div>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Ürün adı veya açıklama ile ara..."
            style={{ width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "10px 12px 10px 38px", color: "#f1f5f9", fontSize: 14, outline: "none" }} />
        </div>
        <select value={filterType} onChange={e => setFilterType(e.target.value)} style={selectStyle}>
          <option value="">Tüm Türler</option>
          <option>Giriş</option><option>Çıkış</option><option>Düzeltme</option><option>Sayım Farkı</option>
        </select>
        <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)} style={{ ...selectStyle, colorScheme: "dark" }} />
      </div>

      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
              {["Tarih & Saat", "Ürün", "Tür", "Miktar", "Önceki", "Sonraki", "Kullanıcı", "Açıklama"].map(h => (
                <th key={h} style={{ padding: "12px 14px", textAlign: "left", color: "#475569", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(m => (
              <tr key={m.id} className="table-row" style={{ borderBottom: "1px solid rgba(255,255,255,0.03)", transition: "background 0.1s" }}>
                <td style={{ padding: "11px 14px", color: "#64748b", fontSize: 12, fontFamily: "'Space Mono', monospace", whiteSpace: "nowrap" }}>{formatDate(m.createdAt)}</td>
                <td style={{ padding: "11px 14px", color: "#e2e8f0", fontSize: 13, fontWeight: 500 }}>{m.productName}</td>
                <td style={{ padding: "11px 14px" }}>
                  <span style={{ background: `${typeColor(m.type)}18`, color: typeColor(m.type), borderRadius: 6, padding: "3px 9px", fontSize: 12, fontWeight: 500 }}>{m.type}</span>
                </td>
                <td style={{ padding: "11px 14px", fontWeight: 700, color: m.type === "Giriş" ? "#22c55e" : "#f87171", fontSize: 15 }}>
                  {m.type === "Giriş" ? "+" : "-"}{m.quantity}
                </td>
                <td style={{ padding: "11px 14px", color: "#64748b", fontSize: 13 }}>{m.prevStock}</td>
                <td style={{ padding: "11px 14px", color: "#94a3b8", fontSize: 13, fontWeight: 600 }}>{m.nextStock}</td>
                <td style={{ padding: "11px 14px", color: "#64748b", fontSize: 12 }}>{m.user}</td>
                <td style={{ padding: "11px 14px", color: "#475569", fontSize: 12, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.note || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div style={{ textAlign: "center", padding: "48px 0", color: "#475569" }}>Sonuç bulunamadı</div>}
      </div>

      {modal && (
        <Modal title="Yeni Stok Hareketi" onClose={() => setModal(false)}
          footer={<><button onClick={() => setModal(false)} style={btnStyle("ghost")}>İptal</button><button onClick={saveMove} style={btnStyle("primary")}>Kaydet</button></>}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={{ color: "#94a3b8", fontSize: 12, display: "block", marginBottom: 5 }}>Ürün *</label>
              <select value={form.productId} onChange={e => setForm(f => ({ ...f, productId: e.target.value }))} style={{ width: "100%", background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "9px 12px", color: "#f1f5f9", fontSize: 14, outline: "none" }}>
                <option value="">Ürün seçin...</option>
                {products.map(p => <option key={p.id} value={p.id}>{p.name} (Stok: {p.stock})</option>)}
              </select>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              {["Giriş", "Çıkış", "Düzeltme"].map(t => (
                <button key={t} onClick={() => setForm(f => ({ ...f, type: t }))}
                  style={{ flex: 1, padding: "10px", borderRadius: 9, border: `1px solid ${form.type === t ? "#3b82f6" : "rgba(255,255,255,0.1)"}`, background: form.type === t ? "rgba(59,130,246,0.15)" : "transparent", color: form.type === t ? "#60a5fa" : "#64748b", cursor: "pointer", fontWeight: 500, fontSize: 14 }}>{t}</button>
              ))}
            </div>
            <div>
              <label style={{ color: "#94a3b8", fontSize: 12, display: "block", marginBottom: 5 }}>Miktar *</label>
              <input type="number" min="1" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} style={{ width: "100%", background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "9px 12px", color: "#f1f5f9", fontSize: 14, outline: "none" }} />
            </div>
            <div>
              <label style={{ color: "#94a3b8", fontSize: 12, display: "block", marginBottom: 5 }}>Açıklama / Referans No</label>
              <input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} style={{ width: "100%", background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "9px 12px", color: "#f1f5f9", fontSize: 14, outline: "none" }} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── COUNTING PAGE ────────────────────────────────────────────────────────────
function CountingPage({ products, setProducts, movements, setMovements, user, notify }) {
  const [phase, setPhase] = useState("setup"); // setup | counting | results
  const [filter, setFilter] = useState({ category: "", brand: "" });
  const [countList, setCountList] = useState({}); // { productId: count }
  const [barcodeInput, setBarcodeInput] = useState("");
  const [countName, setCountName] = useState(`Sayım ${new Date().toLocaleDateString("tr-TR")}`);
  const barcodeRef = useRef(null);

  const canEdit = user.role !== "viewer";

  const filteredProducts = products.filter(p =>
    (!filter.category || p.category === filter.category) &&
    (!filter.brand || p.brand === filter.brand)
  );

  const startCounting = () => {
    const initial = {};
    filteredProducts.forEach(p => { initial[p.id] = 0; });
    setCountList(initial);
    setPhase("counting");
    setTimeout(() => barcodeRef.current?.focus(), 100);
  };

  const handleBarcode = (e) => {
    if (e.key === "Enter" && barcodeInput.trim()) {
      const product = products.find(p => p.barcode === barcodeInput.trim() || p.sku === barcodeInput.trim());
      if (product && countList.hasOwnProperty(product.id)) {
        setCountList(prev => ({ ...prev, [product.id]: (prev[product.id] || 0) + 1 }));
        setBarcodeInput("");
      } else {
        notify("Ürün bu sayım listesinde değil veya bulunamadı", "error");
        setBarcodeInput("");
      }
    }
  };

  const adjustCount = (id, delta) => setCountList(prev => ({ ...prev, [id]: Math.max(0, (prev[id] || 0) + delta) }));
  const setCount = (id, val) => setCountList(prev => ({ ...prev, [id]: Math.max(0, parseInt(val) || 0) }));

  const diffs = filteredProducts.map(p => ({ ...p, counted: countList[p.id] || 0, diff: (countList[p.id] || 0) - p.stock }));
  const hasDiffs = diffs.some(d => d.diff !== 0);

  const applyDiffs = async () => {
    const changed = diffs.filter(d => d.diff !== 0);
    for (const d of changed) {
      await supabase.from("products").update({ stock: d.counted }).eq("id", d.id);
      await supabase.from("movements").insert([{ product_id: d.id, product_name: d.name, type: "Sayım Farkı", quantity: Math.abs(d.diff), prev_stock: d.stock, next_stock: d.counted, username: user.username, note: `Sayım: ${countName}` }]);
    }
    const [{ data: prods }, { data: moves }] = await Promise.all([
      supabase.from("products").select("*").order("created_at", { ascending: false }),
      supabase.from("movements").select("*").order("created_at", { ascending: false }),
    ]);
    if (prods) setProducts(prods.map(mapProduct));
    if (moves) setMovements(moves.map(mapMovement));
    notify(`${changed.length} ürün stoğa yansıtıldı`);
    setPhase("setup");
    setCountList({});
  };

  const exportDiffs = () => downloadCSV(diffs.map(d => ({ "Ürün Adı": d.name, SKU: d.sku, "Sistem Stoğu": d.stock, "Sayılan": d.counted, Fark: d.diff, Durum: d.diff > 0 ? "Fazla" : d.diff < 0 ? "Eksik" : "Eşleşti" })), `sayim-${countName}.csv`);

  if (phase === "setup") return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 8px" }}>Sayım Modülü</h1>
      <p style={{ color: "#475569", margin: "0 0 28px", fontSize: 13 }}>Barkod okuyucu veya manuel giriş ile fiziksel sayım yapın</p>

      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: 28, maxWidth: 600 }}>
        <h3 style={{ margin: "0 0 20px", fontSize: 16 }}>Sayım Ayarları</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ color: "#94a3b8", fontSize: 12, display: "block", marginBottom: 5 }}>Sayım Adı</label>
            <input value={countName} onChange={e => setCountName(e.target.value)} style={{ width: "100%", background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "9px 12px", color: "#f1f5f9", fontSize: 14, outline: "none" }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ color: "#94a3b8", fontSize: 12, display: "block", marginBottom: 5 }}>Kategori Filtresi</label>
              <select value={filter.category} onChange={e => setFilter(f => ({ ...f, category: e.target.value }))} style={{ width: "100%", background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "9px 12px", color: "#f1f5f9", fontSize: 14, outline: "none" }}>
                <option value="">Tümü</option>
                {SAMPLE_CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={{ color: "#94a3b8", fontSize: 12, display: "block", marginBottom: 5 }}>Marka Filtresi</label>
              <select value={filter.brand} onChange={e => setFilter(f => ({ ...f, brand: e.target.value }))} style={{ width: "100%", background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "9px 12px", color: "#f1f5f9", fontSize: 14, outline: "none" }}>
                <option value="">Tümü</option>
                {SAMPLE_BRANDS.map(b => <option key={b}>{b}</option>)}
              </select>
            </div>
          </div>
          <div style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 10, padding: "12px 16px" }}>
            <span style={{ color: "#60a5fa", fontSize: 13 }}>Seçilen kriterlerde <strong>{filteredProducts.length}</strong> ürün sayılacak</span>
          </div>
          {canEdit && (
            <button onClick={startCounting} className="btn-hover" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "13px", background: "linear-gradient(135deg, #3b82f6, #8b5cf6)", border: "none", borderRadius: 10, color: "#fff", cursor: "pointer", fontSize: 15, fontWeight: 600, transition: "all 0.15s" }}>
              <Icon name="scan" size={18} /> Sayımı Başlat
            </button>
          )}
        </div>
      </div>
    </div>
  );

  if (phase === "counting") return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>🔍 {countName}</h1>
          <p style={{ color: "#475569", margin: "4px 0 0", fontSize: 13 }}>{filteredProducts.length} ürün sayılıyor</p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => setPhase("results")} className="btn-hover" style={{ padding: "10px 20px", background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: 10, color: "#4ade80", cursor: "pointer", fontWeight: 600, transition: "all 0.15s" }}>
            Sayımı Tamamla →
          </button>
        </div>
      </div>

      <div style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 12, padding: "14px 18px", marginBottom: 20, display: "flex", alignItems: "center", gap: 12 }}>
        <Icon name="scan" size={20} />
        <div style={{ flex: 1 }}>
          <div style={{ color: "#60a5fa", fontSize: 13, marginBottom: 4 }}>Barkod Okuyucu — Enter'a basın veya okuyucu ile tara</div>
          <input ref={barcodeRef} value={barcodeInput} onChange={e => setBarcodeInput(e.target.value)} onKeyDown={handleBarcode}
            placeholder="Barkod veya SKU girin, Enter'a basın..."
            style={{ width: "100%", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(59,130,246,0.3)", borderRadius: 8, padding: "9px 12px", color: "#f1f5f9", fontSize: 14, outline: "none" }} />
        </div>
      </div>

      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
              {["Ürün", "Barkod", "Sistem Stoğu", "Sayılan Adet", ""].map(h => (
                <th key={h} style={{ padding: "12px 14px", textAlign: "left", color: "#475569", fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredProducts.map(p => {
              const cnt = countList[p.id] || 0;
              return (
                <tr key={p.id} className="table-row" style={{ borderBottom: "1px solid rgba(255,255,255,0.03)", background: cnt > 0 ? "rgba(34,197,94,0.04)" : undefined }}>
                  <td style={{ padding: "11px 14px" }}>
                    <div style={{ color: "#e2e8f0", fontWeight: 500, fontSize: 13 }}>{p.name}</div>
                    <div style={{ color: "#475569", fontSize: 11 }}>{p.sku}</div>
                  </td>
                  <td style={{ padding: "11px 14px", color: "#64748b", fontSize: 12, fontFamily: "'Space Mono', monospace" }}>{p.barcode}</td>
                  <td style={{ padding: "11px 14px", color: "#94a3b8", fontWeight: 600, fontSize: 16 }}>{p.stock}</td>
                  <td style={{ padding: "11px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <button onClick={() => adjustCount(p.id, -1)} style={{ width: 28, height: 28, background: "rgba(239,68,68,0.15)", border: "none", borderRadius: 6, color: "#f87171", cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>-</button>
                      <input type="number" value={cnt} onChange={e => setCount(p.id, e.target.value)}
                        style={{ width: 64, background: "#1e293b", border: "1px solid #334155", borderRadius: 7, padding: "5px 8px", color: cnt > 0 ? "#4ade80" : "#94a3b8", fontSize: 16, fontWeight: 700, outline: "none", textAlign: "center" }} />
                      <button onClick={() => adjustCount(p.id, 1)} style={{ width: 28, height: 28, background: "rgba(34,197,94,0.15)", border: "none", borderRadius: 6, color: "#4ade80", cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
                    </div>
                  </td>
                  <td style={{ padding: "11px 14px" }}>
                    {cnt > 0 && <div style={{ color: "#4ade80", fontSize: 12 }}>✓ Sayıldı</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  // Results phase
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Sayım Sonuçları — {countName}</h1>
          <p style={{ color: "#475569", margin: "4px 0 0", fontSize: 13 }}>
            {diffs.filter(d => d.diff !== 0).length} üründe fark tespit edildi
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => setPhase("counting")} style={btnStyle("ghost")}>← Geri Dön</button>
          <button onClick={exportDiffs} className="btn-hover" style={{ ...btnStyle("ghost"), display: "flex", alignItems: "center", gap: 6 }}><Icon name="download" size={14} /> CSV İndir</button>
          {canEdit && hasDiffs && (
            <button onClick={applyDiffs} className="btn-hover" style={{ ...btnStyle("primary"), display: "flex", alignItems: "center", gap: 6 }}>
              <Icon name="check" size={14} /> Farkları Stoğa Yansıt
            </button>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 20 }}>
        {[
          { label: "Eşleşen", value: diffs.filter(d => d.diff === 0).length, color: "#22c55e" },
          { label: "Fazla (Sayım > Sistem)", value: diffs.filter(d => d.diff > 0).length, color: "#3b82f6" },
          { label: "Eksik (Sayım < Sistem)", value: diffs.filter(d => d.diff < 0).length, color: "#ef4444" },
        ].map(s => (
          <div key={s.label} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "16px 20px", textAlign: "center" }}>
            <div style={{ fontSize: 30, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ color: "#64748b", fontSize: 12, marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
              {["Ürün", "Sistem Stoğu", "Sayılan", "Fark", "Durum"].map(h => (
                <th key={h} style={{ padding: "12px 14px", textAlign: "left", color: "#475569", fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {diffs.map(d => (
              <tr key={d.id} className="table-row" style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                <td style={{ padding: "11px 14px" }}>
                  <div style={{ color: "#e2e8f0", fontWeight: 500, fontSize: 13 }}>{d.name}</div>
                  <div style={{ color: "#475569", fontSize: 11 }}>{d.sku}</div>
                </td>
                <td style={{ padding: "11px 14px", color: "#94a3b8", fontSize: 15, fontWeight: 600 }}>{d.stock}</td>
                <td style={{ padding: "11px 14px", color: "#f8fafc", fontSize: 15, fontWeight: 600 }}>{d.counted}</td>
                <td style={{ padding: "11px 14px", fontWeight: 700, fontSize: 16, color: d.diff > 0 ? "#3b82f6" : d.diff < 0 ? "#ef4444" : "#22c55e" }}>
                  {d.diff > 0 ? `+${d.diff}` : d.diff}
                </td>
                <td style={{ padding: "11px 14px" }}>
                  {d.diff === 0 ? <span style={{ background: "#16a34a20", color: "#4ade80", borderRadius: 6, padding: "3px 9px", fontSize: 12 }}>Eşleşti</span>
                    : d.diff > 0 ? <span style={{ background: "#3b82f620", color: "#60a5fa", borderRadius: 6, padding: "3px 9px", fontSize: 12 }}>Fazla</span>
                    : <span style={{ background: "#ef444420", color: "#f87171", borderRadius: 6, padding: "3px 9px", fontSize: 12 }}>Eksik</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── REPORTS PAGE ─────────────────────────────────────────────────────────────
function ReportsPage({ products, movements, criticalProducts }) {
  const [dateFrom, setDateFrom] = useState(new Date(Date.now() - 86400000 * 30).toISOString().slice(0, 10));
  const [dateTo, setDateTo] = useState(new Date().toISOString().slice(0, 10));
  const [activeReport, setActiveReport] = useState("stock-summary");

  const filtered = movements.filter(m => {
    const d = m.createdAt.slice(0, 10);
    return d >= dateFrom && d <= dateTo;
  });

  const byType = { Giriş: 0, Çıkış: 0, Düzeltme: 0, "Sayım Farkı": 0 };
  filtered.forEach(m => { byType[m.type] = (byType[m.type] || 0) + m.quantity; });

  const productActivity = {};
  filtered.forEach(m => {
    if (!productActivity[m.productId]) productActivity[m.productId] = { name: m.productName, in: 0, out: 0 };
    if (m.type === "Giriş") productActivity[m.productId].in += m.quantity;
    else productActivity[m.productId].out += m.quantity;
  });
  const topProducts = Object.values(productActivity).sort((a, b) => (b.in + b.out) - (a.in + a.out)).slice(0, 8);

  const exportStockSummary = () => downloadCSV(products.map(p => ({ "Ürün Adı": p.name, SKU: p.sku, Kategori: p.category, Marka: p.brand, "Mevcut Stok": p.stock, "Min Stok": p.minStock, Durum: p.stock <= p.minStock ? "KRİTİK" : "Normal" })), "stok-ozet.csv");
  const exportMovements = () => downloadCSV(filtered.map(m => ({ Tarih: formatDate(m.createdAt), Ürün: m.productName, Tür: m.type, Miktar: m.quantity, Kullanıcı: m.user, Açıklama: m.note })), "hareket-raporu.csv");
  const exportCritical = () => downloadCSV(criticalProducts.map(p => ({ "Ürün Adı": p.name, SKU: p.sku, "Mevcut Stok": p.stock, "Min Stok": p.minStock, Fark: p.stock - p.minStock })), "kritik-stok.csv");

  const reports = [
    { id: "stock-summary", label: "Stok Özeti", icon: "products" },
    { id: "movements", label: "Hareket Raporu", icon: "movements" },
    { id: "critical", label: "Kritik Stok", icon: "warning" },
    { id: "activity", label: "Ürün Aktivitesi", icon: "trending_up" },
  ];

  const maxBar = Math.max(...topProducts.map(p => p.in + p.out), 1);

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Raporlama</h1>
        <p style={{ color: "#475569", margin: "4px 0 0", fontSize: 13 }}>Tüm raporlar CSV olarak indirilebilir</p>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        {reports.map(r => (
          <button key={r.id} onClick={() => setActiveReport(r.id)}
            style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 16px", borderRadius: 9, border: `1px solid ${activeReport === r.id ? "#3b82f6" : "rgba(255,255,255,0.08)"}`, background: activeReport === r.id ? "rgba(59,130,246,0.15)" : "rgba(255,255,255,0.03)", color: activeReport === r.id ? "#60a5fa" : "#64748b", cursor: "pointer", fontSize: 13, fontWeight: activeReport === r.id ? 600 : 400 }}>
            <Icon name={r.icon} size={14} />{r.label}
          </button>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ ...selectStyle, colorScheme: "dark", fontSize: 13 }} />
          <span style={{ color: "#475569" }}>—</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ ...selectStyle, colorScheme: "dark", fontSize: 13 }} />
        </div>
      </div>

      {activeReport === "stock-summary" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>Güncel Stok Durumu ({products.length} ürün)</h3>
            <button onClick={exportStockSummary} className="btn-hover" style={{ display: "flex", alignItems: "center", gap: 6, ...btnStyle("ghost"), padding: "8px 14px" }}><Icon name="download" size={14} /> CSV İndir</button>
          </div>
          <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                {["Ürün", "SKU", "Kategori", "Mevcut Stok", "Min Stok", "Durum"].map(h => <th key={h} style={{ padding: "11px 14px", textAlign: "left", color: "#475569", fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>{h}</th>)}
              </tr></thead>
              <tbody>{products.map(p => (
                <tr key={p.id} className="table-row" style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                  <td style={{ padding: "10px 14px", color: "#e2e8f0", fontSize: 13 }}>{p.name}</td>
                  <td style={{ padding: "10px 14px", color: "#64748b", fontSize: 12, fontFamily: "'Space Mono', monospace" }}>{p.sku}</td>
                  <td style={{ padding: "10px 14px" }}><span style={{ background: "rgba(59,130,246,0.1)", color: "#60a5fa", borderRadius: 6, padding: "2px 8px", fontSize: 12 }}>{p.category}</span></td>
                  <td style={{ padding: "10px 14px", fontWeight: 700, color: p.stock === 0 ? "#ef4444" : p.stock <= p.minStock ? "#f97316" : "#f8fafc", fontSize: 16 }}>{p.stock}</td>
                  <td style={{ padding: "10px 14px", color: "#475569" }}>{p.minStock}</td>
                  <td style={{ padding: "10px 14px" }}>
                    {p.stock === 0 ? <span style={{ background: "#ef444420", color: "#f87171", borderRadius: 6, padding: "2px 8px", fontSize: 12 }}>Tükendi</span>
                      : p.stock <= p.minStock ? <span style={{ background: "#f9730620", color: "#fb923c", borderRadius: 6, padding: "2px 8px", fontSize: 12 }}>Kritik</span>
                      : <span style={{ background: "#16a34a20", color: "#4ade80", borderRadius: 6, padding: "2px 8px", fontSize: 12 }}>Normal</span>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}

      {activeReport === "movements" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>Hareket Raporu ({filtered.length} kayıt)</h3>
            <button onClick={exportMovements} className="btn-hover" style={{ display: "flex", alignItems: "center", gap: 6, ...btnStyle("ghost"), padding: "8px 14px" }}><Icon name="download" size={14} /> CSV İndir</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
            {Object.entries(byType).map(([type, total]) => (
              <div key={type} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: "14px 16px", textAlign: "center" }}>
                <div style={{ fontSize: 24, fontWeight: 700 }}>{total}</div>
                <div style={{ color: "#64748b", fontSize: 12, marginTop: 2 }}>{type}</div>
              </div>
            ))}
          </div>
          <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, overflow: "hidden", maxHeight: 400, overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                {["Tarih", "Ürün", "Tür", "Miktar", "Kullanıcı", "Açıklama"].map(h => <th key={h} style={{ padding: "11px 14px", textAlign: "left", color: "#475569", fontSize: 12, fontWeight: 600, textTransform: "uppercase", position: "sticky", top: 0, background: "#0f172a" }}>{h}</th>)}
              </tr></thead>
              <tbody>{filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(m => (
                <tr key={m.id} className="table-row" style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                  <td style={{ padding: "10px 14px", color: "#64748b", fontSize: 12 }}>{formatDate(m.createdAt)}</td>
                  <td style={{ padding: "10px 14px", color: "#e2e8f0", fontSize: 13 }}>{m.productName}</td>
                  <td style={{ padding: "10px 14px" }}><span style={{ background: (m.type === "Giriş" ? "#22c55e" : "#f87171") + "20", color: m.type === "Giriş" ? "#22c55e" : "#f87171", borderRadius: 6, padding: "2px 8px", fontSize: 12 }}>{m.type}</span></td>
                  <td style={{ padding: "10px 14px", fontWeight: 600 }}>{m.quantity}</td>
                  <td style={{ padding: "10px 14px", color: "#64748b", fontSize: 12 }}>{m.user}</td>
                  <td style={{ padding: "10px 14px", color: "#475569", fontSize: 12 }}>{m.note}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}

      {activeReport === "critical" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>Kritik Stok Uyarıları ({criticalProducts.length} ürün)</h3>
            <button onClick={exportCritical} className="btn-hover" style={{ display: "flex", alignItems: "center", gap: 6, ...btnStyle("ghost"), padding: "8px 14px" }}><Icon name="download" size={14} /> CSV İndir</button>
          </div>
          {criticalProducts.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: "#22c55e" }}>
              <Icon name="check" size={40} /><div style={{ marginTop: 12, fontSize: 16 }}>Tüm stoklar yeterli seviyede 🎉</div>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {criticalProducts.map(p => (
                <div key={p.id} style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 12, padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontWeight: 600, color: "#fca5a5" }}>{p.name}</div>
                    <div style={{ color: "#7f1d1d", fontSize: 12, marginTop: 2 }}>{p.sku} · {p.category} · {p.brand}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 28, fontWeight: 700, color: p.stock === 0 ? "#ef4444" : "#f97316" }}>{p.stock}</div>
                    <div style={{ color: "#7f1d1d", fontSize: 12 }}>Min: {p.minStock}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeReport === "activity" && (
        <div>
          <h3 style={{ margin: "0 0 16px", fontSize: 15 }}>En Aktif Ürünler (Seçilen Dönem)</h3>
          {topProducts.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: "#475569" }}>Bu dönemde hareket yok</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {topProducts.map(p => {
                const total = p.in + p.out;
                return (
                  <div key={p.name} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: "14px 18px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                      <span style={{ fontWeight: 500, color: "#e2e8f0", fontSize: 13 }}>{p.name}</span>
                      <div style={{ display: "flex", gap: 12 }}>
                        <span style={{ color: "#22c55e", fontSize: 12 }}>+{p.in} Giriş</span>
                        <span style={{ color: "#f87171", fontSize: 12 }}>-{p.out} Çıkış</span>
                      </div>
                    </div>
                    <div style={{ height: 6, background: "rgba(255,255,255,0.05)", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ height: "100%", background: "linear-gradient(90deg, #3b82f6, #8b5cf6)", borderRadius: 3, width: `${(total / maxBar) * 100}%`, transition: "width 0.4s" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── SETTINGS PAGE ───────────────────────────────────────────────────────────
function SettingsPage({ user, setUser, appUsers, setAppUsers, notify }) {
  const isAdmin = user.role === "admin";
  const [tab, setTab] = useState("password");
  const [pwForm, setPwForm] = useState({ current: "", newPw: "", confirm: "" });
  const [userModal, setUserModal] = useState(null); // null | "add" | "edit"
  const [editTarget, setEditTarget] = useState(null);
  const [uForm, setUForm] = useState({ name: "", username: "", password: "", role: "user" });

  const changePassword = async () => {
    if (!pwForm.current || !pwForm.newPw || !pwForm.confirm) { notify("Tüm alanları doldurun", "error"); return; }
    if (pwForm.current !== user.password) { notify("Mevcut şifre hatalı", "error"); return; }
    if (pwForm.newPw !== pwForm.confirm) { notify("Yeni şifreler eşleşmiyor", "error"); return; }
    if (pwForm.newPw.length < 6) { notify("Şifre en az 6 karakter olmalı", "error"); return; }
    const { error } = await supabase.from("app_users").update({ password_hash: pwForm.newPw }).eq("id", user.id);
    if (error) { notify("Şifre güncellenemedi", "error"); return; }
    setAppUsers(prev => prev.map(u => u.id === user.id ? { ...u, password: pwForm.newPw } : u));
    setUser(u => ({ ...u, password: pwForm.newPw }));
    setPwForm({ current: "", newPw: "", confirm: "" });
    notify("Şifre başarıyla güncellendi");
  };

  const saveUser = async () => {
    if (!uForm.name || !uForm.username || !uForm.password) { notify("Ad, kullanıcı adı ve şifre zorunludur", "error"); return; }
    if (uForm.password.length < 6) { notify("Şifre en az 6 karakter olmalı", "error"); return; }
    const dbObj = { name: uForm.name, username: uForm.username, password_hash: uForm.password, role: uForm.role, is_active: true };
    if (userModal === "add") {
      const exists = appUsers.find(u => u.username === uForm.username);
      if (exists) { notify("Bu kullanıcı adı zaten kullanılıyor", "error"); return; }
      const { data, error } = await supabase.from("app_users").insert([dbObj]).select().single();
      if (error) { notify("Kullanıcı eklenemedi", "error"); return; }
      setAppUsers(prev => [...prev, mapUser(data)]);
      notify("Kullanıcı eklendi");
    } else {
      const { error } = await supabase.from("app_users").update(dbObj).eq("id", editTarget.id);
      if (error) { notify("Kullanıcı güncellenemedi", "error"); return; }
      setAppUsers(prev => prev.map(u => u.id === editTarget.id ? { ...u, ...uForm, password: uForm.password } : u));
      if (editTarget.id === user.id) setUser(u => ({ ...u, name: uForm.name, username: uForm.username, password: uForm.password, role: uForm.role }));
      notify("Kullanıcı güncellendi");
    }
    setUserModal(null);
  };

  const deleteUser = async (u) => {
    if (u.id === user.id) { notify("Kendi hesabınızı silemezsiniz", "error"); return; }
    const { error } = await supabase.from("app_users").update({ is_active: false }).eq("id", u.id);
    if (error) { notify("Kullanıcı silinemedi", "error"); return; }
    setAppUsers(prev => prev.filter(p => p.id !== u.id));
    notify("Kullanıcı silindi");
  };

  const roleLabel = (r) => r === "admin" ? "Yönetici" : r === "user" ? "Personel" : "Görüntüleyici";
  const roleColor = (r) => r === "admin" ? "#8b5cf6" : r === "user" ? "#3b82f6" : "#64748b";

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Ayarlar</h1>
        <p style={{ color: "#475569", margin: "4px 0 0", fontSize: 13 }}>Hesap ve kullanıcı yönetimi</p>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 24 }}>
        {[["password", "Şifre Değiştir"], ...(isAdmin ? [["users", "Kullanıcı Yönetimi"]] : [])].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            style={{ padding: "9px 20px", borderRadius: 9, border: `1px solid ${tab === id ? "#3b82f6" : "rgba(255,255,255,0.08)"}`, background: tab === id ? "rgba(59,130,246,0.15)" : "rgba(255,255,255,0.03)", color: tab === id ? "#60a5fa" : "#64748b", cursor: "pointer", fontSize: 14, fontWeight: tab === id ? 600 : 400 }}>
            {label}
          </button>
        ))}
      </div>

      {tab === "password" && (
        <div style={{ maxWidth: 440 }}>
          <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: 28 }}>
            <h3 style={{ margin: "0 0 20px", fontSize: 15 }}>Şifre Değiştir</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {[["Mevcut Şifre", "current"], ["Yeni Şifre", "newPw"], ["Yeni Şifre (Tekrar)", "confirm"]].map(([label, field]) => (
                <div key={field}>
                  <label style={{ color: "#94a3b8", fontSize: 12, display: "block", marginBottom: 5 }}>{label}</label>
                  <input type="password" value={pwForm[field]} onChange={e => setPwForm(f => ({ ...f, [field]: e.target.value }))}
                    style={{ width: "100%", background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "10px 12px", color: "#f1f5f9", fontSize: 14, outline: "none" }} />
                </div>
              ))}
              <button onClick={changePassword} className="btn-hover"
                style={{ padding: "12px", background: "linear-gradient(135deg, #3b82f6, #8b5cf6)", border: "none", borderRadius: 10, color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600, marginTop: 4 }}>
                Şifreyi Güncelle
              </button>
            </div>
          </div>
          <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "14px 18px", marginTop: 16 }}>
            <div style={{ color: "#94a3b8", fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Hesap Bilgileri</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[["Ad Soyad", user.name], ["Kullanıcı Adı", user.username], ["Rol", roleLabel(user.role)]].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "#475569", fontSize: 13 }}>{k}</span>
                  <span style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 500 }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === "users" && isAdmin && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>Kullanıcılar ({appUsers.length})</h3>
            <button onClick={() => { setUForm({ name: "", username: "", password: "", role: "user" }); setUserModal("add"); }} className="btn-hover"
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 18px", background: "linear-gradient(135deg, #3b82f6, #8b5cf6)", border: "none", borderRadius: 10, color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600 }}>
              <Icon name="plus" size={15} /> Yeni Kullanıcı
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {appUsers.map(u => (
              <div key={u.id} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: `${roleColor(u.role)}20`, display: "flex", alignItems: "center", justifyContent: "center", color: roleColor(u.role), fontSize: 16, fontWeight: 700 }}>
                    {u.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, color: "#e2e8f0", fontSize: 14 }}>{u.name}</div>
                    <div style={{ color: "#475569", fontSize: 12, marginTop: 2 }}>@{u.username}</div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ background: `${roleColor(u.role)}18`, color: roleColor(u.role), borderRadius: 6, padding: "4px 10px", fontSize: 12, fontWeight: 500 }}>{roleLabel(u.role)}</span>
                  {u.id === user.id && <span style={{ color: "#475569", fontSize: 11 }}>(siz)</span>}
                  <button onClick={() => { setUForm({ name: u.name, username: u.username, password: u.password, role: u.role }); setEditTarget(u); setUserModal("edit"); }}
                    style={{ background: "rgba(139,92,246,0.15)", border: "none", borderRadius: 7, padding: "7px 9px", color: "#a78bfa", cursor: "pointer" }}><Icon name="edit" size={14} /></button>
                  {u.id !== user.id && (
                    <button onClick={() => deleteUser(u)}
                      style={{ background: "rgba(239,68,68,0.12)", border: "none", borderRadius: 7, padding: "7px 9px", color: "#f87171", cursor: "pointer" }}><Icon name="x" size={14} /></button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {userModal && (
        <Modal title={userModal === "add" ? "Yeni Kullanıcı Ekle" : "Kullanıcıyı Düzenle"} onClose={() => setUserModal(null)}
          footer={<><button onClick={() => setUserModal(null)} style={btnStyle("ghost")}>İptal</button><button onClick={saveUser} style={btnStyle("primary")}>Kaydet</button></>}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {[["Ad Soyad", "name", "text"], ["Kullanıcı Adı", "username", "text"], ["Şifre", "password", "password"]].map(([label, field, type]) => (
              <div key={field}>
                <label style={{ color: "#94a3b8", fontSize: 12, display: "block", marginBottom: 5 }}>{label}</label>
                <input type={type} value={uForm[field]} onChange={e => setUForm(f => ({ ...f, [field]: e.target.value }))}
                  style={{ width: "100%", background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "9px 12px", color: "#f1f5f9", fontSize: 14, outline: "none" }} />
              </div>
            ))}
            <div>
              <label style={{ color: "#94a3b8", fontSize: 12, display: "block", marginBottom: 5 }}>Rol</label>
              <div style={{ display: "flex", gap: 8 }}>
                {[["admin", "Yönetici"], ["user", "Personel"], ["viewer", "Görüntüleyici"]].map(([val, label]) => (
                  <button key={val} onClick={() => setUForm(f => ({ ...f, role: val }))}
                    style={{ flex: 1, padding: "9px", borderRadius: 8, border: `1px solid ${uForm.role === val ? roleColor(val) : "rgba(255,255,255,0.1)"}`, background: uForm.role === val ? `${roleColor(val)}18` : "transparent", color: uForm.role === val ? roleColor(val) : "#64748b", cursor: "pointer", fontSize: 13, fontWeight: 500 }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── SHARED COMPONENTS ────────────────────────────────────────────────────────
function Modal({ title, children, onClose, footer }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }}>
      <div style={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 18, width: "100%", maxWidth: 560, maxHeight: "90vh", overflow: "auto", animation: "slideIn 0.2s ease" }}>
        <div style={{ padding: "20px 24px 0", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{title}</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer" }}><Icon name="x" size={20} /></button>
        </div>
        <div style={{ padding: "0 24px 20px" }}>{children}</div>
        {footer && <div style={{ padding: "16px 24px", borderTop: "1px solid rgba(255,255,255,0.07)", display: "flex", justifyContent: "flex-end", gap: 10 }}>{footer}</div>}
      </div>
    </div>
  );
}

const selectStyle = { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "10px 14px", color: "#94a3b8", fontSize: 14, outline: "none" };

const btnStyle = (variant) => ({
  padding: "10px 18px",
  borderRadius: 9,
  border: variant === "ghost" ? "1px solid rgba(255,255,255,0.1)" : "none",
  background: variant === "primary" ? "linear-gradient(135deg, #3b82f6, #8b5cf6)" : "rgba(255,255,255,0.06)",
  color: variant === "primary" ? "#fff" : "#94a3b8",
  cursor: "pointer",
  fontSize: 14,
  fontWeight: variant === "primary" ? 600 : 400,
  transition: "all 0.15s",
  fontFamily: "'DM Sans', sans-serif",
});
