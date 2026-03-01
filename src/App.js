
import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

// ─── SUPABASE ─────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const DEFAULT_CATEGORIES = ["Elektronik", "Giyim", "Gıda", "Kırtasiye", "Temizlik", "Araç-Gereç"];
const DEFAULT_BRANDS = ["Samsung", "Nike", "Ülker", "Staedtler", "Mr. Muscle", "Bosch"];
const generateId = () => Math.random().toString(36).substr(2, 9);
const now = () => new Date().toISOString();

// DB row -> app object mappers
const mapProduct = (r) => ({
  id: r.id, name: r.name, sku: r.sku, barcode: r.barcode || "",
  category: r.category || "", brand: r.brand || "", variant: r.variant || "",
  minStock: r.min_stock, stock: r.stock, description: r.description || "",
  costPrice: r.cost_price || 0, salePrice: r.sale_price || 0, vatRate: r.vat_rate || 20,
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

const mapSupplier = (r) => ({
  id: r.id, name: r.name, contactName: r.contact_name || "", phone: r.phone || "",
  email: r.email || "", taxNumber: r.tax_number || "", address: r.address || "",
  notes: r.notes || "", isActive: r.is_active, createdAt: r.created_at,
});

const mapOrder = (r) => ({
  id: r.id, supplierId: r.supplier_id, supplierName: r.supplier_name,
  status: r.status, orderDate: r.order_date, deliveryDate: r.delivery_date || "",
  totalAmount: Number(r.total_amount) || 0, notes: r.notes || "",
  createdBy: r.created_by || "", createdAt: r.created_at,
});

const mapOrderItem = (r) => ({
  id: r.id, orderId: r.order_id, productId: r.product_id,
  productName: r.product_name, productSku: r.product_sku || "",
  quantity: r.quantity, unitCost: Number(r.unit_cost),
  totalCost: Number(r.total_cost) || r.quantity * Number(r.unit_cost),
  receivedQty: r.received_qty || 0,
});

// ─── ICONS ────────────────────────────────────────────────────────────────────
// ─── CAMERA BARCODE SCANNER ───────────────────────────────────────────────────
// ZXing kütüphanesi CDN üzerinden yüklenir, bileşen mount olunca dinamik import
function CameraScanner({ onDetected, onClose }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const readerRef = useRef(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastResult, setLastResult] = useState(null);
  const [torchOn, setTorchOn] = useState(false);
  const [facingMode, setFacingMode] = useState("environment");

  const stopCamera = () => {
    if (readerRef.current) { try { readerRef.current.reset(); } catch(e) {} }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
  };

  const startScanner = async (facing) => {
    setLoading(true);
    setError(null);
    stopCamera();

    try {
      // Load ZXing dynamically from CDN if not already loaded
      if (!window.ZXing) {
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "https://unpkg.com/@zxing/library@latest/umd/index.min.js";
          s.onload = resolve;
          s.onerror = () => reject(new Error("ZXing yüklenemedi"));
          document.head.appendChild(s);
        });
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      const hints = new Map();
      const formats = [
        window.ZXing.BarcodeFormat.EAN_13,
        window.ZXing.BarcodeFormat.EAN_8,
        window.ZXing.BarcodeFormat.CODE_128,
        window.ZXing.BarcodeFormat.CODE_39,
        window.ZXing.BarcodeFormat.QR_CODE,
        window.ZXing.BarcodeFormat.DATA_MATRIX,
        window.ZXing.BarcodeFormat.UPC_A,
        window.ZXing.BarcodeFormat.UPC_E,
      ];
      hints.set(window.ZXing.DecodeHintType.POSSIBLE_FORMATS, formats);
      hints.set(window.ZXing.DecodeHintType.TRY_HARDER, true);

      const reader = new window.ZXing.BrowserMultiFormatReader(hints);
      readerRef.current = reader;

      let lastCode = null;
      let lastTime = 0;

      reader.decodeFromVideoElement(videoRef.current, (result, err) => {
        if (result) {
          const code = result.getText();
          const now = Date.now();
          // Debounce: aynı kodu 1.5 saniye içinde tekrar okuma
          if (code !== lastCode || now - lastTime > 1500) {
            lastCode = code;
            lastTime = now;
            setLastResult(code);
            // Kısa titreşim feedback
            if (navigator.vibrate) navigator.vibrate(80);
            onDetected(code);
          }
        }
      });

      setLoading(false);
    } catch (err) {
      setError(err.message || "Kamera açılamadı");
      setLoading(false);
    }
  };

  useEffect(() => {
    startScanner(facingMode);
    return stopCamera;
  }, []);

  const switchCamera = () => {
    const next = facingMode === "environment" ? "user" : "environment";
    setFacingMode(next);
    startScanner(next);
  };

  const toggleTorch = async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn }] });
      setTorchOn(t => !t);
    } catch(e) { notify && notify("Flaş bu cihazda desteklenmiyor", "error"); }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.92)", zIndex: 1000, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
      {/* Header */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", background: "linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)", zIndex: 10 }}>
        <div style={{ color: "#fff" }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Barkod Tara</div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", marginTop: 2 }}>Kamerayı barkoda doğrultun</div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={switchCamera} style={{ width: 38, height: 38, borderRadius: 99, background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
            title="Kamera değiştir">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          </button>
          <button onClick={toggleTorch} style={{ width: 38, height: 38, borderRadius: 99, background: torchOn ? "rgba(255,220,50,0.3)" : "rgba(255,255,255,0.15)", border: torchOn ? "1px solid rgba(255,220,50,0.5)" : "none", color: torchOn ? "#ffd932" : "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
            title="Flaş">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          </button>
          <button onClick={() => { stopCamera(); onClose(); }} style={{ width: 38, height: 38, borderRadius: 99, background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>

      {/* Video */}
      <div style={{ position: "relative", width: "100%", maxWidth: 480, aspectRatio: "4/3" }}>
        <video ref={videoRef} style={{ width: "100%", height: "100%", objectFit: "cover", display: loading || error ? "none" : "block" }} muted playsInline />

        {/* Tarama çerçevesi */}
        {!loading && !error && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
            <div style={{ width: "70%", height: "35%", position: "relative" }}>
              {/* Köşeler */}
              {[{top:0,left:0,borderTop:"3px solid #fff",borderLeft:"3px solid #fff",borderRadius:"6px 0 0 0"},
                {top:0,right:0,borderTop:"3px solid #fff",borderRight:"3px solid #fff",borderRadius:"0 6px 0 0"},
                {bottom:0,left:0,borderBottom:"3px solid #fff",borderLeft:"3px solid #fff",borderRadius:"0 0 0 6px"},
                {bottom:0,right:0,borderBottom:"3px solid #fff",borderRight:"3px solid #fff",borderRadius:"0 0 6px 0"}
              ].map((s, i) => (
                <div key={i} style={{ position: "absolute", width: 24, height: 24, ...s }} />
              ))}
              {/* Scan line animasyonu */}
              <div style={{ position: "absolute", left: 4, right: 4, height: 2, background: "linear-gradient(90deg, transparent, #22c55e, transparent)", animation: "scanLine 1.8s ease-in-out infinite" }} />
            </div>
          </div>
        )}

        {loading && (
          <div style={{ position: "absolute", inset: 0, background: "#000", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
            <div style={{ width: 32, height: 32, border: "3px solid rgba(255,255,255,0.2)", borderTop: "3px solid #fff", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
            <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 13 }}>Kamera başlatılıyor...</div>
          </div>
        )}
        {error && (
          <div style={{ position: "absolute", inset: 0, background: "#000", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 24 }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <div style={{ color: "#fff", fontSize: 14, fontWeight: 500, textAlign: "center" }}>{error}</div>
            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, textAlign: "center" }}>Tarayıcı ayarlarından kamera iznini kontrol edin</div>
            <button onClick={() => startScanner(facingMode)} style={{ marginTop: 8, padding: "9px 20px", background: "#fff", border: "none", borderRadius: 9, color: "#18181b", fontWeight: 600, cursor: "pointer", fontSize: 13 }}>Tekrar Dene</button>
          </div>
        )}
      </div>

      {/* Son okunan */}
      <div style={{ marginTop: 20, padding: "14px 24px", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, minWidth: 280, textAlign: "center" }}>
        {lastResult ? (
          <>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Son Okunan</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#22c55e", fontFamily: "monospace", letterSpacing: "0.05em" }}>{lastResult}</div>
          </>
        ) : (
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>Henüz barkod okunmadı</div>
        )}
      </div>

      <style>{`
        @keyframes scanLine {
          0% { top: 4px; opacity: 1; }
          50% { top: calc(100% - 6px); opacity: 1; }
          100% { top: 4px; opacity: 1; }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}


const Icon = ({ name, size = 18, color }) => {
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
    purchasing: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>,
    supplier: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>,
    truck: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>,
    refresh: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>,
  };
  const el = icons[name] || null;
  if (!el || !color) return el;
  return <span style={{ color }}>{el}</span>;
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
    <div style={{ minHeight: "100vh", background: "#fafaf9", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Inter', sans-serif !important; background: #fafaf9 !important; color: #1c1917; }
        input, select, textarea, button { font-family: 'Inter', sans-serif; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #d6d3d1; border-radius: 99px; }

        .nav-item { transition: all 0.12s ease !important; }
        .nav-item:hover { background: #f5f5f4 !important; color: #1c1917 !important; }
        .nav-item.active { background: #f5f5f4 !important; color: #1c1917 !important; }

        .table-row:hover td, .table-row:hover { background: #fafaf9 !important; }
        .table-row:nth-child(even) { background: transparent !important; }

        .btn-hover { transition: all 0.12s ease !important; }
        .btn-hover:hover { opacity: 0.9; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,0.12) !important; }
        .btn-hover:active { transform: translateY(0) !important; }

        .card-hover { transition: all 0.15s ease !important; }
        .card-hover:hover { border-color: #d6d3d1 !important; box-shadow: 0 4px 14px rgba(0,0,0,0.06) !important; transform: translateY(-1px); }

        input:focus, select:focus, textarea:focus {
          outline: none !important;
          border-color: #a8a29e !important;
          box-shadow: 0 0 0 3px rgba(0,0,0,0.04) !important;
          background: #fff !important;
        }

        .row-actions { opacity: 0; transition: opacity 0.12s; }
        tr:hover .row-actions { opacity: 1; }

        @keyframes slideIn { from { opacity:0; transform:translateY(-8px); } to { opacity:1; transform:translateY(0); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
        @keyframes pulse { 0%,100%{opacity:1;} 50%{opacity:0.5;} }
      `}</style>
      <div style={{ display: "none" }} />
      <div style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: 16, padding: "40px 36px", width: 380, position: "relative", boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.05)" }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ width: 44, height: 44, background: "#18181b", borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
          </div>
          <h1 style={{ color: "#18181b", fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.03em" }}>StokPro</h1>
          <p style={{ color: "#a8a29e", margin: "6px 0 0", fontSize: 13 }}>Stok Yönetim Sistemi</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ color: "#78716c", fontSize: 12, fontWeight: 500, display: "block", marginBottom: 6 }}>Kullanıcı Adı</label>
            <input value={username} onChange={e => setUsername(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()}
              style={{ width: "100%", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 9, padding: "10px 13px", color: "#1c1917", fontSize: 14, transition: "all 0.15s", fontFamily: "inherit" }}
              placeholder="admin" />
          </div>
          <div>
            <label style={{ color: "#78716c", fontSize: 12, fontWeight: 500, display: "block", marginBottom: 6 }}>Şifre</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()}
              style={{ width: "100%", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 9, padding: "10px 13px", color: "#1c1917", fontSize: 14, transition: "all 0.15s", fontFamily: "inherit" }}
              placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" />
          </div>
          {error && <p style={{ color: "#dc2626", fontSize: 13, margin: 0, padding: "10px 12px", background: "#fef2f2", borderRadius: 8, border: "1px solid #fecaca" }}>{error}</p>}
          <button onClick={handleLogin} style={{ background: loading ? "#d6d3d1" : "#18181b", border: "none", borderRadius: 9, padding: "11px", color: "#fff", fontSize: 14, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer", marginTop: 18, transition: "all 0.15s", letterSpacing: "-0.01em", fontFamily: "inherit" }}>
            {loading ? "Giriş yapılıyor..." : "Giriş Yap"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(() => {
    try { const u = localStorage.getItem("stokpro_user"); return u ? JSON.parse(u) : null; } catch { return null; }
  });
  const [page, setPage] = useState("dashboard");
  const [products, setProducts] = useState([]);
  const [movements, setMovements] = useState([]);
  const [appUsers, setAppUsers] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [categories, setCategories] = useState(() => { try { return JSON.parse(localStorage.getItem("stokpro_cats")) || DEFAULT_CATEGORIES; } catch { return DEFAULT_CATEGORIES; } });
  const [brands, setBrands] = useState(() => { try { return JSON.parse(localStorage.getItem("stokpro_brands")) || DEFAULT_BRANDS; } catch { return DEFAULT_BRANDS; } });
  const [notification, setNotification] = useState(null);
  const [loading, setLoading] = useState(false);

  const notify = (msg, type = "success") => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 3000);
  };

  // Load data from Supabase after login
  useEffect(() => {
    // Load SheetJS for Excel support
    if (!window.XLSX) {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      document.head.appendChild(script);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    const loadData = async () => {
      setLoading(true);
      try {
        const [{ data: prods }, { data: moves }, { data: users }, { data: supps }, { data: orders }] = await Promise.all([
          supabase.from("products").select("*").order("created_at", { ascending: false }),
          supabase.from("movements").select("*").order("created_at", { ascending: false }),
          supabase.from("app_users").select("*"),
          supabase.from("suppliers").select("*").order("created_at", { ascending: false }),
          supabase.from("purchase_orders").select("*").order("created_at", { ascending: false }),
        ]);
        if (prods) setProducts(prods.map(mapProduct));
        if (moves) setMovements(moves.map(mapMovement));
        if (users) setAppUsers(users.map(mapUser));
        if (supps) setSuppliers(supps.map(mapSupplier));
        if (orders) setPurchaseOrders(orders.map(mapOrder));
      } catch (e) { notify("Veriler yüklenirken hata oluştu", "error"); }
      setLoading(false);
    };
    loadData();
  }, [user]);

  const handleLogin = (u) => { setUser(u); localStorage.setItem("stokpro_user", JSON.stringify(u)); };
  const handleLogout = () => { setUser(null); localStorage.removeItem("stokpro_user"); };

  if (!user) return <LoginScreen onLogin={handleLogin} />;
  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#fafaf9", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
      <div style={{ width: 48, height: 48, border: "3px solid #1e293b", borderTop: "3px solid #3b82f6", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <div style={{ color: "#a8a29e", fontSize: 14 }}>Veriler yükleniyor...</div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  const criticalProducts = products.filter(p => p.stock <= p.minStock);

  const pages = {
    dashboard: <Dashboard products={products} movements={movements} criticalProducts={criticalProducts} setPage={setPage} />,
    products: <ProductsPage products={products} setProducts={setProducts} movements={movements} setMovements={setMovements} user={user} notify={notify} categories={categories} brands={brands} />,
    movements: <MovementsPage movements={movements} products={products} setMovements={setMovements} setProducts={setProducts} user={user} notify={notify} />,
    counting: <CountingPage products={products} setProducts={setProducts} movements={movements} setMovements={setMovements} user={user} notify={notify} categories={categories} brands={brands} />,
    reports: <ReportsPage products={products} movements={movements} criticalProducts={criticalProducts} />,
    settings: <SettingsPage user={user} setUser={setUser} appUsers={appUsers} setAppUsers={setAppUsers} notify={notify} categories={categories} setCategories={setCategories} brands={brands} setBrands={setBrands} />,
    purchasing: <PurchasingPage suppliers={suppliers} setSuppliers={setSuppliers} purchaseOrders={purchaseOrders} setPurchaseOrders={setPurchaseOrders} products={products} setProducts={setProducts} setMovements={setMovements} user={user} notify={notify} />,
  };

  const navItems = [
    { id: "dashboard", label: "Özet", icon: "dashboard" },
    { id: "products", label: "Ürünler", icon: "products" },
    { id: "movements", label: "Hareketler", icon: "movements" },
    { id: "counting", label: "Sayım", icon: "scan" },
    { id: "purchasing", label: "Satın Alma", icon: "purchasing" },
    { id: "reports", label: "Raporlar", icon: "reports" },
    { id: "settings", label: "Ayarlar", icon: "settings" },
  ];

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#fafaf9", fontFamily: "'Inter', sans-serif", color: "#1c1917" }}>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js" />
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        
        body { font-family: 'Inter', sans-serif !important; background: var(--bg) !important; }
        input, select, textarea, button { font-family: 'Inter', sans-serif; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #27272a; border-radius: 99px; }
        
        .nav-item { transition: all 0.15s ease !important; }
        .nav-item:hover { background: #f5f5f4 !important; color: #1c1917 !important; }
        
        .table-row { transition: background 0.1s; }
        .table-row:nth-child(even) { background: rgba(255,255,255,0.012) !important; }
        .table-row:hover { background: #fafaf9 !important; }
        
        .btn-hover { transition: all 0.15s ease !important; }
        .btn-hover:hover { opacity: 0.88; transform: translateY(-1px); box-shadow: 0 4px 14px rgba(0,0,0,0.35) !important; }
        .btn-hover:active { transform: translateY(0) !important; }
        
        .card-hover { transition: all 0.2s ease !important; }
        .card-hover:hover { border-color: #d6d3d1 !important; transform: translateY(-2px); box-shadow: 0 12px 32px rgba(0,0,0,0.25) !important; }
        
        
        
        input:focus, select:focus, textarea:focus { outline: none !important; border-color: rgba(99,102,241,0.5) !important; box-shadow: 0 0 0 3px rgba(99,102,241,0.1) !important; }
        
        @keyframes slideIn { from { opacity:0; transform:translateY(-8px); } to { opacity:1; transform:translateY(0); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
        @keyframes pulse { 0%,100%{opacity:1;} 50%{opacity:0.5;} }
      `}</style>

      {/* Sidebar */}
      <aside style={{ width: 220, background: "#fff", borderRight: "1px solid #e7e5e4", display: "flex", flexDirection: "column", position: "fixed", height: "100vh", zIndex: 100 }}>
        <div style={{ padding: "16px 14px 13px", borderBottom: "1px solid #f5f5f4" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <div style={{ width: 30, height: 30, background: "#fafaf9", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14.5, color: "#fafaf9", letterSpacing: "-0.02em" }}>StokPro</div>
              <div style={{ fontSize: 11, color: "#a8a29e", fontWeight: 400 }}>Stok Yönetimi</div>
            </div>
          </div>
        </div>

        <nav style={{ flex: 1, padding: "8px 7px", display: "flex", flexDirection: "column", gap: 1 }}>
          {navItems.map(item => (
            <button key={item.id} className="nav-item" onClick={() => setPage(item.id)}
              style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 10px", borderRadius: 7, border: "none", background: page === item.id ? "#f5f5f4" : "transparent", color: page === item.id ? "#1c1917" : "#78716c", cursor: "pointer", fontSize: 13, fontWeight: page === item.id ? 600 : 400, textAlign: "left", width: "100%", position: "relative" }}>
              <Icon name={item.icon} size={16} />
              {item.label}
              {item.id === "products" && criticalProducts.length > 0 && (
                <span style={{ marginLeft: "auto", background: "#ef4444", color: "#fff", borderRadius: 6, padding: "1px 6px", fontSize: 11, fontWeight: 700 }}>{criticalProducts.length}</span>
              )}
            </button>
          ))}
        </nav>

        <div style={{ padding: "12px 10px", borderTop: "1px solid #f5f5f4" }}>
          <div style={{ padding: "10px 12px", marginBottom: 8 }}>
            <div style={{ color: "#1c1917", fontSize: 13, fontWeight: 600 }}>{user.name}</div>
            <div style={{ color: "#a8a29e", fontSize: 11, fontWeight: 400 }}>{user.role === "admin" ? "Yönetici" : user.role === "user" ? "Personel" : "Görüntüleyici"}</div>
          </div>
          <button className="nav-item" onClick={handleLogout}
            style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 10px", borderRadius: 7, border: "none", background: "transparent", color: "#78716c", cursor: "pointer", fontSize: 13, width: "100%" }}>
            <Icon name="logout" size={16} /> Çıkış Yap
          </button>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, marginLeft: 220, padding: "28px 32px", overflow: "auto", background: "#fafaf9" }}>
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
  const [showAllCritical, setShowAllCritical] = useState(false);
  const totalStock = products.reduce((s, p) => s + p.stock, 0);
  const totalStockValue = products.reduce((s, p) => s + (p.stock * (p.costPrice || 0)), 0);
  const totalSaleValue = products.reduce((s, p) => s + (p.stock * (p.salePrice || 0)), 0);
  const totalPotentialProfit = products.reduce((s, p) => {
    if (!p.costPrice || !p.salePrice) return s;
    const vatRate = (Number(p.vatRate) > 0 && Number(p.vatRate) <= 100) ? Number(p.vatRate) : 20;
    const saleExVat = p.salePrice / (1 + vatRate / 100);
    return s + (p.stock * (saleExVat - p.costPrice));
  }, 0);
  const todayMoves = movements.filter(m => new Date(m.createdAt).toDateString() === new Date().toDateString());
  const recentMoves = [...movements].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 6);

  // Son 7 gun hareket verileri
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i));
    const key = d.toDateString();
    const label = d.toLocaleDateString("tr-TR", { weekday: "short", day: "numeric" });
    const giris = movements.filter(m => m.type === "Giriş" && new Date(m.createdAt).toDateString() === key).reduce((s, m) => s + m.quantity, 0);
    const cikis = movements.filter(m => m.type === "Çıkış" && new Date(m.createdAt).toDateString() === key).reduce((s, m) => s + m.quantity, 0);
    return { label, giris, cikis };
  });
  const maxVal = Math.max(...last7.map(d => Math.max(d.giris, d.cikis)), 1);

  // Kategori dagilimi
  const catMap = {};
  products.forEach(p => { const c = p.category || "Diğer"; catMap[c] = (catMap[c] || 0) + 1; });
  const catData = Object.entries(catMap).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const catTotal = catData.reduce((s, [, v]) => s + v, 0);
  const catColors = ["#18181b", "#57534e", "#a8a29e", "#d6d3d1", "#78716c", "#44403c"];

  // Donut chart SVG
  const DonutChart = ({ data, total, colors }) => {
    const size = 144; const r = 52; const cx = size / 2; const cy = size / 2;
    const circumference = 2 * Math.PI * r;
    let offset = 0;
    const slices = data.map(([label, val], i) => {
      const pct = val / total;
      const dash = pct * circumference;
      const gap = circumference - dash;
      const sl = { label, val, pct, dash, gap, offset, color: colors[i] };
      offset += dash;
      return sl;
    });
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f5f5f4" strokeWidth="22" />
        {slices.map((s, i) => (
          <circle key={i} cx={cx} cy={cy} r={r} fill="none"
            stroke={s.color} strokeWidth="22"
            strokeDasharray={`${s.dash} ${s.gap}`}
            strokeDashoffset={-s.offset + circumference * 0.25}
          />
        ))}
        <text x={cx} y={cy - 5} textAnchor="middle" style={{ fontSize: 20, fontWeight: 700, fill: "#18181b", fontFamily: "Inter, sans-serif" }}>{total}</text>
        <text x={cx} y={cy + 13} textAnchor="middle" style={{ fontSize: 10, fill: "#a8a29e", fontFamily: "Inter, sans-serif" }}>ürün</text>
      </svg>
    );
  };

  const StatCard = ({ title, value, sub, color, icon }) => (
    <div className="card-hover" style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: 11, padding: "16px 18px", position: "relative", overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
        <div style={{ fontSize: 10.5, fontWeight: 600, color: "#a8a29e", textTransform: "uppercase", letterSpacing: "0.05em" }}>{title}</div>
        <div style={{ width: 28, height: 28, background: color === "#dc2626" ? "#fef2f2" : "#f5f5f4", borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", color: color || "#78716c" }}>
          <Icon name={icon} size={14} />
        </div>
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: "#18181b", letterSpacing: "-0.03em", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ color: "#a8a29e", fontSize: 11.5, marginTop: 4 }}>{sub}</div>}
    </div>
  );

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 21, fontWeight: 700, margin: 0, color: "#18181b", letterSpacing: "-0.03em" }}>Kontrol Paneli</h1>
        <p style={{ color: "#a8a29e", margin: "4px 0 0", fontSize: 13 }}>{new Date().toLocaleDateString("tr-TR", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
      </div>

      {/* Stat Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 12 }}>
        <StatCard title="Toplam Ürün" value={products.length} sub="Tanımlı ürün" icon="products" color="#3b82f6" />
        <StatCard title="Toplam Stok" value={totalStock.toLocaleString("tr-TR")} sub="Tüm ürünler" icon="inventory" color="#44403c" />
        <StatCard title="Kritik Stok" value={criticalProducts.length} sub="Min. seviye altı" icon="warning" color={criticalProducts.length > 0 ? "#dc2626" : "#16a34a"} />
        <StatCard title="Bugünkü Hareket" value={todayMoves.length} sub="Giriş/Çıkış" icon="movements" color="#f59e0b" />
      </div>

      {/* Financial Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 16 }}>
        <div style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: 11, padding: "16px 18px" }}>
          <div style={{ fontSize: 10.5, fontWeight: 600, color: "#a8a29e", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Stok Maliyet Değeri</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#18181b", letterSpacing: "-0.02em" }}>₺{totalStockValue.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div style={{ color: "#a8a29e", fontSize: 11.5, marginTop: 4 }}>Stok × Maliyet Fiyatı</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: 11, padding: "16px 18px" }}>
          <div style={{ fontSize: 10.5, fontWeight: 600, color: "#a8a29e", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Potansiyel Satış Değeri</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#2563eb", letterSpacing: "-0.02em" }}>₺{totalSaleValue.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div style={{ color: "#a8a29e", fontSize: 11.5, marginTop: 4 }}>Stok × Satış Fiyatı (KDV Dahil)</div>
        </div>
        <div style={{ background: "#fff", border: `1px solid ${totalPotentialProfit >= 0 ? "#bbf7d0" : "#fecaca"}`, borderRadius: 11, padding: "16px 18px" }}>
          <div style={{ fontSize: 10.5, fontWeight: 600, color: "#a8a29e", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Potansiyel Kâr</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: totalPotentialProfit >= 0 ? "#16a34a" : "#dc2626", letterSpacing: "-0.02em" }}>₺{totalPotentialProfit.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div style={{ color: "#a8a29e", fontSize: 11.5, marginTop: 4 }}>Tüm stok satılsıydı (KDV Hariç)</div>
        </div>
      </div>

      {/* Charts Row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 12, marginBottom: 12 }}>

        {/* Line Chart - Son 7 Gün Hareketler */}
        <div style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: 12, padding: "20px 22px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: "#18181b" }}>Stok Hareketleri</div>
              <div style={{ fontSize: 12, color: "#a8a29e", marginTop: 2 }}>Son 7 gün</div>
            </div>
            <div style={{ display: "flex", gap: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#16a34a" }} />
                <span style={{ fontSize: 11.5, color: "#78716c" }}>Giriş</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#dc2626" }} />
                <span style={{ fontSize: 11.5, color: "#78716c" }}>Çıkış</span>
              </div>
            </div>
          </div>
          <div style={{ position: "relative", height: 140 }}>
            {/* Grid lines */}
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} style={{ position: "absolute", left: 0, right: 0, bottom: i * 25 + "%", borderTop: "1px dashed #f0eeed", zIndex: 0 }} />
            ))}
            {/* Bars */}
            <div style={{ display: "flex", alignItems: "flex-end", height: "100%", gap: 6, position: "relative", zIndex: 1 }}>
              {last7.map((day, i) => (
                <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, height: "100%", justifyContent: "flex-end" }}>
                  <div style={{ width: "100%", display: "flex", gap: 2, alignItems: "flex-end", height: 116 }}>
                    <div title={"Giriş: " + day.giris} style={{ flex: 1, background: "#dcfce7", borderRadius: "3px 3px 0 0", height: (day.giris / maxVal * 100) + "%", minHeight: day.giris > 0 ? 3 : 0, transition: "height 0.4s ease", position: "relative" }}>
                      {day.giris > 0 && <div style={{ position: "absolute", top: -18, left: "50%", transform: "translateX(-50%)", fontSize: 10, color: "#16a34a", fontWeight: 600, whiteSpace: "nowrap" }}>{day.giris}</div>}
                    </div>
                    <div title={"Çıkış: " + day.cikis} style={{ flex: 1, background: "#fee2e2", borderRadius: "3px 3px 0 0", height: (day.cikis / maxVal * 100) + "%", minHeight: day.cikis > 0 ? 3 : 0, transition: "height 0.4s ease", position: "relative" }}>
                      {day.cikis > 0 && <div style={{ position: "absolute", top: -18, left: "50%", transform: "translateX(-50%)", fontSize: 10, color: "#dc2626", fontWeight: 600, whiteSpace: "nowrap" }}>{day.cikis}</div>}
                    </div>
                  </div>
                  <div style={{ fontSize: 10, color: "#a8a29e", textAlign: "center", lineHeight: 1.2 }}>{day.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Donut Chart - Kategori Dağılımı */}
        <div style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: 12, padding: "20px 22px" }}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: "#18181b" }}>Kategori Dağılımı</div>
            <div style={{ fontSize: 12, color: "#a8a29e", marginTop: 2 }}>Ürün sayısına göre</div>
          </div>
          {catData.length === 0 ? (
            <div style={{ textAlign: "center", padding: "30px 0", color: "#a8a29e", fontSize: 13 }}>Veri yok</div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
              <DonutChart data={catData} total={catTotal} colors={catColors} />
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7 }}>
                {catData.map(([label, val], i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: catColors[i], flexShrink: 0 }} />
                    <div style={{ flex: 1, fontSize: 11.5, color: "#44403c", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</div>
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: "#18181b" }}>{val}</div>
                    <div style={{ fontSize: 10.5, color: "#a8a29e", width: 30, textAlign: "right" }}>{Math.round(val / catTotal * 100)}%</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Row: Recent + Critical */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {/* Recent movements */}
        <div style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: 12, padding: "20px 22px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: "#18181b" }}>Son Hareketler</div>
            <button onClick={() => setPage("movements")} style={{ background: "none", border: "none", color: "#78716c", cursor: "pointer", fontSize: 12.5, fontWeight: 500 }}>Tümü →</button>
          </div>
          {recentMoves.length === 0 ? (
            <div style={{ textAlign: "center", padding: "30px 0", color: "#a8a29e", fontSize: 13 }}>Henüz hareket yok</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {recentMoves.map(m => (
                <div key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 10px", background: "#fafaf9", borderRadius: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                    <div style={{ width: 28, height: 28, borderRadius: 7, background: m.type === "Giriş" ? "#f0fdf4" : "#fef2f2", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Icon name={m.type === "Giriş" ? "trending_up" : "trending_down"} size={13} color={m.type === "Giriş" ? "#16a34a" : "#dc2626"} />
                    </div>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 500, color: "#1c1917" }}>{m.productName}</div>
                      <div style={{ fontSize: 11, color: "#a8a29e" }}>{m.user} · {formatDate(m.createdAt)}</div>
                    </div>
                  </div>
                  <span style={{ color: m.type === "Giriş" ? "#16a34a" : "#dc2626", fontWeight: 600, fontSize: 13 }}>{m.type === "Giriş" ? "+" : "-"}{m.quantity}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Critical stocks */}
        <div style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: 12, padding: "20px 22px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: "#18181b" }}>Kritik Stok</div>
              {criticalProducts.length > 0 && <span style={{ background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca", borderRadius: 99, padding: "1px 7px", fontSize: 11, fontWeight: 600 }}>{criticalProducts.length}</span>}
            </div>
            <button onClick={() => setPage("products")} style={{ background: "none", border: "none", color: "#78716c", cursor: "pointer", fontSize: 12.5, fontWeight: 500 }}>Tümü →</button>
          </div>
          {criticalProducts.length === 0 ? (
            <div style={{ textAlign: "center", padding: "30px 0" }}>
              <div style={{ fontSize: 22, marginBottom: 6 }}>✅</div>
              <div style={{ fontSize: 13, color: "#a8a29e" }}>Tüm stoklar yeterli seviyede</div>
            </div>
          ) : (
            <div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {(showAllCritical ? criticalProducts : criticalProducts.slice(0, 5)).map(p => (
                  <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8 }}>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 500, color: "#1c1917" }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: "#a8a29e", marginTop: 1 }}>Min: {p.minStock} · Mevcut: {p.stock}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ color: p.stock === 0 ? "#dc2626" : "#d97706", fontWeight: 700, fontSize: 17 }}>{p.stock}</div>
                      <div style={{ fontSize: 10, color: "#a8a29e" }}>adet</div>
                    </div>
                  </div>
                ))}
              </div>
              {criticalProducts.length > 5 && (
                <button onClick={() => setShowAllCritical(v => !v)}
                  style={{ marginTop: 8, width: "100%", padding: "8px", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 8, color: "#78716c", fontSize: 12.5, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                  {showAllCritical ? "▲ Daha az göster" : `▼ ${criticalProducts.length - 5} ürün daha göster`}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── PRODUCTS PAGE ────────────────────────────────────────────────────────────
function ProductsPage({ products, setProducts, movements, setMovements, user, notify, categories, brands }) {
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("");
  const [modal, setModal] = useState(null); // null | "add" | "edit" | "view" | "move" | "bulkMove"
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({});
  const [moveForm, setMoveForm] = useState({ type: "Giriş", quantity: "", note: "" });
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkMoveForm, setBulkMoveForm] = useState({ type: "Giriş", quantity: "", note: "" });
  const [confirmDelete, setConfirmDelete] = useState(false);

  const canEdit = user.role !== "viewer";

  const filtered = products.filter(p => {
    const s = search.toLowerCase();
    return (!s || p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s) || p.barcode.includes(s)) &&
      (!filterCat || p.category === filterCat);
  });

  const openAdd = () => { setForm({ name: "", sku: "", barcode: "", category: "", brand: "", variant: "", minStock: 5, description: "", stock: 0, costPrice: "", salePrice: "", vatRate: 20 }); setModal("add"); };
  const openEdit = (p) => { setForm({ ...p, costPrice: p.costPrice || "", salePrice: p.salePrice || "", vatRate: p.vatRate || 20 }); setSelected(p); setModal("edit"); };
  const openView = (p) => { setSelected(p); setModal("view"); };
  const openMove = (p) => { setSelected(p); setMoveForm({ type: "Giriş", quantity: "", note: "" }); setModal("move"); };

  const saveProduct = async () => {
    if (!form.name || !form.sku) { notify("Ürün adı ve SKU zorunludur", "error"); return; }
    const dbObj = {
      name: form.name, sku: form.sku, barcode: form.barcode || "",
      category: form.category || "", brand: form.brand || "", variant: form.variant || "",
      min_stock: Number(form.minStock) || 0, stock: Number(form.stock) || 0,
      description: form.description || "",
      cost_price: Number(form.costPrice) || 0,
      sale_price: Number(form.salePrice) || 0,
      vat_rate: Number(form.vatRate) || 20,
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

  const deleteProduct = async (p) => {
    if (!window.confirm(`"${p.name}" ürününü silmek istediğinize emin misiniz?`)) return;
    const { error } = await supabase.from("products").delete().eq("id", p.id);
    if (error) { notify("Ürün silinemedi: " + error.message, "error"); return; }
    setProducts(prev => prev.filter(x => x.id !== p.id));
    notify("Ürün silindi");
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map(p => p.id)));
  };

  const bulkDelete = async () => {
    const ids = [...selectedIds];
    const { error } = await supabase.from("products").delete().in("id", ids);
    if (error) { notify("Toplu silme başarısız", "error"); return; }
    setProducts(prev => prev.filter(p => !ids.includes(p.id)));
    setSelectedIds(new Set());
    setConfirmDelete(false);
    notify(`${ids.length} ürün silindi`);
  };

  const bulkMove = async () => {
    const qty = parseInt(bulkMoveForm.quantity);
    if (!qty || qty <= 0) { notify("Geçerli miktar girin", "error"); return; }
    const ids = [...selectedIds];
    for (const id of ids) {
      const p = products.find(x => x.id === id);
      if (!p) continue;
      const prev = p.stock;
      const next = bulkMoveForm.type === "Giriş" ? prev + qty : Math.max(0, prev - qty);
      await supabase.from("products").update({ stock: next }).eq("id", id);
      await supabase.from("movements").insert([{ product_id: id, product_name: p.name, type: bulkMoveForm.type, quantity: qty, prev_stock: prev, next_stock: next, username: user.username, note: bulkMoveForm.note || "Toplu işlem" }]);
    }
    const { data: fresh } = await supabase.from("products").select("*").order("created_at", { ascending: false });
    if (fresh) setProducts(fresh.map(mapProduct));
    const { data: moves } = await supabase.from("movements").select("*").order("created_at", { ascending: false });
    if (moves) setMovements(moves.map(mapMovement));
    setSelectedIds(new Set());
    setModal(null);
    notify(`${ids.length} ürüne toplu ${bulkMoveForm.type} yapıldı`);
  };

  const exportExcelProducts = () => exportExcel(products.map(p => {
    const vatRate = p.vatRate || 20;
    const saleExVat = p.salePrice ? (p.salePrice / (1 + vatRate / 100)) : 0;
    const profit = saleExVat && p.costPrice ? saleExVat - p.costPrice : null;
    const margin = profit !== null && saleExVat > 0 ? (profit / saleExVat * 100).toFixed(1) + "%" : "-";
    return {
      "Ürün Adı": p.name, SKU: p.sku, Barkod: p.barcode,
      Kategori: p.category, Marka: p.brand, Varyant: p.variant,
      "Mevcut Stok": p.stock, "Min Stok": p.minStock,
      "Maliyet Fiyatı (₺)": p.costPrice || "",
      "Satış Fiyatı KDV Dahil (₺)": p.salePrice || "",
      "KDV Oranı (%)": p.vatRate || 20,
      "Satış Fiyatı KDV Hariç (₺)": saleExVat ? saleExVat.toFixed(2) : "",
      "Kâr/Adet (₺)": profit !== null ? profit.toFixed(2) : "",
      "Kâr Marjı": margin,
      "Toplam Stok Değeri (₺)": p.costPrice ? (p.stock * p.costPrice).toFixed(2) : "",
      Açıklama: p.description || "",
    };
  }), "urunler.xlsx");

  const downloadTemplate = async () => {
    try {
      const XLSX = await loadXLSX();
      const headers = ["Ürün Adı *", "SKU *", "Barkod", "Kategori", "Marka", "Varyant", "Mevcut Stok", "Min Stok", "Maliyet Fiyatı", "Satış Fiyatı (KDV Dahil)", "KDV Oranı %", "Açıklama"];
      const sample = [["Örnek Ürün 1", "URN-001", "1234567890123", "Elektronik", "Samsung", "Siyah / 128GB", 50, 10, 100, 250, 20, "Açıklama"], ["Örnek Ürün 2", "URN-002", "", "Giyim", "Nike", "Beyaz / 42", 30, 5, 200, 450, 20, ""]];
      const ws = XLSX.utils.aoa_to_sheet([headers, ...sample]);
      ws["!cols"] = [35, 20, 20, 18, 15, 20, 14, 10, 18, 22, 12, 30].map(w => ({ wch: w }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Ürünler");
      XLSX.writeFile(wb, "urun-sablonu.xlsx");
    } catch (err) { notify("Şablon indirilemedi: " + err.message, "error"); }
  };

  const loadXLSX = () => new Promise((resolve, reject) => {
    if (window.XLSX) { resolve(window.XLSX); return; }
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    script.onload = () => resolve(window.XLSX);
    script.onerror = () => reject(new Error("SheetJS yüklenemedi"));
    document.head.appendChild(script);
  });

  const handleExcelImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const XLSX = await loadXLSX();
      if (!XLSX) { notify("Excel kütüphanesi yüklenemedi", "error"); return; }
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
      if (rows.length < 2) { notify("Excel dosyası boş veya okunamadı", "error"); return; }
      notify(`${rows.length - 1} satır okundu, işleniyor...`);
      const headers = rows[0].map(h => String(h).trim());
      const colMap = {
        name: headers.findIndex(h => h.includes("Ürün") || h.toLowerCase() === "name"),
        sku: headers.findIndex(h => h.includes("SKU") || h.toLowerCase() === "sku"),
        barcode: headers.findIndex(h => h.includes("Barkod") || h.toLowerCase() === "barcode"),
        category: headers.findIndex(h => h.includes("Kategori") || h.toLowerCase() === "category"),
        brand: headers.findIndex(h => h.includes("Marka") || h.toLowerCase() === "brand"),
        variant: headers.findIndex(h => h.includes("Varyant") || h.toLowerCase() === "variant"),
        stock: headers.findIndex(h => h.includes("Mevcut") || h.toLowerCase() === "stock"),
        minStock: headers.findIndex(h => h.includes("Min") || h.toLowerCase() === "min"),
        costPrice: headers.findIndex(h => h.includes("Maliyet") || h.toLowerCase().includes("cost")),
        salePrice: headers.findIndex(h => h.includes("Satış") || h.toLowerCase().includes("sale")),
        vatRate: headers.findIndex(h => h.includes("KDV") || h.toLowerCase().includes("vat")),
        description: headers.findIndex(h => h.includes("Açıklama") || h.toLowerCase() === "description"),
      };
      if (colMap.name === -1 || colMap.sku === -1) { notify("'Ürün Adı' ve 'SKU' sütunları zorunludur", "error"); return; }
      // Fetch all existing SKUs from Supabase to avoid duplicates
      const { data: existingProds } = await supabase.from("products").select("id, sku");
      const skuMap = {};
      (existingProds || []).forEach(p => { skuMap[p.sku] = p.id; });

      let added = 0; let updated = 0; let errors = 0;
      const toInsert = []; const toUpdate = [];
      rows.slice(1).forEach(row => {
        const name = String(row[colMap.name] || "").trim();
        const sku = String(row[colMap.sku] || "").trim();
        if (!name || !sku) { errors++; return; }
        if (name === "Örnek Ürün 1" || name === "Örnek Ürün 2") return;
        const productData = {
          name, sku,
          barcode: colMap.barcode >= 0 ? String(row[colMap.barcode] || "") : "",
          category: colMap.category >= 0 ? String(row[colMap.category] || "") : "",
          brand: colMap.brand >= 0 ? String(row[colMap.brand] || "") : "",
          variant: colMap.variant >= 0 ? String(row[colMap.variant] || "") : "",
          stock: colMap.stock >= 0 ? (parseInt(row[colMap.stock]) || 0) : 0,
          min_stock: colMap.minStock >= 0 ? (parseInt(row[colMap.minStock]) || 0) : 0,
          cost_price: colMap.costPrice >= 0 ? (parseFloat(row[colMap.costPrice]) || 0) : 0,
          sale_price: colMap.salePrice >= 0 ? (parseFloat(row[colMap.salePrice]) || 0) : 0,
          vat_rate: colMap.vatRate >= 0 ? (parseInt(row[colMap.vatRate]) || 20) : 20,
          description: colMap.description >= 0 ? String(row[colMap.description] || "") : "",
        };
        if (skuMap[sku]) { toUpdate.push({ ...productData, id: skuMap[sku] }); updated++; }
        else { toInsert.push(productData); added++; }
      });
      // Upsert: insert or update based on SKU
      const allRows = [...toInsert, ...toUpdate.map(({ id, ...rest }) => rest)];
      for (let i = 0; i < allRows.length; i += 50) {
        const batch = allRows.slice(i, i + 50);
        const { error: upsErr } = await supabase.from("products").upsert(batch, { onConflict: "sku", ignoreDuplicates: false });
        if (upsErr) { notify("Yükleme hatası: " + upsErr.message, "error"); return; }
      }
      const { data: fresh } = await supabase.from("products").select("*").order("created_at", { ascending: false });
      if (fresh) setProducts(fresh.map(mapProduct));
      notify(`Excel yüklendi: ${added} yeni ürün eklendi, ${updated} güncellendi${errors > 0 ? ", " + errors + " satır atlandı" : ""}`);
    } catch (err) { notify("Excel okunamadı: " + err.message, "error"); }
    e.target.value = "";
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
      <label style={{ color: "#78716c", fontSize: 12, fontWeight: 500, display: "block", marginBottom: 5 }}>{label}</label>
      {options ? (
        <select value={form[field] || ""} onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
          style={{ width: "100%", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 8, padding: "9px 12px", color: "#1c1917", fontSize: 14, outline: "none" }}>
          <option value="">Seçin...</option>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input type={type} value={form[field] || ""} onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
          style={{ width: "100%", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 8, padding: "9px 12px", color: "#1c1917", fontSize: 14, outline: "none" }} />
      )}
    </div>
  );

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Ürün Yönetimi</h1>
          <p style={{ color: "#a8a29e", margin: "4px 0 0", fontSize: 13 }}>{products.length} ürün kayıtlı{selectedIds.size > 0 && <span style={{ color: "#60a5fa", marginLeft: 8 }}>· {selectedIds.size} seçili</span>}</p>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {selectedIds.size > 0 && canEdit && (
            <>
              <button onClick={() => { setBulkMoveForm({ type: "Giriş", quantity: "", note: "" }); setModal("bulkMove"); }} className="btn-hover"
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 18px", background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.3)", borderRadius: 10, color: "#60a5fa", cursor: "pointer", fontSize: 14, fontWeight: 500 }}>
                <Icon name="movements" size={15} /> Toplu Stok
              </button>
              <button onClick={() => setConfirmDelete(true)} className="btn-hover"
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 18px", background: "#fef2f2", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 10, color: "#dc2626", cursor: "pointer", fontSize: 14, fontWeight: 500 }}>
                <Icon name="x" size={15} /> Seçilenleri Sil ({selectedIds.size})
              </button>
            </>
          )}
          {canEdit && (
            <>
              <button onClick={exportExcelProducts} className="btn-hover" style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 18px", background: "rgba(0,0,0,0.03)", border: "1px solid #e7e5e4", borderRadius: 9, color: "#78716c", cursor: "pointer", fontSize: 14, transition: "all 0.15s" }}>
                <Icon name="download" size={15} /> Excel İndir
              </button>
              <button onClick={downloadTemplate} className="btn-hover" style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 18px", background: "rgba(0,0,0,0.03)", border: "1px solid #e7e5e4", borderRadius: 9, color: "#78716c", cursor: "pointer", fontSize: 14, transition: "all 0.15s" }}>
                <Icon name="download" size={15} /> Şablon İndir
              </button>
              <label className="btn-hover" style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 18px", background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.25)", borderRadius: 10, color: "#16a34a", cursor: "pointer", fontSize: 14, fontWeight: 500, transition: "all 0.15s" }}>
                <Icon name="upload" size={15} /> Excel Yükle
                <input type="file" accept=".xlsx,.xls" onChange={handleExcelImport} style={{ display: "none" }} />
              </label>
              <button onClick={openAdd} className="btn-hover" style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 18px", background: "#18181b", border: "none", borderRadius: 10, color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600, transition: "all 0.15s" }}>
                <Icon name="plus" size={15} /> Yeni Ürün
              </button>
            </>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <div style={{ flex: 1, position: "relative" }}>
          <div style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#a8a29e" }}><Icon name="search" size={16} /></div>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Ürün adı, SKU veya barkod ile ara..."
            style={{ width: "100%", background: "rgba(0,0,0,0.02)", border: "1px solid #e7e5e4", borderRadius: 10, padding: "10px 12px 10px 38px", color: "#1c1917", fontSize: 14, outline: "none" }} />
        </div>
        <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
          style={{ background: "rgba(0,0,0,0.02)", border: "1px solid #e7e5e4", borderRadius: 10, padding: "10px 14px", color: "#78716c", fontSize: 14, outline: "none" }}>
          <option value="">Tüm Kategoriler</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div style={{ background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 14, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #e7e5e4" }}>
              <th style={{ padding: "12px 12px", width: 40 }}>
                <input type="checkbox" checked={filtered.length > 0 && selectedIds.size === filtered.length} onChange={toggleSelectAll} style={{ cursor: "pointer", accentColor: "#3b82f6", width: 15, height: 15 }} />
              </th>
              {["Ürün Adı", "SKU", "Kategori", "Marka", "Maliyet", "Satış", "Marj", "Stok", "Min", "Durum", ""].map(h => (
                <th key={h} style={{ padding: "12px 16px", textAlign: "left", color: "#a8a29e", fontSize: 11.5, marginTop: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => (
              <tr key={p.id} className="table-row" style={{ borderBottom: "1px solid #f5f5f4", transition: "background 0.1s", background: selectedIds.has(p.id) ? "rgba(59,130,246,0.07)" : undefined }}>
                <td style={{ padding: "13px 12px" }}>
                  <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggleSelect(p.id)} style={{ cursor: "pointer", accentColor: "#3b82f6", width: 15, height: 15 }} />
                </td>
                <td style={{ padding: "13px 16px" }}>
                  <div style={{ fontWeight: 500, color: "#1c1917", fontSize: 14 }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: "#a8a29e" }}>{p.barcode}</div>
                </td>
                <td style={{ padding: "13px 16px", color: "#a8a29e", fontSize: 13, fontFamily: "'Space Mono', monospace" }}>{p.sku}</td>
                <td style={{ padding: "13px 16px" }}><span style={{ background: "rgba(59,130,246,0.1)", color: "#60a5fa", borderRadius: 6, padding: "3px 9px", fontSize: 12 }}>{p.category}</span></td>
                <td style={{ padding: "13px 16px", color: "#78716c", fontSize: 13 }}>{p.brand}</td>
                <td style={{ padding: "13px 16px", color: "#a8a29e", fontSize: 13 }}>{p.costPrice > 0 ? `₺${Number(p.costPrice).toFixed(2)}` : "-"}</td>
                <td style={{ padding: "13px 16px", color: "#1c1917", fontSize: 13 }}>{p.salePrice > 0 ? `₺${Number(p.salePrice).toFixed(2)}` : "-"}</td>
                <td style={{ padding: "13px 16px", fontSize: 13 }}>{(() => {
                  if (!p.costPrice || !p.salePrice) return <span style={{ color: "#a8a29e" }}>-</span>;
                  const vatRate = (Number(p.vatRate) > 0 && Number(p.vatRate) <= 100) ? Number(p.vatRate) : 20;
                  const saleExVat = Number(p.salePrice) / (1 + vatRate / 100);
                  const marginVal = (saleExVat - Number(p.costPrice)) / saleExVat * 100;
                  const col = marginVal >= 0 ? "#16a34a" : "#dc2626";
                  return <span style={{ color: col, fontWeight: 600 }}>{marginVal.toFixed(1)}%</span>;
                })()}</td>
                <td style={{ padding: "13px 16px", fontWeight: 700, fontSize: 18, color: p.stock === 0 ? "#ef4444" : p.stock <= p.minStock ? "#f97316" : "#1c1917" }}>{p.stock}</td>
                <td style={{ padding: "13px 16px", color: "#a8a29e", fontSize: 13 }}>{p.minStock}</td>
                <td style={{ padding: "13px 16px" }}>
                  {p.stock === 0 ? <span style={{ background: "#ef444420", color: "#dc2626", borderRadius: 6, padding: "3px 9px", fontSize: 12 }}>Tükendi</span>
                    : p.stock <= p.minStock ? <span style={{ background: "#f97316 20", color: "#fb923c", borderRadius: 6, padding: "3px 9px", fontSize: 12 }}>Kritik</span>
                    : <span style={{ background: "#16a34a20", color: "#16a34a", borderRadius: 6, padding: "3px 9px", fontSize: 12 }}>Normal</span>}
                </td>
                <td style={{ padding: "13px 16px" }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => openView(p)} style={{ background: "#f0eeed", border: "none", borderRadius: 7, padding: "6px 8px", color: "#78716c", cursor: "pointer" }}><Icon name="eye" size={14} /></button>
                    {canEdit && <>
                      <button onClick={() => openMove(p)} style={{ background: "rgba(59,130,246,0.15)", border: "none", borderRadius: 7, padding: "6px 8px", color: "#60a5fa", cursor: "pointer" }}><Icon name="movements" size={14} /></button>
                      <button onClick={() => openEdit(p)} style={{ background: "rgba(139,92,246,0.15)", border: "none", borderRadius: 7, padding: "6px 8px", color: "#78716c", cursor: "pointer" }}><Icon name="edit" size={14} /></button>
                      <button onClick={() => deleteProduct(p)} style={{ background: "#fef2f2", border: "none", borderRadius: 7, padding: "6px 8px", color: "#dc2626", cursor: "pointer" }}><Icon name="x" size={14} /></button>
                    </>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div style={{ textAlign: "center", padding: "48px 0", color: "#a8a29e" }}>Sonuç bulunamadı</div>}
      </div>

            {/* Confirm Delete Modal */}
      {confirmDelete && (
        <Modal title="Ürünleri Sil" onClose={() => setConfirmDelete(false)}
          footer={<>
            <button onClick={() => setConfirmDelete(false)} style={btnStyle("ghost")}>İptal</button>
            <button onClick={bulkDelete} style={{ ...btnStyle("primary"), background: "linear-gradient(135deg, #ef4444, #dc2626)" }}>Evet, Sil</button>
          </>}>
          <div style={{ textAlign: "center", padding: "8px 0" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🗑️</div>
            <p style={{ color: "#1c1917", fontSize: 15, margin: "0 0 8px" }}>
              <strong>{selectedIds.size} ürün</strong> silinecek.
            </p>
            <p style={{ color: "#a8a29e", fontSize: 13, margin: 0 }}>Bu işlem geri alınamaz. Stok hareketleri korunacak.</p>
          </div>
        </Modal>
      )}

      {/* Bulk Move Modal */}
      {modal === "bulkMove" && (
        <Modal title={`Toplu Stok İşlemi (${selectedIds.size} ürün)`} onClose={() => setModal(null)}
          footer={<><button onClick={() => setModal(null)} style={btnStyle("ghost")}>İptal</button><button onClick={bulkMove} style={btnStyle("primary")}>Uygula</button></>}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={{ color: "#78716c", fontSize: 12, display: "block", marginBottom: 8 }}>Hareket Türü</label>
              <div style={{ display: "flex", gap: 8 }}>
                {["Giriş", "Çıkış"].map(t => (
                  <button key={t} onClick={() => setBulkMoveForm(f => ({ ...f, type: t }))}
                    style={{ flex: 1, padding: "10px", borderRadius: 8, border: `1px solid ${bulkMoveForm.type === t ? (t === "Giriş" ? "#3b82f6" : "#ef4444") : "#e7e5e4"}`, background: bulkMoveForm.type === t ? (t === "Giriş" ? "rgba(59,130,246,0.15)" : "#fef2f2") : "transparent", color: bulkMoveForm.type === t ? (t === "Giriş" ? "#60a5fa" : "#dc2626") : "#a8a29e", cursor: "pointer", fontSize: 14, fontWeight: 500 }}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label style={{ color: "#78716c", fontSize: 12, display: "block", marginBottom: 5 }}>Miktar (tüm seçili ürünlere uygulanır)</label>
              <input type="number" min="1" value={bulkMoveForm.quantity} onChange={e => setBulkMoveForm(f => ({ ...f, quantity: e.target.value }))}
                style={{ width: "100%", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 8, padding: "10px 12px", color: "#1c1917", fontSize: 14, outline: "none" }} />
            </div>
            <div>
              <label style={{ color: "#78716c", fontSize: 12, display: "block", marginBottom: 5 }}>Not (opsiyonel)</label>
              <input value={bulkMoveForm.note} onChange={e => setBulkMoveForm(f => ({ ...f, note: e.target.value }))}
                placeholder="Toplu işlem notu..."
                style={{ width: "100%", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 8, padding: "10px 12px", color: "#1c1917", fontSize: 14, outline: "none" }} />
            </div>
            <div style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 8, padding: "10px 14px", color: "#60a5fa", fontSize: 13 }}>
              Seçilen {selectedIds.size} ürünün her birine {bulkMoveForm.quantity || "?"} adet {bulkMoveForm.type} uygulanacak.
            </div>
          </div>
        </Modal>
      )}

      {/* Add/Edit Modal */}
      {(modal === "add" || modal === "edit") && (
        <Modal title={modal === "add" ? "Yeni Ürün Ekle" : "Ürün Düzenle"} onClose={() => setModal(null)}
          footer={<><button onClick={() => setModal(null)} style={btnStyle("ghost")}>İptal</button><button onClick={saveProduct} style={btnStyle("primary")}>Kaydet</button></>}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Field label="Ürün Adı *" field="name" span />
            <Field label="SKU / Stok Kodu *" field="sku" />
            <Field label="Barkod (EAN)" field="barcode" />
            <Field label="Kategori" field="category" options={categories} />
            <Field label="Marka" field="brand" options={brands} />
            <Field label="Varyant (renk, ölçü vb.)" field="variant" />
            <Field label="Başlangıç Stoku" field="stock" type="number" />
            <Field label="Minimum Stok Seviyesi" field="minStock" type="number" />
            <Field label="Açıklama" field="description" span />
            <div style={{ gridColumn: "1/-1", borderTop: "1px solid #e7e5e4", paddingTop: 14, marginTop: 4 }}>
              <div style={{ color: "#a8a29e", fontSize: 11.5, marginTop: 4, fontWeight: 600, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>Fiyat Bilgileri</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ color: "#78716c", fontSize: 12, display: "block", marginBottom: 5 }}>Maliyet Fiyatı (KDV Hariç) ₺</label>
                  <input type="number" min="0" step="0.01" value={form.costPrice || ""} onChange={e => setForm(f => ({ ...f, costPrice: e.target.value }))}
                    style={{ width: "100%", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 8, padding: "9px 12px", color: "#1c1917", fontSize: 14, outline: "none" }} />
                </div>
                <div>
                  <label style={{ color: "#78716c", fontSize: 12, display: "block", marginBottom: 5 }}>Satış Fiyatı (KDV Dahil) ₺</label>
                  <input type="number" min="0" step="0.01" value={form.salePrice || ""} onChange={e => setForm(f => ({ ...f, salePrice: e.target.value }))}
                    style={{ width: "100%", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 8, padding: "9px 12px", color: "#1c1917", fontSize: 14, outline: "none" }} />
                </div>
                <div>
                  <label style={{ color: "#78716c", fontSize: 12, display: "block", marginBottom: 5 }}>KDV Oranı %</label>
                  <select value={form.vatRate || 20} onChange={e => setForm(f => ({ ...f, vatRate: Number(e.target.value) }))}
                    style={{ width: "100%", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 8, padding: "9px 12px", color: "#1c1917", fontSize: 14, outline: "none" }}>
                    <option value={1}>%1</option>
                    <option value={10}>%10</option>
                    <option value={20}>%20</option>
                  </select>
                </div>
              </div>
              {form.costPrice > 0 && form.salePrice > 0 && (() => {
                const vatRate = Number(form.vatRate) || 20;
                const saleExVat = Number(form.salePrice) / (1 + vatRate / 100);
                const profit = saleExVat - Number(form.costPrice);
                const margin = (profit / saleExVat * 100).toFixed(1);
                const color = profit >= 0 ? "#16a34a" : "#dc2626";
                return (
                  <div style={{ marginTop: 10, padding: "10px 14px", background: `${profit >= 0 ? "rgba(74,222,128,0.08)" : "rgba(248,113,113,0.08)"}`, borderRadius: 8, border: `1px solid ${profit >= 0 ? "rgba(74,222,128,0.2)" : "rgba(248,113,113,0.2)"}`, display: "flex", gap: 24 }}>
                    <span style={{ color: "#78716c", fontSize: 13 }}>KDV Hariç Satış: <strong style={{ color: "#1c1917" }}>₺{saleExVat.toFixed(2)}</strong></span>
                    <span style={{ color: "#78716c", fontSize: 13 }}>Kâr: <strong style={{ color }}>{profit >= 0 ? "+" : ""}₺{profit.toFixed(2)}</strong></span>
                    <span style={{ color: "#78716c", fontSize: 13 }}>Marj: <strong style={{ color }}>{margin}%</strong></span>
                  </div>
                );
              })()}
            </div>
          </div>
        </Modal>
      )}

      {/* View Modal */}
      {modal === "view" && selected && (
        <Modal title="Ürün Detayı" onClose={() => setModal(null)}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {[["Ürün Adı", selected.name], ["SKU", selected.sku], ["Barkod", selected.barcode], ["Kategori", selected.category], ["Marka", selected.brand], ["Varyant", selected.variant], ["Mevcut Stok", selected.stock], ["Min. Stok", selected.minStock], ["Açıklama", selected.description]].map(([k, v]) => (
              <div key={k} style={{ gridColumn: k === "Ürün Adı" || k === "Açıklama" ? "1/-1" : undefined }}>
                <div style={{ color: "#a8a29e", fontSize: 11.5, marginTop: 4, marginBottom: 3 }}>{k}</div>
                <div style={{ color: "#1c1917", fontWeight: 500 }}>{v || "-"}</div>
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
                  style={{ flex: 1, padding: "10px", borderRadius: 9, border: `1px solid ${moveForm.type === t ? "#3b82f6" : "#e7e5e4"}`, background: moveForm.type === t ? "rgba(59,130,246,0.15)" : "transparent", color: moveForm.type === t ? "#60a5fa" : "#a8a29e", cursor: "pointer", fontWeight: 500, fontSize: 14 }}>{t}</button>
              ))}
            </div>
            <div style={{ background: "rgba(0,0,0,0.02)", borderRadius: 10, padding: "12px 16px", display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#a8a29e", fontSize: 13 }}>Mevcut Stok</span>
              <span style={{ color: "#1c1917", fontWeight: 700, fontSize: 18 }}>{selected.stock}</span>
            </div>
            <div>
              <label style={{ color: "#78716c", fontSize: 12, display: "block", marginBottom: 5 }}>Miktar</label>
              <input type="number" min="1" value={moveForm.quantity} onChange={e => setMoveForm(m => ({ ...m, quantity: e.target.value }))}
                style={{ width: "100%", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 8, padding: "10px 12px", color: "#1c1917", fontSize: 15, outline: "none" }} />
            </div>
            <div>
              <label style={{ color: "#78716c", fontSize: 12, display: "block", marginBottom: 5 }}>Açıklama / Referans No</label>
              <input value={moveForm.note} onChange={e => setMoveForm(m => ({ ...m, note: e.target.value }))}
                style={{ width: "100%", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 8, padding: "10px 12px", color: "#1c1917", fontSize: 14, outline: "none" }} />
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
  const [showCamera, setShowCamera] = useState(false);

  const canEdit = user.role !== "viewer";

  const handleCameraDetect = (code) => {
    const product = products.find(p => p.barcode === code || p.sku === code);
    if (product) {
      setForm(f => ({ ...f, productId: product.id }));
      setShowCamera(false);
      setModal(true);
      notify(`✓ ${product.name} bulundu`);
    } else {
      notify(`Barkod bulunamadı: ${code}`, "error");
    }
  };

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

  const exportCSV = () => exportExcel(filtered.map(m => ({ Tarih: formatDate(m.createdAt), "Ürün Adı": m.productName, Tür: m.type, Miktar: m.quantity, "Önceki Stok": m.prevStock, "Sonraki Stok": m.nextStock, Kullanıcı: m.user, Not: m.note })), "hareketler.xlsx");

  const typeColor = (t) => t === "Giriş" ? "#22c55e" : t === "Çıkış" ? "#dc2626" : "#d97706";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 21, fontWeight: 700, margin: 0, letterSpacing: "-0.03em", color: "#18181b" }}>Stok Hareketleri</h1>
          <p style={{ color: "#a8a29e", margin: "4px 0 0", fontSize: 13 }}>{movements.length} hareket kaydı — geriye dönük silinemez</p>
        </div>
        {canEdit && (
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={exportCSV} className="btn-hover" style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 16px", background: "#fff", border: "1px solid #e7e5e4", borderRadius: 9, color: "#78716c", cursor: "pointer", fontSize: 13, fontWeight: 500 }}>
              <Icon name="download" size={14} /> Excel İndir
            </button>
            <button onClick={() => setShowCamera(true)} className="btn-hover"
              style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 16px", background: "#fff", border: "1px solid #e7e5e4", borderRadius: 9, color: "#44403c", cursor: "pointer", fontSize: 13, fontWeight: 500 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
              Kamera ile Tara
            </button>
            <button onClick={() => { setForm({ productId: "", type: "Giriş", quantity: "", note: "" }); setModal(true); }} className="btn-hover"
              style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 16px", background: "#18181b", border: "none", borderRadius: 9, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              <Icon name="plus" size={14} /> Yeni Hareket
            </button>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <div style={{ flex: 1, position: "relative" }}>
          <div style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#a8a29e" }}><Icon name="search" size={16} /></div>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Ürün adı veya açıklama ile ara..."
            style={{ width: "100%", background: "rgba(0,0,0,0.02)", border: "1px solid #e7e5e4", borderRadius: 10, padding: "10px 12px 10px 38px", color: "#1c1917", fontSize: 14, outline: "none" }} />
        </div>
        <select value={filterType} onChange={e => setFilterType(e.target.value)} style={selectStyle}>
          <option value="">Tüm Türler</option>
          <option>Giriş</option><option>Çıkış</option><option>Düzeltme</option><option>Sayım Farkı</option>
        </select>
        <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)} style={{ ...selectStyle, colorScheme: "dark" }} />
      </div>

      <div style={{ background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 14, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #e7e5e4" }}>
              {["Tarih & Saat", "Ürün", "Tür", "Miktar", "Önceki", "Sonraki", "Kullanıcı", "Açıklama"].map(h => (
                <th key={h} style={{ padding: "12px 14px", textAlign: "left", color: "#a8a29e", fontSize: 11.5, marginTop: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(m => (
              <tr key={m.id} className="table-row" style={{ borderBottom: "1px solid rgba(255,255,255,0.03)", transition: "background 0.1s" }}>
                <td style={{ padding: "11px 14px", color: "#a8a29e", fontSize: 11.5, marginTop: 4, fontFamily: "'Space Mono', monospace", whiteSpace: "nowrap" }}>{formatDate(m.createdAt)}</td>
                <td style={{ padding: "11px 14px", color: "#1c1917", fontSize: 13, fontWeight: 500 }}>{m.productName}</td>
                <td style={{ padding: "11px 14px" }}>
                  <span style={{ background: `${typeColor(m.type)}18`, color: typeColor(m.type), borderRadius: 6, padding: "3px 9px", fontSize: 12, fontWeight: 500 }}>{m.type}</span>
                </td>
                <td style={{ padding: "11px 14px", fontWeight: 700, color: m.type === "Giriş" ? "#22c55e" : "#dc2626", fontSize: 15 }}>
                  {m.type === "Giriş" ? "+" : "-"}{m.quantity}
                </td>
                <td style={{ padding: "11px 14px", color: "#a8a29e", fontSize: 13 }}>{m.prevStock}</td>
                <td style={{ padding: "11px 14px", color: "#78716c", fontSize: 13, fontWeight: 600 }}>{m.nextStock}</td>
                <td style={{ padding: "11px 14px", color: "#a8a29e", fontSize: 11.5, marginTop: 4 }}>{m.user}</td>
                <td style={{ padding: "11px 14px", color: "#a8a29e", fontSize: 11.5, marginTop: 4, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.note || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div style={{ textAlign: "center", padding: "48px 0", color: "#a8a29e" }}>Sonuç bulunamadı</div>}
      </div>

      {showCamera && <CameraScanner onDetected={handleCameraDetect} onClose={() => setShowCamera(false)} />}

      {modal && (
        <Modal title="Yeni Stok Hareketi" onClose={() => setModal(false)}
          footer={<><button onClick={() => setModal(false)} style={btnStyle("ghost")}>İptal</button><button onClick={saveMove} style={btnStyle("primary")}>Kaydet</button></>}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={{ color: "#78716c", fontSize: 12, display: "block", marginBottom: 5 }}>Ürün *</label>
              <select value={form.productId} onChange={e => setForm(f => ({ ...f, productId: e.target.value }))} style={{ width: "100%", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 8, padding: "9px 12px", color: "#1c1917", fontSize: 14, outline: "none" }}>
                <option value="">Ürün seçin...</option>
                {products.map(p => <option key={p.id} value={p.id}>{p.name} (Stok: {p.stock})</option>)}
              </select>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              {["Giriş", "Çıkış", "Düzeltme"].map(t => (
                <button key={t} onClick={() => setForm(f => ({ ...f, type: t }))}
                  style={{ flex: 1, padding: "10px", borderRadius: 9, border: `1px solid ${form.type === t ? "#3b82f6" : "#e7e5e4"}`, background: form.type === t ? "rgba(59,130,246,0.15)" : "transparent", color: form.type === t ? "#60a5fa" : "#a8a29e", cursor: "pointer", fontWeight: 500, fontSize: 14 }}>{t}</button>
              ))}
            </div>
            <div>
              <label style={{ color: "#78716c", fontSize: 12, display: "block", marginBottom: 5 }}>Miktar *</label>
              <input type="number" min="1" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} style={{ width: "100%", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 8, padding: "9px 12px", color: "#1c1917", fontSize: 14, outline: "none" }} />
            </div>
            <div>
              <label style={{ color: "#78716c", fontSize: 12, display: "block", marginBottom: 5 }}>Açıklama / Referans No</label>
              <input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} style={{ width: "100%", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 8, padding: "9px 12px", color: "#1c1917", fontSize: 14, outline: "none" }} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── COUNTING PAGE ────────────────────────────────────────────────────────────


function CountingPage({ products, setProducts, movements, setMovements, user, notify, categories, brands }) {
  const [phase, setPhase] = useState("setup"); // setup | counting | results
  const [filter, setFilter] = useState({ category: "", brand: "" });
  const [countList, setCountList] = useState({}); // { productId: count }
  const [barcodeInput, setBarcodeInput] = useState("");
  const [countName, setCountName] = useState(`Sayım ${new Date().toLocaleDateString("tr-TR")}`);
  const [showCamera, setShowCamera] = useState(false);
  const [lastScanned, setLastScanned] = useState([]); // [{id, name, sku, barcode, stock, counted, time}]
  const [countSearch, setCountSearch] = useState("");
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
        setCountList(prev => {
          const newCount = (prev[product.id] || 0) + 1;
          setLastScanned(ls => [{
            id: product.id, name: product.name, sku: product.sku,
            barcode: product.barcode, stock: product.stock,
            counted: newCount, time: new Date()
          }, ...ls.slice(0, 19)]);
          return { ...prev, [product.id]: newCount };
        });
        setBarcodeInput("");
      } else {
        notify("Ürün bu sayım listesinde değil veya bulunamadı", "error");
        setBarcodeInput("");
      }
    }
  };

  const handleCameraDetect = (code) => {
    const product = products.find(p => p.barcode === code || p.sku === code);
    if (product && countList.hasOwnProperty(product.id)) {
      setCountList(prev => {
        const newCount = (prev[product.id] || 0) + 1;
        setLastScanned(ls => [{
          id: product.id, name: product.name, sku: product.sku,
          barcode: product.barcode, stock: product.stock,
          counted: newCount, time: new Date()
        }, ...ls.slice(0, 19)]);
        return { ...prev, [product.id]: newCount };
      });
    } else if (product) {
      notify("Bu ürün sayım listesinde değil", "error");
    } else {
      notify(`Barkod bulunamadı: ${code}`, "error");
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
      <p style={{ color: "#a8a29e", margin: "0 0 28px", fontSize: 13 }}>Barkod okuyucu veya manuel giriş ile fiziksel sayım yapın</p>

      <div style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: 14, padding: 28, maxWidth: 600 }}>
        <h3 style={{ margin: "0 0 20px", fontSize: 16 }}>Sayım Ayarları</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ color: "#78716c", fontSize: 12, display: "block", marginBottom: 5 }}>Sayım Adı</label>
            <input value={countName} onChange={e => setCountName(e.target.value)} style={{ width: "100%", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 8, padding: "9px 12px", color: "#1c1917", fontSize: 14, outline: "none" }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ color: "#78716c", fontSize: 12, display: "block", marginBottom: 5 }}>Kategori Filtresi</label>
              <select value={filter.category} onChange={e => setFilter(f => ({ ...f, category: e.target.value }))} style={{ width: "100%", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 8, padding: "9px 12px", color: "#1c1917", fontSize: 14, outline: "none" }}>
                <option value="">Tümü</option>
                {categories.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={{ color: "#78716c", fontSize: 12, display: "block", marginBottom: 5 }}>Marka Filtresi</label>
              <select value={filter.brand} onChange={e => setFilter(f => ({ ...f, brand: e.target.value }))} style={{ width: "100%", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 8, padding: "9px 12px", color: "#1c1917", fontSize: 14, outline: "none" }}>
                <option value="">Tümü</option>
                {brands.map(b => <option key={b}>{b}</option>)}
              </select>
            </div>
          </div>
          <div style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 10, padding: "12px 16px" }}>
            <span style={{ color: "#60a5fa", fontSize: 13 }}>Seçilen kriterlerde <strong>{filteredProducts.length}</strong> ürün sayılacak</span>
          </div>
          {canEdit && (
            <button onClick={startCounting} className="btn-hover" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "13px", background: "#18181b", border: "none", borderRadius: 10, color: "#fff", cursor: "pointer", fontSize: 15, fontWeight: 600, transition: "all 0.15s" }}>
              <Icon name="scan" size={18} /> Sayımı Başlat
            </button>
          )}
        </div>
      </div>
    </div>
  );

  if (phase === "counting") {
    const visibleProducts = filteredProducts.filter(p =>
      !countSearch || p.name.toLowerCase().includes(countSearch.toLowerCase()) ||
      p.barcode?.includes(countSearch) || p.sku?.toLowerCase().includes(countSearch.toLowerCase())
    );
    const countedCount = Object.values(countList).filter(v => v > 0).length;
    const totalCount = Object.values(countList).reduce((s, v) => s + v, 0);

    return (
    <div>
      {showCamera && <CameraScanner onDetected={handleCameraDetect} onClose={() => setShowCamera(false)} />}

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 21, fontWeight: 700, margin: 0, letterSpacing: "-0.03em", color: "#18181b" }}>{countName}</h1>
          <p style={{ color: "#a8a29e", margin: "4px 0 0", fontSize: 13 }}>{filteredProducts.length} ürün • {countedCount} sayıldı</p>
        </div>
        <button onClick={() => setPhase("results")}
          style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 18px", background: "#18181b", border: "none", borderRadius: 9, color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
          Sayımı Tamamla →
        </button>
      </div>

      {/* 2 col layout: main + sidebar */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 14, alignItems: "start" }}>

        {/* LEFT: ürün listesi */}
        <div>
          {/* Barkod input bar */}
          <div style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: 11, padding: "10px 12px", marginBottom: 12, display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: "#f0fdf4", border: "1px solid #bbf7d0", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Icon name="scan" size={15} color="#16a34a" />
            </div>
            <input ref={barcodeRef} value={barcodeInput} onChange={e => setBarcodeInput(e.target.value)} onKeyDown={handleBarcode}
              placeholder="Barkod veya SKU — Enter'a basın..."
              style={{ flex: 1, background: "transparent", border: "none", color: "#1c1917", fontSize: 13.5, outline: "none", fontFamily: "inherit" }} />
            <button onClick={() => setShowCamera(true)}
              style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6, padding: "7px 13px", background: "#18181b", border: "none", borderRadius: 8, color: "#fff", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
              Kamera
            </button>
          </div>

          {/* Ürün arama */}
          <div style={{ position: "relative", marginBottom: 10 }}>
            <svg style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "#a8a29e" }} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input value={countSearch} onChange={e => setCountSearch(e.target.value)}
              placeholder="Ürün ara..."
              style={{ width: "100%", background: "#fff", border: "1px solid #e7e5e4", borderRadius: 9, padding: "8px 12px 8px 32px", color: "#1c1917", fontSize: 13, outline: "none", fontFamily: "inherit" }} />
          </div>

          {/* Tablo */}
          <div style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: 11, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#fafaf9", borderBottom: "1px solid #f0eeed" }}>
                  {["Ürün", "Sayım Başlatıldığında...", "Sayılan Stok", ""].map(h => (
                    <th key={h} style={{ padding: "9px 14px", textAlign: "left", color: "#a8a29e", fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleProducts.map(p => {
                  const cnt = countList[p.id] || 0;
                  const isScanned = cnt > 0;
                  return (
                    <tr key={p.id} style={{ borderBottom: "1px solid #f5f5f4", background: isScanned ? "#f0fdf4" : "#fff", transition: "background 0.2s" }}>
                      <td style={{ padding: "11px 14px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ width: 32, height: 32, borderRadius: 7, background: isScanned ? "#dcfce7" : "#f5f5f4", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            {isScanned
                              ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                              : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a8a29e" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
                            }
                          </div>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 500, color: "#1c1917" }}>{p.name}</div>
                            <div style={{ fontSize: 11, color: "#a8a29e", marginTop: 1 }}>{p.barcode && <span style={{ fontFamily: "monospace" }}>{p.barcode}</span>}{p.barcode && p.sku ? "/" : ""}{p.sku}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: "11px 14px", color: "#78716c", fontSize: 15, fontWeight: 600 }}>{p.stock}</td>
                      <td style={{ padding: "11px 14px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <button onClick={() => adjustCount(p.id, -1)} style={{ width: 26, height: 26, background: cnt > 0 ? "#fecaca" : "#f5f5f4", border: "none", borderRadius: 6, color: cnt > 0 ? "#dc2626" : "#a8a29e", cursor: "pointer", fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>−</button>
                          <input type="number" value={cnt} onChange={e => setCount(p.id, e.target.value)}
                            style={{ width: 58, background: "#fafaf9", border: `1px solid ${isScanned ? "#bbf7d0" : "#e7e5e4"}`, borderRadius: 7, padding: "4px 6px", color: isScanned ? "#16a34a" : "#78716c", fontSize: 15, fontWeight: 700, outline: "none", textAlign: "center", fontFamily: "inherit" }} />
                          <button onClick={() => adjustCount(p.id, 1)} style={{ width: 26, height: 26, background: "#f0fdf4", border: "none", borderRadius: 6, color: "#16a34a", cursor: "pointer", fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>+</button>
                        </div>
                      </td>
                      <td style={{ padding: "11px 14px" }}>
                        {isScanned && <span style={{ background: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0", borderRadius: 99, padding: "2px 8px", fontSize: 11, fontWeight: 500 }}>✓ Sayıldı</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ padding: "10px 14px", borderTop: "1px solid #f0eeed", color: "#a8a29e", fontSize: 12 }}>
              {visibleProducts.length} ürün gösteriliyor
            </div>
          </div>
        </div>

        {/* RIGHT: Son Aksiyonlar */}
        <div style={{ position: "sticky", top: 20 }}>
          {/* Özet */}
          <div style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: 11, padding: "14px 16px", marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#a8a29e", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>Sayım Özeti</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 13, color: "#78716c" }}>Sayılan Ürün</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: "#18181b" }}>{countedCount} / {filteredProducts.length}</span>
            </div>
            <div style={{ height: 6, background: "#f5f5f4", borderRadius: 99, overflow: "hidden", marginBottom: 10 }}>
              <div style={{ height: "100%", background: "#18181b", borderRadius: 99, width: `${filteredProducts.length > 0 ? (countedCount / filteredProducts.length * 100) : 0}%`, transition: "width 0.3s ease" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, color: "#78716c" }}>Toplam Adet</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: "#16a34a" }}>{totalCount}</span>
            </div>
          </div>

          {/* Son Aksiyonlar */}
          <div style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: 11, overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #f0eeed" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#18181b" }}>Son Aksiyonlar</div>
              <div style={{ fontSize: 11.5, color: "#a8a29e", marginTop: 2 }}>
                Sayılan Ürün Sayısı / Stok: <strong style={{ color: "#1c1917" }}>{countedCount} ürün {totalCount} stok</strong>
              </div>
            </div>
            {lastScanned.length === 0 ? (
              <div style={{ padding: "24px 16px", textAlign: "center" }}>
                <div style={{ fontSize: 22, marginBottom: 6 }}>📦</div>
                <div style={{ fontSize: 12.5, color: "#a8a29e" }}>Henüz ürün taranmadı</div>
                <div style={{ fontSize: 11.5, color: "#d6d3d1", marginTop: 4 }}>Barkod okuyun veya kamera ile tarayın</div>
              </div>
            ) : (
              <div>
                {lastScanned.map((item, idx) => (
                  <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderBottom: "1px solid #f5f5f4", background: idx === 0 ? "#f0fdf4" : "#fff", transition: "background 0.3s" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 500, color: "#1c1917", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.name}</div>
                      <div style={{ fontSize: 10.5, color: "#a8a29e", marginTop: 1, fontFamily: "monospace" }}>
                        {item.barcode || item.sku}
                      </div>
                      <div style={{ fontSize: 10.5, color: "#a8a29e", marginTop: 1 }}>
                        {item.time.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 10 }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: "#16a34a" }}>{item.counted}</div>
                      <div style={{ fontSize: 10, color: "#a8a29e" }}>/ {item.stock} stok</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );}

  // Results phase
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Sayım Sonuçları — {countName}</h1>
          <p style={{ color: "#a8a29e", margin: "4px 0 0", fontSize: 13 }}>
            {diffs.filter(d => d.diff !== 0).length} üründe fark tespit edildi
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => setPhase("counting")} style={btnStyle("ghost")}>← Geri Dön</button>
          <button onClick={exportDiffs} className="btn-hover" style={{ ...btnStyle("ghost"), display: "flex", alignItems: "center", gap: 6 }}><Icon name="download" size={14} /> Excel İndir</button>
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
          <div key={s.label} style={{ background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 12, padding: "16px 20px", textAlign: "center" }}>
            <div style={{ fontSize: 30, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ color: "#a8a29e", fontSize: 11.5, marginTop: 4, marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 14, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #e7e5e4" }}>
              {["Ürün", "Sistem Stoğu", "Sayılan", "Fark", "Durum"].map(h => (
                <th key={h} style={{ padding: "12px 14px", textAlign: "left", color: "#a8a29e", fontSize: 11.5, marginTop: 4, fontWeight: 600, textTransform: "uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {diffs.map(d => (
              <tr key={d.id} className="table-row" style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                <td style={{ padding: "11px 14px" }}>
                  <div style={{ color: "#1c1917", fontWeight: 500, fontSize: 13 }}>{d.name}</div>
                  <div style={{ color: "#a8a29e", fontSize: 11 }}>{d.sku}</div>
                </td>
                <td style={{ padding: "11px 14px", color: "#78716c", fontSize: 15, fontWeight: 600 }}>{d.stock}</td>
                <td style={{ padding: "11px 14px", color: "#1c1917", fontSize: 15, fontWeight: 600 }}>{d.counted}</td>
                <td style={{ padding: "11px 14px", fontWeight: 700, fontSize: 16, color: d.diff > 0 ? "#3b82f6" : d.diff < 0 ? "#ef4444" : "#22c55e" }}>
                  {d.diff > 0 ? `+${d.diff}` : d.diff}
                </td>
                <td style={{ padding: "11px 14px" }}>
                  {d.diff === 0 ? <span style={{ background: "#16a34a20", color: "#16a34a", borderRadius: 6, padding: "3px 9px", fontSize: 12 }}>Eşleşti</span>
                    : d.diff > 0 ? <span style={{ background: "#3b82f620", color: "#60a5fa", borderRadius: 6, padding: "3px 9px", fontSize: 12 }}>Fazla</span>
                    : <span style={{ background: "#ef444420", color: "#dc2626", borderRadius: 6, padding: "3px 9px", fontSize: 12 }}>Eksik</span>}
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

  // Kâr analizi hesaplamaları
  const productsWithPrice = products.filter(p => p.costPrice > 0 && p.salePrice > 0);
  const profitData = productsWithPrice.map(p => {
    const vatRate = (Number(p.vatRate) > 0 && Number(p.vatRate) <= 100) ? Number(p.vatRate) : 20;
    const saleExVat = p.salePrice / (1 + vatRate / 100);
    const profitPerUnit = saleExVat - p.costPrice;
    const margin = saleExVat > 0 ? (profitPerUnit / saleExVat * 100) : 0;
    const totalProfit = p.stock * profitPerUnit;
    const stockValue = p.stock * p.costPrice;
    return { ...p, saleExVat, profitPerUnit, margin, totalProfit, stockValue };
  }).sort((a, b) => b.margin - a.margin);

  const topProfitable = [...profitData].sort((a, b) => b.margin - a.margin).slice(0, 10);
  const topByTotalProfit = [...profitData].sort((a, b) => b.totalProfit - a.totalProfit).slice(0, 10);
  const totalStockVal = products.reduce((s, p) => s + p.stock * (p.costPrice || 0), 0);
  const totalSaleVal = products.reduce((s, p) => s + p.stock * (p.salePrice || 0), 0);
  const totalPotProfit = profitData.reduce((s, p) => s + p.totalProfit, 0);

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

  const exportStockSummary = () => exportExcel(products.map(p => { const saleExVat = p.salePrice ? (p.salePrice / (1 + (p.vatRate || 20) / 100)) : 0; const profit = saleExVat && p.costPrice ? saleExVat - p.costPrice : null; return { "Ürün Adı": p.name, SKU: p.sku, Kategori: p.category, Marka: p.brand, "Mevcut Stok": p.stock, "Min Stok": p.minStock, Durum: p.stock <= p.minStock ? "KRİTİK" : "Normal", "Maliyet (₺)": p.costPrice || "", "Satış KDV Dahil (₺)": p.salePrice || "", "KDV %": p.vatRate || "", "Kâr Marjı": profit !== null && saleExVat > 0 ? (profit / saleExVat * 100).toFixed(1) + "%" : "", "Stok Değeri (₺)": p.costPrice ? (p.stock * p.costPrice).toFixed(2) : "" }; }), "stok-ozet.xlsx");
  const exportMovements = () => exportExcel(filtered.map(m => ({ Tarih: formatDate(m.createdAt), "Ürün Adı": m.productName, "Tür": m.type, "Miktar": m.quantity, "Önceki Stok": m.prevStock, "Sonraki Stok": m.nextStock, Kullanıcı: m.user, Not: m.note })), "hareket-raporu.xlsx");
  const exportCritical = () => exportExcel(criticalProducts.map(p => ({ "Ürün Adı": p.name, SKU: p.sku, Kategori: p.category, Marka: p.brand, "Mevcut Stok": p.stock, "Min Stok": p.minStock, Fark: p.stock - p.minStock, Durum: p.stock === 0 ? "Tükendi" : "Kritik" })), "kritik-stok.xlsx");

  const reports = [
    { id: "stock-summary", label: "Stok Özeti", icon: "products" },
    { id: "movements", label: "Hareket Raporu", icon: "movements" },
    { id: "critical", label: "Kritik Stok", icon: "warning" },
    { id: "kar-analizi", label: "Kâr Analizi", icon: "reports" },
    { id: "activity", label: "Ürün Aktivitesi", icon: "trending_up" },
  ];

  const maxBar = Math.max(...topProducts.map(p => p.in + p.out), 1);

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Raporlama</h1>
        <p style={{ color: "#a8a29e", margin: "4px 0 0", fontSize: 13 }}>Tüm raporlar CSV olarak indirilebilir</p>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        {reports.map(r => (
          <button key={r.id} onClick={() => setActiveReport(r.id)}
            style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 16px", borderRadius: 9, border: `1px solid ${activeReport === r.id ? "#3b82f6" : "#e7e5e4"}`, background: activeReport === r.id ? "rgba(59,130,246,0.15)" : "#fafaf9", color: activeReport === r.id ? "#60a5fa" : "#a8a29e", cursor: "pointer", fontSize: 13, fontWeight: activeReport === r.id ? 600 : 400 }}>
            <Icon name={r.icon} size={14} />{r.label}
          </button>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ ...selectStyle, colorScheme: "dark", fontSize: 13 }} />
          <span style={{ color: "#a8a29e" }}>—</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ ...selectStyle, colorScheme: "dark", fontSize: 13 }} />
        </div>
      </div>

      {activeReport === "stock-summary" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>Güncel Stok Durumu ({products.length} ürün)</h3>
            <button onClick={exportStockSummary} className="btn-hover" style={{ display: "flex", alignItems: "center", gap: 6, ...btnStyle("ghost"), padding: "8px 14px" }}><Icon name="download" size={14} /> Excel İndir</button>
          </div>
          <div style={{ background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 14, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ borderBottom: "1px solid #e7e5e4" }}>
                {["Ürün", "SKU", "Kategori", "Mevcut Stok", "Min Stok", "Durum"].map(h => <th key={h} style={{ padding: "11px 14px", textAlign: "left", color: "#a8a29e", fontSize: 11.5, marginTop: 4, fontWeight: 600, textTransform: "uppercase" }}>{h}</th>)}
              </tr></thead>
              <tbody>{products.map(p => (
                <tr key={p.id} className="table-row" style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                  <td style={{ padding: "10px 14px", color: "#1c1917", fontSize: 13 }}>{p.name}</td>
                  <td style={{ padding: "10px 14px", color: "#a8a29e", fontSize: 11.5, marginTop: 4, fontFamily: "'Space Mono', monospace" }}>{p.sku}</td>
                  <td style={{ padding: "10px 14px" }}><span style={{ background: "rgba(59,130,246,0.1)", color: "#60a5fa", borderRadius: 6, padding: "2px 8px", fontSize: 12 }}>{p.category}</span></td>
                  <td style={{ padding: "10px 14px", fontWeight: 700, color: p.stock === 0 ? "#ef4444" : p.stock <= p.minStock ? "#f97316" : "#1c1917", fontSize: 16 }}>{p.stock}</td>
                  <td style={{ padding: "10px 14px", color: "#a8a29e" }}>{p.minStock}</td>
                  <td style={{ padding: "10px 14px" }}>
                    {p.stock === 0 ? <span style={{ background: "#ef444420", color: "#dc2626", borderRadius: 6, padding: "2px 8px", fontSize: 12 }}>Tükendi</span>
                      : p.stock <= p.minStock ? <span style={{ background: "#f9730620", color: "#fb923c", borderRadius: 6, padding: "2px 8px", fontSize: 12 }}>Kritik</span>
                      : <span style={{ background: "#16a34a20", color: "#16a34a", borderRadius: 6, padding: "2px 8px", fontSize: 12 }}>Normal</span>}
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
            <button onClick={exportMovements} className="btn-hover" style={{ display: "flex", alignItems: "center", gap: 6, ...btnStyle("ghost"), padding: "8px 14px" }}><Icon name="download" size={14} /> Excel İndir</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
            {Object.entries(byType).map(([type, total]) => (
              <div key={type} style={{ background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 12, padding: "14px 16px", textAlign: "center" }}>
                <div style={{ fontSize: 24, fontWeight: 700 }}>{total}</div>
                <div style={{ color: "#a8a29e", fontSize: 11.5, marginTop: 4, marginTop: 2 }}>{type}</div>
              </div>
            ))}
          </div>
          <div style={{ background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 14, overflow: "hidden", maxHeight: 400, overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ borderBottom: "1px solid #e7e5e4" }}>
                {["Tarih", "Ürün", "Tür", "Miktar", "Kullanıcı", "Açıklama"].map(h => <th key={h} style={{ padding: "11px 14px", textAlign: "left", color: "#a8a29e", fontSize: 11.5, marginTop: 4, fontWeight: 600, textTransform: "uppercase", position: "sticky", top: 0, background: "#fafaf9" }}>{h}</th>)}
              </tr></thead>
              <tbody>{filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(m => (
                <tr key={m.id} className="table-row" style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                  <td style={{ padding: "10px 14px", color: "#a8a29e", fontSize: 11.5, marginTop: 4 }}>{formatDate(m.createdAt)}</td>
                  <td style={{ padding: "10px 14px", color: "#1c1917", fontSize: 13 }}>{m.productName}</td>
                  <td style={{ padding: "10px 14px" }}><span style={{ background: (m.type === "Giriş" ? "#22c55e" : "#dc2626") + "20", color: m.type === "Giriş" ? "#22c55e" : "#dc2626", borderRadius: 6, padding: "2px 8px", fontSize: 12 }}>{m.type}</span></td>
                  <td style={{ padding: "10px 14px", fontWeight: 600 }}>{m.quantity}</td>
                  <td style={{ padding: "10px 14px", color: "#a8a29e", fontSize: 11.5, marginTop: 4 }}>{m.user}</td>
                  <td style={{ padding: "10px 14px", color: "#a8a29e", fontSize: 11.5, marginTop: 4 }}>{m.note}</td>
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
            <button onClick={exportCritical} className="btn-hover" style={{ display: "flex", alignItems: "center", gap: 6, ...btnStyle("ghost"), padding: "8px 14px" }}><Icon name="download" size={14} /> Excel İndir</button>
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
            <div style={{ textAlign: "center", padding: "60px 0", color: "#a8a29e" }}>Bu dönemde hareket yok</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {topProducts.map(p => {
                const total = p.in + p.out;
                return (
                  <div key={p.name} style={{ background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 12, padding: "14px 18px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                      <span style={{ fontWeight: 500, color: "#1c1917", fontSize: 13 }}>{p.name}</span>
                      <div style={{ display: "flex", gap: 12 }}>
                        <span style={{ color: "#22c55e", fontSize: 12 }}>+{p.in} Giriş</span>
                        <span style={{ color: "#dc2626", fontSize: 12 }}>-{p.out} Çıkış</span>
                      </div>
                    </div>
                    <div style={{ height: 6, background: "rgba(0,0,0,0.03)", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ height: "100%", background: "#18181b", borderRadius: 3, width: `${(total / maxBar) * 100}%`, transition: "width 0.4s" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeReport === "kar-analizi" && (() => {
        const exportProfit = () => exportExcel(profitData.map(p => ({
          "Ürün Adı": p.name, SKU: p.sku, Kategori: p.category, Marka: p.brand,
          "Mevcut Stok": p.stock, "Maliyet (₺)": Number(p.costPrice).toFixed(2),
          "Satış KDV Dahil (₺)": Number(p.salePrice).toFixed(2),
          "KDV %": p.vatRate || 20,
          "Satış KDV Hariç (₺)": p.saleExVat.toFixed(2),
          "Kâr/Adet (₺)": p.profitPerUnit.toFixed(2),
          "Kâr Marjı %": p.margin.toFixed(1),
          "Toplam Kâr Pot. (₺)": p.totalProfit.toFixed(2),
          "Stok Değeri (₺)": p.stockValue.toFixed(2),
        })), "kar-analizi.xlsx");
        return (
        <div>
          {productsWithPrice.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: "#a8a29e" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>💰</div>
              <div>Kâr analizi için ürünlere maliyet ve satış fiyatı girin</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {/* Summary cards */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
                <div style={{ background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 14, padding: "18px 22px" }}>
                  <div style={{ color: "#a8a29e", fontSize: 11.5, marginTop: 4, fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>Stok Maliyet Değeri</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "#1c1917" }}>₺{totalStockVal.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                </div>
                <div style={{ background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 14, padding: "18px 22px" }}>
                  <div style={{ color: "#a8a29e", fontSize: 11.5, marginTop: 4, fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>Potansiyel Satış (KDV Dahil)</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "#60a5fa" }}>₺{totalSaleVal.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                </div>
                <div style={{ background: "#fafaf9", border: `1px solid ${totalPotProfit >= 0 ? "rgba(74,222,128,0.2)" : "rgba(248,113,113,0.2)"}`, borderRadius: 14, padding: "18px 22px" }}>
                  <div style={{ color: "#a8a29e", fontSize: 11.5, marginTop: 4, fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>Potansiyel Kâr (KDV Hariç)</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: totalPotProfit >= 0 ? "#16a34a" : "#dc2626" }}>₺{totalPotProfit.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                </div>
              </div>

              {/* En kârlı ürünler (marj) */}
              <div style={{ background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 14, padding: 20 }}>
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                  <button onClick={exportProfit} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#f0eeed", border: "1px solid #e7e5e4", borderRadius: 8, color: "#78716c", cursor: "pointer", fontSize: 13 }}><Icon name="download" size={13} /> Excel İndir</button>
                </div>
                <h3 style={{ margin: "0 0 16px", fontSize: 15, color: "#1c1917" }}>En Yüksek Kâr Marjı</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {topProfitable.map((p, i) => (
                    <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 14px", background: "#fafaf9", borderRadius: 10 }}>
                      <div style={{ width: 24, height: 24, borderRadius: 6, background: i < 3 ? "linear-gradient(135deg,#f59e0b,#d97706)" : "#f0eeed", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: i < 3 ? "#fff" : "#a8a29e", flexShrink: 0 }}>{i + 1}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: "#1c1917", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                        <div style={{ fontSize: 11, color: "#a8a29e" }}>Maliyet: ₺{Number(p.costPrice).toFixed(2)} → KDV Hariç Satış: ₺{p.saleExVat.toFixed(2)}</div>
                      </div>
                      <div style={{ width: 120, height: 6, background: "rgba(0,0,0,0.03)", borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ height: "100%", background: p.margin >= 0 ? "linear-gradient(90deg,#22c55e,#4ade80)" : "linear-gradient(90deg,#ef4444,#f87171)", borderRadius: 3, width: `${Math.min(Math.abs(p.margin), 100)}%` }} />
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: p.margin >= 0 ? "#16a34a" : "#dc2626", width: 55, textAlign: "right" }}>{p.margin.toFixed(1)}%</div>
                      <div style={{ fontSize: 12, color: "#a8a29e", width: 90, textAlign: "right" }}>Stok: {p.stock} adet</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* En yüksek toplam kâr */}
              <div style={{ background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 14, padding: 20 }}>
                <h3 style={{ margin: "0 0 16px", fontSize: 15, color: "#1c1917" }}>En Yüksek Toplam Kâr Potansiyeli</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {topByTotalProfit.map((p, i) => {
                    const maxProfit = topByTotalProfit[0].totalProfit;
                    return (
                      <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 14px", background: "#fafaf9", borderRadius: 10 }}>
                        <div style={{ width: 24, height: 24, borderRadius: 6, background: i < 3 ? "linear-gradient(135deg,#3b82f6,#8b5cf6)" : "#f0eeed", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: i < 3 ? "#fff" : "#a8a29e", flexShrink: 0 }}>{i + 1}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, color: "#1c1917", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                          <div style={{ fontSize: 11, color: "#a8a29e" }}>{p.stock} adet × ₺{p.profitPerUnit.toFixed(2)} kâr/adet</div>
                        </div>
                        <div style={{ width: 120, height: 6, background: "rgba(0,0,0,0.03)", borderRadius: 3, overflow: "hidden" }}>
                          <div style={{ height: "100%", background: "linear-gradient(90deg,#3b82f6,#8b5cf6)", borderRadius: 3, width: `${maxProfit > 0 ? (p.totalProfit / maxProfit * 100) : 0}%` }} />
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: p.totalProfit >= 0 ? "#16a34a" : "#dc2626", width: 110, textAlign: "right" }}>₺{p.totalProfit.toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
        );
      })()}
    </div>
  );
}

// ─── LIST MANAGER ─────────────────────────────────────────────────────────────
function ListManager({ title, items, onSave, color }) {
  const [list, setList] = useState([...items]);
  const [newItem, setNewItem] = useState("");

  const add = () => {
    const v = newItem.trim();
    if (!v) return;
    if (list.includes(v)) return;
    const updated = [...list, v];
    setList(updated);
    onSave(updated);
    setNewItem("");
  };

  const remove = (item) => {
    const updated = list.filter(i => i !== item);
    setList(updated);
    onSave(updated);
  };

  return (
    <div style={{ background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 14, padding: 20 }}>
      <h3 style={{ margin: "0 0 16px", fontSize: 15, color: "#1c1917" }}>{title}</h3>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <input value={newItem} onChange={e => setNewItem(e.target.value)} onKeyDown={e => e.key === "Enter" && add()}
          placeholder={`Yeni ${title.slice(0, -2).toLowerCase()} ekle...`}
          style={{ flex: 1, background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 8, padding: "8px 12px", color: "#1c1917", fontSize: 13, outline: "none" }} />
        <button onClick={add} style={{ background: `${color}20`, border: `1px solid ${color}40`, borderRadius: 8, padding: "8px 12px", color: color, cursor: "pointer", fontWeight: 600, fontSize: 18 }}>+</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 280, overflowY: "auto" }}>
        {list.map(item => (
          <div key={item} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fafaf9", borderRadius: 8, padding: "7px 12px" }}>
            <span style={{ color: "#1c1917", fontSize: 13 }}>{item}</span>
            <button onClick={() => remove(item)} style={{ background: "#fef2f2", border: "none", borderRadius: 6, padding: "3px 7px", color: "#dc2626", cursor: "pointer", fontSize: 13 }}>✕</button>
          </div>
        ))}
        {list.length === 0 && <div style={{ color: "#a8a29e", fontSize: 13, textAlign: "center", padding: "20px 0" }}>Henüz kayıt yok</div>}
      </div>
    </div>
  );
}


// ─── PURCHASING PAGE ──────────────────────────────────────────────────────────
function PurchasingPage({ suppliers, setSuppliers, purchaseOrders, setPurchaseOrders, products, setProducts, setMovements, user, notify }) {
  const [tab, setTab] = useState("orders");
  const [modal, setModal] = useState(null); // "supplier" | "order" | "order-detail"
  const [supplierForm, setSupplierForm] = useState({});
  const [orderForm, setOrderForm] = useState({ supplierId: "", orderDate: new Date().toISOString().slice(0,10), notes: "" });
  const [orderItems, setOrderItems] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [editSupplier, setEditSupplier] = useState(null);
  const canEdit = user.role === "admin" || user.role === "user";

  const sfld = (k, v) => setSupplierForm(f => ({ ...f, [k]: v }));

  // ── Supplier CRUD ──
  const openAddSupplier = () => { setEditSupplier(null); setSupplierForm({ name:"",contactName:"",phone:"",email:"",taxNumber:"",address:"",notes:"" }); setModal("supplier"); };
  const openEditSupplier = (s) => { setEditSupplier(s); setSupplierForm({ ...s }); setModal("supplier"); };

  const saveSupplier = async () => {
    if (!supplierForm.name?.trim()) { notify("Firma adı zorunlu", "error"); return; }
    const dbObj = { name: supplierForm.name.trim(), contact_name: supplierForm.contactName||"", phone: supplierForm.phone||"", email: supplierForm.email||"", tax_number: supplierForm.taxNumber||"", address: supplierForm.address||"", notes: supplierForm.notes||"" };
    if (editSupplier) {
      const { error } = await supabase.from("suppliers").update(dbObj).eq("id", editSupplier.id);
      if (error) { notify("Güncelleme hatası: " + error.message, "error"); return; }
      setSuppliers(prev => prev.map(s => s.id === editSupplier.id ? { ...s, ...mapSupplier({ ...dbObj, id: editSupplier.id, is_active: true, created_at: editSupplier.createdAt }) } : s));
    } else {
      const { data, error } = await supabase.from("suppliers").insert([dbObj]).select().single();
      if (error) { notify("Tedarikçi eklenemedi: " + error.message, "error"); return; }
      setSuppliers(prev => [mapSupplier(data), ...prev]);
    }
    notify(editSupplier ? "Tedarikçi güncellendi" : "Tedarikçi eklendi");
    setModal(null);
  };

  const deleteSupplier = async (s) => {
    if (!window.confirm(`"${s.name}" tedarikçisini silmek istediğinize emin misiniz?`)) return;
    const { error } = await supabase.from("suppliers").delete().eq("id", s.id);
    if (error) { notify("Silinemedi: " + error.message, "error"); return; }
    setSuppliers(prev => prev.filter(x => x.id !== s.id));
    notify("Tedarikçi silindi");
  };

  // ── Order CRUD ──
  const openAddOrder = () => {
    setSelectedOrder(null);
    setOrderForm({ supplierId: suppliers[0]?.id || "", orderDate: new Date().toISOString().slice(0,10), notes: "" });
    setOrderItems([{ productId: "", productName: "", productSku: "", quantity: 1, unitCost: "" }]);
    setModal("order");
  };

  const addOrderItemRow = () => setOrderItems(prev => [...prev, { productId: "", productName: "", productSku: "", quantity: 1, unitCost: "" }]);
  const removeOrderItemRow = (i) => setOrderItems(prev => prev.filter((_, idx) => idx !== i));
  const updateOrderItem = (i, k, v) => setOrderItems(prev => prev.map((item, idx) => idx === i ? { ...item, [k]: v } : item));
  const selectProduct = (i, productId) => {
    const p = products.find(x => x.id === productId);
    if (p) updateOrderItem(i, "productId", productId);
    if (p) updateOrderItem(i, "productName", p.name);
    if (p) updateOrderItem(i, "productSku", p.sku);
    if (p && p.costPrice) updateOrderItem(i, "unitCost", p.costPrice);
  };

  const orderTotal = orderItems.reduce((s, item) => s + (parseFloat(item.unitCost)||0) * (parseInt(item.quantity)||0), 0);

  const saveOrder = async () => {
    const supplier = suppliers.find(s => s.id === orderForm.supplierId);
    if (!supplier) { notify("Tedarikçi seçin", "error"); return; }
    const validItems = orderItems.filter(item => item.productId && item.quantity > 0 && item.unitCost > 0);
    if (validItems.length === 0) { notify("En az bir ürün ekleyin", "error"); return; }

    const orderData = { supplier_id: supplier.id, supplier_name: supplier.name, status: "Bekliyor", order_date: orderForm.orderDate, total_amount: orderTotal, notes: orderForm.notes || "", created_by: user.username };
    const { data: orderRow, error: orderErr } = await supabase.from("purchase_orders").insert([orderData]).select().single();
    if (orderErr) { notify("Sipariş oluşturulamadı: " + orderErr.message, "error"); return; }

    const itemRows = validItems.map(item => ({ order_id: orderRow.id, product_id: item.productId, product_name: item.productName, product_sku: item.productSku, quantity: parseInt(item.quantity), unit_cost: parseFloat(item.unitCost) }));
    const { error: itemErr } = await supabase.from("purchase_order_items").insert(itemRows);
    if (itemErr) { notify("Kalemler eklenemedi: " + itemErr.message, "error"); return; }

    setPurchaseOrders(prev => [mapOrder(orderRow), ...prev]);
    notify("Satın alma siparişi oluşturuldu");
    setModal(null);
  };

  const openOrderDetail = async (order) => {
    const { data: items } = await supabase.from("purchase_order_items").select("*").eq("order_id", order.id);
    setSelectedOrder({ ...order, items: (items || []).map(mapOrderItem) });
    setModal("order-detail");
  };

  const deliverOrder = async () => {
    if (!selectedOrder) return;
    const items = selectedOrder.items || [];
    for (const item of items) {
      const product = products.find(p => p.id === item.productId);
      if (!product) continue;
      const prev = product.stock;
      const next = prev + item.quantity;
      await supabase.from("products").update({ stock: next }).eq("id", item.productId);
      await supabase.from("movements").insert([{ product_id: item.productId, product_name: item.productName, type: "Giriş", quantity: item.quantity, prev_stock: prev, next_stock: next, username: user.username, note: `Satın alma #${selectedOrder.id.slice(-6)} - ${selectedOrder.supplierName}` }]);
    }
    await supabase.from("purchase_orders").update({ status: "Teslim Edildi", delivery_date: new Date().toISOString().slice(0,10) }).eq("id", selectedOrder.id);

    // Refresh products and movements
    const { data: freshProds } = await supabase.from("products").select("*").order("created_at", { ascending: false });
    const { data: freshMoves } = await supabase.from("movements").select("*").order("created_at", { ascending: false });
    if (freshProds) setProducts(freshProds.map(mapProduct));
    if (freshMoves) setMovements(freshMoves.map(mapMovement));
    setPurchaseOrders(prev => prev.map(o => o.id === selectedOrder.id ? { ...o, status: "Teslim Edildi", deliveryDate: new Date().toISOString().slice(0,10) } : o));

    notify(`${items.length} ürün stoka eklendi ✓`);
    setModal(null);
  };

  const cancelOrder = async (order) => {
    if (!window.confirm("Siparişi iptal etmek istediğinize emin misiniz?")) return;
    await supabase.from("purchase_orders").update({ status: "İptal" }).eq("id", order.id);
    setPurchaseOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: "İptal" } : o));
    notify("Sipariş iptal edildi");
  };

  const exportOrders = () => exportExcel(purchaseOrders.map(o => ({ "Sipariş ID": o.id.slice(-8), Tedarikçi: o.supplierName, Durum: o.status, "Sipariş Tarihi": o.orderDate, "Teslim Tarihi": o.deliveryDate || "-", "Toplam (₺)": o.totalAmount, Not: o.notes, Oluşturan: o.createdBy })), "satin-alma-siparisleri.xlsx");

  const statusColor = (s) => s === "Teslim Edildi" ? { bg: "rgba(34,197,94,0.12)", color: "#16a34a" } : s === "İptal" ? { bg: "rgba(100,116,139,0.12)", color: "#a8a29e" } : { bg: "rgba(251,191,36,0.12)", color: "#d97706" };

  // Supplier stats
  const getSupplierStats = (supplierId) => {
    const orders = purchaseOrders.filter(o => o.supplierId === supplierId && o.status === "Teslim Edildi");
    return { orderCount: orders.length, totalSpent: orders.reduce((s, o) => s + o.totalAmount, 0) };
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 21, fontWeight: 700, margin: 0, letterSpacing: "-0.03em", color: "#18181b" }}>Satın Alma</h1>
          <p style={{ color: "#a8a29e", margin: "4px 0 0", fontSize: 13 }}>{purchaseOrders.length} sipariş · {suppliers.length} tedarikçi</p>
        </div>
        {canEdit && (
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={exportOrders} className="btn-hover" style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 18px", background: "rgba(0,0,0,0.03)", border: "1px solid #e7e5e4", borderRadius: 9, color: "#78716c", cursor: "pointer", fontSize: 14 }}>
              <Icon name="download" size={15} /> Excel İndir
            </button>
            {tab === "orders" && (
              <button onClick={openAddOrder} className="btn-hover" style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 20px", background: "#18181b", border: "none", borderRadius: 10, color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600 }}>
                <Icon name="add" size={15} /> Yeni Sipariş
              </button>
            )}
            {tab === "suppliers" && (
              <button onClick={openAddSupplier} className="btn-hover" style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 20px", background: "#18181b", border: "none", borderRadius: 10, color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600 }}>
                <Icon name="add" size={15} /> Yeni Tedarikçi
              </button>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24, background: "#fafaf9", borderRadius: 12, padding: 4, width: "fit-content" }}>
        {[["orders", "Siparişler"], ["suppliers", "Tedarikçiler"]].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{ padding: "8px 20px", borderRadius: 9, border: "none", background: tab === id ? "rgba(59,130,246,0.2)" : "transparent", color: tab === id ? "#60a5fa" : "#a8a29e", cursor: "pointer", fontSize: 14, fontWeight: tab === id ? 600 : 400, transition: "all 0.15s" }}>{label}</button>
        ))}
      </div>

      {/* Orders Tab */}
      {tab === "orders" && (
        <div>
          {purchaseOrders.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: "#a8a29e" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🛒</div>
              <div style={{ fontSize: 15, marginBottom: 8 }}>Henüz satın alma siparişi yok</div>
              {canEdit && <button onClick={openAddOrder} style={{ padding: "10px 24px", background: "linear-gradient(135deg,#3b82f6,#8b5cf6)", border: "none", borderRadius: 10, color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600 }}>İlk Siparişi Oluştur</button>}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {purchaseOrders.map(order => {
                const sc = statusColor(order.status);
                return (
                  <div key={order.id} className="card-hover" onClick={() => openOrderDetail(order)} style={{ background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 14, padding: "16px 20px", cursor: "pointer", transition: "all 0.15s", display: "flex", alignItems: "center", gap: 16 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: "rgba(59,130,246,0.1)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Icon name="truck" size={18} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                        <span style={{ fontWeight: 600, fontSize: 14, color: "#1c1917" }}>{order.supplierName}</span>
                        <span style={{ background: sc.bg, color: sc.color, borderRadius: 6, padding: "2px 8px", fontSize: 12, fontWeight: 500 }}>{order.status}</span>
                      </div>
                      <div style={{ fontSize: 12, color: "#a8a29e" }}>Sipariş: {order.orderDate}{order.deliveryDate ? ` · Teslim: ${order.deliveryDate}` : ""}{order.notes ? ` · ${order.notes}` : ""}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: "#1c1917" }}>₺{Number(order.totalAmount).toLocaleString("tr-TR", { minimumFractionDigits: 2 })}</div>
                      <div style={{ fontSize: 11, color: "#a8a29e" }}>#{order.id.slice(-8)}</div>
                    </div>
                    {canEdit && order.status === "Bekliyor" && (
                      <button onClick={e => { e.stopPropagation(); cancelOrder(order); }} style={{ padding: "6px 12px", background: "rgba(100,116,139,0.1)", border: "1px solid rgba(100,116,139,0.2)", borderRadius: 8, color: "#a8a29e", cursor: "pointer", fontSize: 12, flexShrink: 0 }}>İptal</button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Suppliers Tab */}
      {tab === "suppliers" && (
        <div>
          {suppliers.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: "#a8a29e" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🏭</div>
              <div style={{ fontSize: 15, marginBottom: 8 }}>Henüz tedarikçi eklenmedi</div>
              {canEdit && <button onClick={openAddSupplier} style={{ padding: "10px 24px", background: "linear-gradient(135deg,#3b82f6,#8b5cf6)", border: "none", borderRadius: 10, color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600 }}>İlk Tedarikçiyi Ekle</button>}
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 16 }}>
              {suppliers.map(s => {
                const stats = getSupplierStats(s.id);
                return (
                  <div key={s.id} className="card-hover" style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: 14, padding: 20, transition: "all 0.15s" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{ width: 42, height: 42, borderRadius: 12, background: "linear-gradient(135deg, rgba(59,130,246,0.2), rgba(139,92,246,0.2))", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <Icon name="supplier" size={20} />
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 15, color: "#1c1917" }}>{s.name}</div>
                          {s.contactName && <div style={{ fontSize: 12, color: "#a8a29e" }}>{s.contactName}</div>}
                        </div>
                      </div>
                      {canEdit && (
                        <div style={{ display: "flex", gap: 6 }}>
                          <button onClick={() => openEditSupplier(s)} style={{ padding: "5px 10px", background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 7, color: "#60a5fa", cursor: "pointer", fontSize: 12 }}>Düzenle</button>
                          <button onClick={() => deleteSupplier(s)} style={{ padding: "5px 10px", background: "#fef2f2", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 7, color: "#dc2626", cursor: "pointer", fontSize: 12 }}>Sil</button>
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
                      {s.phone && <div style={{ fontSize: 13, color: "#78716c" }}>📞 {s.phone}</div>}
                      {s.email && <div style={{ fontSize: 13, color: "#78716c" }}>✉️ {s.email}</div>}
                      {s.taxNumber && <div style={{ fontSize: 13, color: "#78716c" }}>🧾 VKN: {s.taxNumber}</div>}
                      {s.address && <div style={{ fontSize: 13, color: "#78716c" }}>📍 {s.address}</div>}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, paddingTop: 14, borderTop: "1px solid #f5f5f4" }}>
                      <div style={{ background: "#fafaf9", borderRadius: 10, padding: "10px 12px" }}>
                        <div style={{ fontSize: 11, color: "#a8a29e", marginBottom: 3 }}>Teslim Edilen Sipariş</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: "#1c1917" }}>{stats.orderCount}</div>
                      </div>
                      <div style={{ background: "#fafaf9", borderRadius: 10, padding: "10px 12px" }}>
                        <div style={{ fontSize: 11, color: "#a8a29e", marginBottom: 3 }}>Toplam Alım</div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: "#16a34a" }}>₺{stats.totalSpent.toLocaleString("tr-TR", { minimumFractionDigits: 0 })}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Supplier Modal */}
      {modal === "supplier" && (
        <Modal title={editSupplier ? "Tedarikçi Düzenle" : "Yeni Tedarikçi"} onClose={() => setModal(null)}
          footer={<><button onClick={() => setModal(null)} style={btnStyle("ghost")}>İptal</button><button onClick={saveSupplier} style={btnStyle("primary")}>{editSupplier ? "Güncelle" : "Ekle"}</button></>}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            {[["name","Firma Adı *","text",true],["contactName","Yetkili Adı","text",false],["phone","Telefon","tel",false],["email","E-posta","email",false],["taxNumber","Vergi No","text",false]].map(([k,label,type,req]) => (
              <div key={k} style={{ gridColumn: k === "name" || k === "address" ? "1/-1" : undefined }}>
                <label style={{ color: "#78716c", fontSize: 12, display: "block", marginBottom: 5 }}>{label}</label>
                <input type={type} value={supplierForm[k]||""} onChange={e => sfld(k, e.target.value)}
                  style={{ width: "100%", background: "#fafaf9", border: `1px solid ${req && !supplierForm[k] ? "rgba(239,68,68,0.4)" : "#334155"}`, borderRadius: 8, padding: "9px 12px", color: "#1c1917", fontSize: 14, outline: "none" }} />
              </div>
            ))}
            <div style={{ gridColumn: "1/-1" }}>
              <label style={{ color: "#78716c", fontSize: 12, display: "block", marginBottom: 5 }}>Adres</label>
              <textarea value={supplierForm.address||""} onChange={e => sfld("address", e.target.value)} rows={2}
                style={{ width: "100%", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 8, padding: "9px 12px", color: "#1c1917", fontSize: 14, outline: "none", resize: "vertical" }} />
            </div>
            <div style={{ gridColumn: "1/-1" }}>
              <label style={{ color: "#78716c", fontSize: 12, display: "block", marginBottom: 5 }}>Notlar</label>
              <textarea value={supplierForm.notes||""} onChange={e => sfld("notes", e.target.value)} rows={2}
                style={{ width: "100%", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 8, padding: "9px 12px", color: "#1c1917", fontSize: 14, outline: "none", resize: "vertical" }} />
            </div>
          </div>
        </Modal>
      )}

      {/* New Order Modal */}
      {modal === "order" && (
        <Modal title="Yeni Satın Alma Siparişi" onClose={() => setModal(null)}
          footer={<><button onClick={() => setModal(null)} style={btnStyle("ghost")}>İptal</button><button onClick={saveOrder} style={btnStyle("primary")}>Sipariş Oluştur</button></>}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <label style={{ color: "#78716c", fontSize: 12, display: "block", marginBottom: 5 }}>Tedarikçi *</label>
                <select value={orderForm.supplierId} onChange={e => setOrderForm(f => ({ ...f, supplierId: e.target.value }))}
                  style={{ width: "100%", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 8, padding: "9px 12px", color: "#1c1917", fontSize: 14, outline: "none" }}>
                  <option value="">Seçin...</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ color: "#78716c", fontSize: 12, display: "block", marginBottom: 5 }}>Sipariş Tarihi</label>
                <input type="date" value={orderForm.orderDate} onChange={e => setOrderForm(f => ({ ...f, orderDate: e.target.value }))}
                  style={{ width: "100%", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 8, padding: "9px 12px", color: "#1c1917", fontSize: 14, outline: "none" }} />
              </div>
            </div>
            <div>
              <label style={{ color: "#78716c", fontSize: 12, display: "block", marginBottom: 5 }}>Not</label>
              <input type="text" value={orderForm.notes||""} onChange={e => setOrderForm(f => ({ ...f, notes: e.target.value }))} placeholder="Opsiyonel"
                style={{ width: "100%", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 8, padding: "9px 12px", color: "#1c1917", fontSize: 14, outline: "none" }} />
            </div>

            {/* Order Items */}
            <div style={{ borderTop: "1px solid #e7e5e4", paddingTop: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <label style={{ color: "#78716c", fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>Ürünler</label>
                <button onClick={addOrderItemRow} style={{ padding: "5px 12px", background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 7, color: "#60a5fa", cursor: "pointer", fontSize: 12 }}>+ Ürün Ekle</button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {orderItems.map((item, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 80px 100px 32px", gap: 8, alignItems: "center" }}>
                    <select value={item.productId} onChange={e => selectProduct(i, e.target.value)}
                      style={{ background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 8, padding: "8px 10px", color: item.productId ? "#1c1917" : "#a8a29e", fontSize: 13, outline: "none" }}>
                      <option value="">Ürün seçin...</option>
                      {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
                    </select>
                    <input type="number" min="1" placeholder="Adet" value={item.quantity} onChange={e => updateOrderItem(i, "quantity", e.target.value)}
                      style={{ background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 8, padding: "8px 10px", color: "#1c1917", fontSize: 13, outline: "none", textAlign: "center" }} />
                    <input type="number" min="0" step="0.01" placeholder="Birim Maliyet ₺" value={item.unitCost} onChange={e => updateOrderItem(i, "unitCost", e.target.value)}
                      style={{ background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 8, padding: "8px 10px", color: "#1c1917", fontSize: 13, outline: "none" }} />
                    <button onClick={() => removeOrderItemRow(i)} style={{ width: 32, height: 32, background: "#fef2f2", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 7, color: "#dc2626", cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
                  </div>
                ))}
              </div>
              {orderItems.length > 0 && (
                <div style={{ marginTop: 12, padding: "10px 14px", background: "rgba(59,130,246,0.06)", borderRadius: 8, display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "#78716c", fontSize: 13 }}>{orderItems.filter(x => x.productId).length} ürün kalem</span>
                  <span style={{ color: "#1c1917", fontWeight: 700, fontSize: 14 }}>Toplam: ₺{orderTotal.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}</span>
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* Order Detail Modal */}
      {modal === "order-detail" && selectedOrder && (
        <Modal title={`Sipariş Detayı — ${selectedOrder.supplierName}`} onClose={() => setModal(null)}
          footer={<>
            <button onClick={() => setModal(null)} style={btnStyle("ghost")}>Kapat</button>
            {canEdit && selectedOrder.status === "Bekliyor" && (
              <button onClick={deliverOrder} style={{ ...btnStyle("primary"), background: "linear-gradient(135deg,#22c55e,#16a34a)" }}>
                ✓ Teslim Edildi — Stokları Güncelle
              </button>
            )}
          </>}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              {[["Durum", selectedOrder.status], ["Sipariş Tarihi", selectedOrder.orderDate], ["Teslim Tarihi", selectedOrder.deliveryDate || "—"]].map(([label, value]) => (
                <div key={label} style={{ background: "#fafaf9", borderRadius: 10, padding: "10px 14px" }}>
                  <div style={{ color: "#a8a29e", fontSize: 11, marginBottom: 4 }}>{label}</div>
                  <div style={{ color: "#1c1917", fontWeight: 600, fontSize: 14 }}>{value}</div>
                </div>
              ))}
            </div>
            {selectedOrder.notes && <div style={{ color: "#78716c", fontSize: 13 }}>📝 {selectedOrder.notes}</div>}
            <div>
              <div style={{ color: "#a8a29e", fontSize: 11.5, marginTop: 4, fontWeight: 600, textTransform: "uppercase", marginBottom: 10 }}>Ürün Kalemleri</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(selectedOrder.items || []).map(item => (
                  <div key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "#fafaf9", borderRadius: 10 }}>
                    <div>
                      <div style={{ color: "#1c1917", fontSize: 13, fontWeight: 500 }}>{item.productName}</div>
                      <div style={{ color: "#a8a29e", fontSize: 11.5, marginTop: 4 }}>SKU: {item.productSku}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ color: "#1c1917", fontSize: 13 }}>{item.quantity} adet × ₺{Number(item.unitCost).toFixed(2)}</div>
                      <div style={{ color: "#16a34a", fontWeight: 600, fontSize: 14 }}>₺{Number(item.totalCost).toFixed(2)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", padding: "12px 0 0", borderTop: "1px solid #e7e5e4" }}>
              <span style={{ color: "#78716c", fontSize: 14 }}>Genel Toplam: <strong style={{ color: "#1c1917", fontSize: 18 }}>₺{Number(selectedOrder.totalAmount).toLocaleString("tr-TR", { minimumFractionDigits: 2 })}</strong></span>
            </div>
            {canEdit && selectedOrder.status === "Bekliyor" && (
              <div style={{ padding: "12px 16px", background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.2)", borderRadius: 10, fontSize: 13, color: "#d97706" }}>
                ⚠️ "Teslim Edildi" butonuna basınca tüm ürünlerin stokları otomatik artacak ve hareket kaydı oluşacak.
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── SETTINGS PAGE ───────────────────────────────────────────────────────────
function SettingsPage({ user, setUser, appUsers, setAppUsers, notify, categories, setCategories, brands, setBrands }) {
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
    setUser(u => { const updated = { ...u, password: pwForm.newPw }; localStorage.setItem("stokpro_user", JSON.stringify(updated)); return updated; });
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
      if (editTarget.id === user.id) { const updated = { ...user, name: uForm.name, username: uForm.username, password: uForm.password, role: uForm.role }; setUser(updated); localStorage.setItem("stokpro_user", JSON.stringify(updated)); }
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
  const roleColor = (r) => r === "admin" ? "#44403c" : r === "user" ? "#3b82f6" : "#a8a29e";

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 21, fontWeight: 700, margin: 0, letterSpacing: "-0.03em", color: "#18181b" }}>Ayarlar</h1>
        <p style={{ color: "#a8a29e", margin: "4px 0 0", fontSize: 13 }}>Hesap ve kullanıcı yönetimi</p>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 24 }}>
        {[["password", "Şifre Değiştir"], ...(isAdmin ? [["users", "Kullanıcı Yönetimi"], ["lists", "Kategori & Marka"]] : [])].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            style={{ padding: "9px 20px", borderRadius: 9, border: `1px solid ${tab === id ? "#3b82f6" : "#e7e5e4"}`, background: tab === id ? "rgba(59,130,246,0.15)" : "#fafaf9", color: tab === id ? "#60a5fa" : "#a8a29e", cursor: "pointer", fontSize: 14, fontWeight: tab === id ? 600 : 400 }}>
            {label}
          </button>
        ))}
      </div>

      {tab === "password" && (
        <div style={{ maxWidth: 440 }}>
          <div style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: 14, padding: 28 }}>
            <h3 style={{ margin: "0 0 20px", fontSize: 15 }}>Şifre Değiştir</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {[["Mevcut Şifre", "current"], ["Yeni Şifre", "newPw"], ["Yeni Şifre (Tekrar)", "confirm"]].map(([label, field]) => (
                <div key={field}>
                  <label style={{ color: "#78716c", fontSize: 12, display: "block", marginBottom: 5 }}>{label}</label>
                  <input type="password" value={pwForm[field]} onChange={e => setPwForm(f => ({ ...f, [field]: e.target.value }))}
                    style={{ width: "100%", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 8, padding: "10px 12px", color: "#1c1917", fontSize: 14, outline: "none" }} />
                </div>
              ))}
              <button onClick={changePassword} className="btn-hover"
                style={{ padding: "12px", background: "#18181b", border: "none", borderRadius: 10, color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600, marginTop: 4 }}>
                Şifreyi Güncelle
              </button>
            </div>
          </div>
          <div style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: 12, padding: "14px 18px", marginTop: 16 }}>
            <div style={{ color: "#78716c", fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Hesap Bilgileri</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[["Ad Soyad", user.name], ["Kullanıcı Adı", user.username], ["Rol", roleLabel(user.role)]].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "#a8a29e", fontSize: 13 }}>{k}</span>
                  <span style={{ color: "#1c1917", fontSize: 13, fontWeight: 500 }}>{v}</span>
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
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 18px", background: "#18181b", border: "none", borderRadius: 10, color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600 }}>
              <Icon name="plus" size={15} /> Yeni Kullanıcı
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {appUsers.map(u => (
              <div key={u.id} style={{ background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 12, padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: `${roleColor(u.role)}20`, display: "flex", alignItems: "center", justifyContent: "center", color: roleColor(u.role), fontSize: 16, fontWeight: 700 }}>
                    {u.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, color: "#1c1917", fontSize: 14 }}>{u.name}</div>
                    <div style={{ color: "#a8a29e", fontSize: 11.5, marginTop: 4, marginTop: 2 }}>@{u.username}</div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ background: `${roleColor(u.role)}18`, color: roleColor(u.role), borderRadius: 6, padding: "4px 10px", fontSize: 12, fontWeight: 500 }}>{roleLabel(u.role)}</span>
                  {u.id === user.id && <span style={{ color: "#a8a29e", fontSize: 11 }}>(siz)</span>}
                  <button onClick={() => { setUForm({ name: u.name, username: u.username, password: u.password, role: u.role }); setEditTarget(u); setUserModal("edit"); }}
                    style={{ background: "rgba(139,92,246,0.15)", border: "none", borderRadius: 7, padding: "7px 9px", color: "#78716c", cursor: "pointer" }}><Icon name="edit" size={14} /></button>
                  {u.id !== user.id && (
                    <button onClick={() => deleteUser(u)}
                      style={{ background: "#fef2f2", border: "none", borderRadius: 7, padding: "7px 9px", color: "#dc2626", cursor: "pointer" }}><Icon name="x" size={14} /></button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "lists" && isAdmin && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, maxWidth: 700 }}>
          <ListManager title="Kategoriler" items={categories} onSave={(items) => { setCategories(items); localStorage.setItem("stokpro_cats", JSON.stringify(items)); }} color="#3b82f6" />
          <ListManager title="Markalar" items={brands} onSave={(items) => { setBrands(items); localStorage.setItem("stokpro_brands", JSON.stringify(items)); }} color="#44403c" />
        </div>
      )}

            {userModal && (
        <Modal title={userModal === "add" ? "Yeni Kullanıcı Ekle" : "Kullanıcıyı Düzenle"} onClose={() => setUserModal(null)}
          footer={<><button onClick={() => setUserModal(null)} style={btnStyle("ghost")}>İptal</button><button onClick={saveUser} style={btnStyle("primary")}>Kaydet</button></>}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {[["Ad Soyad", "name", "text"], ["Kullanıcı Adı", "username", "text"], ["Şifre", "password", "password"]].map(([label, field, type]) => (
              <div key={field}>
                <label style={{ color: "#78716c", fontSize: 12, display: "block", marginBottom: 5 }}>{label}</label>
                <input type={type} value={uForm[field]} onChange={e => setUForm(f => ({ ...f, [field]: e.target.value }))}
                  style={{ width: "100%", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 8, padding: "9px 12px", color: "#1c1917", fontSize: 14, outline: "none" }} />
              </div>
            ))}
            <div>
              <label style={{ color: "#78716c", fontSize: 12, display: "block", marginBottom: 5 }}>Rol</label>
              <div style={{ display: "flex", gap: 8 }}>
                {[["admin", "Yönetici"], ["user", "Personel"], ["viewer", "Görüntüleyici"]].map(([val, label]) => (
                  <button key={val} onClick={() => setUForm(f => ({ ...f, role: val }))}
                    style={{ flex: 1, padding: "9px", borderRadius: 8, border: `1px solid ${uForm.role === val ? roleColor(val) : "#e7e5e4"}`, background: uForm.role === val ? `${roleColor(val)}18` : "transparent", color: uForm.role === val ? roleColor(val) : "#a8a29e", cursor: "pointer", fontSize: 13, fontWeight: 500 }}>
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
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20, backdropFilter: "blur(4px)" }}>
      <div style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: 16, width: "100%", maxWidth: 560, maxHeight: "90vh", overflow: "auto", animation: "slideIn 0.18s ease", boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.05)" }}>
        <div style={{ padding: "20px 24px 0", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{title}</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#a8a29e", cursor: "pointer" }}><Icon name="x" size={20} /></button>
        </div>
        <div style={{ padding: "0 24px 20px" }}>{children}</div>
        {footer && <div style={{ padding: "16px 24px", borderTop: "1px solid #e7e5e4", display: "flex", justifyContent: "flex-end", gap: 10 }}>{footer}</div>}
      </div>
    </div>
  );
}

const exportExcel = async (data, filename) => {
  const loadXLSX = () => new Promise((resolve, reject) => {
    if (window.XLSX) { resolve(window.XLSX); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => reject(new Error("XLSX yüklenemedi"));
    document.head.appendChild(s);
  });
  const XLSX = await loadXLSX();
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Veri");
  const cols = Object.keys(data[0] || {}).map(k => ({ wch: Math.max(k.length + 4, 14) }));
  ws["!cols"] = cols;
  XLSX.writeFile(wb, filename);
};


const selectStyle = { background: "rgba(0,0,0,0.02)", border: "1px solid #e7e5e4", borderRadius: 10, padding: "10px 14px", color: "#78716c", fontSize: 14, outline: "none" };

const btnStyle = (variant) => ({
  padding: "10px 18px",
  borderRadius: 9,
  border: variant === "ghost" ? "1px solid #e7e5e4" : "none",
  background: variant === "primary" ? "#18181b" : "#fff",
  color: variant === "primary" ? "#fff" : "#44403c",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: variant === "primary" ? 600 : 500,
  transition: "all 0.15s",
  fontFamily: "'Inter', sans-serif",
  letterSpacing: variant === "primary" ? "-0.01em" : "normal",
  boxShadow: variant === "primary" ? "none" : "none",
});
