
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
  category: r.category || "", brand: r.brand || "", location: r.location || "", variant: r.variant || "",
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
function CameraScanner({ onDetected, onClose, onError, recentScans = [] }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const animRef = useRef(null);
  const lastCodeRef = useRef(null);
  const lastTimeRef = useRef(0);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastResult, setLastResult] = useState(null);
  const [torchOn, setTorchOn] = useState(false);
  const [facingMode, setFacingMode] = useState("environment");
  const [libLoaded, setLibLoaded] = useState(false);

  const stopCamera = () => {
    if (animRef.current) { cancelAnimationFrame(animRef.current); animRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
  };

  // Web Audio API ile ses üretimi
  const playSound = (type) => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const gain = ctx.createGain();
      gain.connect(ctx.destination);

      if (type === "success") {
        // Kısa, yüksek bip - başarılı okuma
        const osc = ctx.createOscillator();
        osc.connect(gain);
        osc.type = "sine";
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.08);
        gain.gain.setValueAtTime(0.4, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.15);
        osc.onended = () => ctx.close();
      } else if (type === "error") {
        // İki kısa alçak bip - hata
        [0, 0.18].forEach(delay => {
          const osc = ctx.createOscillator();
          osc.connect(gain);
          osc.type = "square";
          osc.frequency.setValueAtTime(220, ctx.currentTime + delay);
          gain.gain.setValueAtTime(0.25, ctx.currentTime + delay);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.12);
          osc.start(ctx.currentTime + delay);
          osc.stop(ctx.currentTime + delay + 0.12);
        });
        setTimeout(() => ctx.close(), 500);
      } else if (type === "duplicate") {
        // Tek kısa alçak bip - zaten okundu
        const osc = ctx.createOscillator();
        osc.connect(gain);
        osc.type = "sine";
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.1);
        osc.onended = () => ctx.close();
      }
    } catch(e) { /* AudioContext desteklenmiyor */ }
  };

  // Load ZXing from CDN
  const loadZXing = () => new Promise((resolve, reject) => {
    if (window.ZXing) { resolve(); return; }
    // Remove any failed previous attempt
    document.querySelectorAll('script[data-zxing]').forEach(s => s.remove());
    const s = document.createElement("script");
    s.setAttribute("data-zxing", "1");
    s.src = "https://unpkg.com/@zxing/library@0.19.1/umd/index.min.js";
    s.onload = () => {
      if (window.ZXing) resolve();
      else reject(new Error("ZXing nesnesi bulunamadı"));
    };
    s.onerror = () => reject(new Error("ZXing CDN yüklenemedi — internet bağlantısını kontrol edin"));
    document.head.appendChild(s);
  });

  const startScanner = async (facing) => {
    setLoading(true);
    setError(null);
    stopCamera();

    try {
      await loadZXing();
      setLibLoaded(true);

      const constraints = {
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) throw new Error("Video elementi bulunamadı");
      video.srcObject = stream;
      video.setAttribute("playsinline", true);
      await video.play();

      // Use ZXing BrowserMultiFormatReader with decodeFromStream (v0.19)
      const hints = new Map();
      hints.set(window.ZXing.DecodeHintType.TRY_HARDER, true);
      const codeReader = new window.ZXing.BrowserMultiFormatReader(hints, 300);

      // decodeFromStream is available in 0.19.x
      codeReader.decodeFromStream(stream, video, (result, err) => {
        if (result) {
          const code = result.getText();
          const now = Date.now();
          if (code !== lastCodeRef.current || now - lastTimeRef.current > 1500) {
            lastCodeRef.current = code;
            lastTimeRef.current = now;
            setLastResult(code);
            if (navigator.vibrate) navigator.vibrate([60, 30, 60]);
            const found = onDetected(code);
            if (found === false) {
              playSound("error");
            } else {
              playSound("success");
            }
          }
        }
        // Ignore NotFoundException — it just means no barcode in frame yet
      });

      setLoading(false);
    } catch (err) {
      console.error("Camera error:", err);
      let msg = err.message || "Bilinmeyen hata";
      if (err.name === "NotAllowedError") msg = "Kamera izni reddedildi. Tarayıcı ayarlarından kamera iznini açın.";
      else if (err.name === "NotFoundError") msg = "Kamera bulunamadı.";
      else if (err.name === "NotReadableError") msg = "Kamera başka bir uygulama tarafından kullanılıyor.";
      setError(msg);
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
    } catch(e) { /* torch not supported */ }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.95)", zIndex: 9999, display: "flex", flexDirection: "column", alignItems: "stretch", justifyContent: "flex-start" }}>
      {/* Header - compact top bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "#000", borderBottom: "1px solid rgba(255,255,255,0.1)", flexShrink: 0 }}>
        <div style={{ color: "#fff" }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Barkod Tara</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 1 }}>
            {libLoaded ? "Kamerayı barkoda doğrultun" : "Yükleniyor..."}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={switchCamera} style={{ width: 36, height: 36, borderRadius: 99, background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.12)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          </button>
          <button onClick={toggleTorch} style={{ width: 36, height: 36, borderRadius: 99, background: torchOn ? "rgba(255,220,50,0.2)" : "rgba(255,255,255,0.1)", border: torchOn ? "1px solid rgba(255,220,50,0.4)" : "1px solid rgba(255,255,255,0.12)", color: torchOn ? "#ffd932" : "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          </button>
          <button onClick={() => { stopCamera(); onClose(); }} style={{ width: 36, height: 36, borderRadius: 99, background: "rgba(220,38,38,0.2)", border: "1px solid rgba(220,38,38,0.3)", color: "#f87171", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>

      {/* Video area */}
      <div style={{ position: "relative", width: "100%", maxWidth: 480, margin: "0 auto", aspectRatio: "4/3", background: "#000", overflow: "hidden", flexShrink: 0 }}>
        <video ref={videoRef} style={{ width: "100%", height: "100%", objectFit: "cover" }} muted playsInline />

        {/* Scan frame overlay */}
        {!loading && !error && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
            {/* Dim overlay */}
            <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.35)" }} />
            {/* Clear scan window */}
            <div style={{ position: "relative", width: "72%", height: "38%", zIndex: 2 }}>
              <div style={{ position: "absolute", inset: 0, background: "transparent", boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)", borderRadius: 4 }} />
              {/* Corner marks */}
              {[{top:0,left:0,borderTop:"3px solid #22c55e",borderLeft:"3px solid #22c55e",borderRadius:"5px 0 0 0"},
                {top:0,right:0,borderTop:"3px solid #22c55e",borderRight:"3px solid #22c55e",borderRadius:"0 5px 0 0"},
                {bottom:0,left:0,borderBottom:"3px solid #22c55e",borderLeft:"3px solid #22c55e",borderRadius:"0 0 0 5px"},
                {bottom:0,right:0,borderBottom:"3px solid #22c55e",borderRight:"3px solid #22c55e",borderRadius:"0 0 5px 0"}
              ].map((s, i) => (
                <div key={i} style={{ position: "absolute", width: 22, height: 22, ...s }} />
              ))}
              {/* Animated scan line */}
              <div style={{ position: "absolute", left: 6, right: 6, height: 2, background: "linear-gradient(90deg, transparent, #22c55e, transparent)", borderRadius: 99, animation: "scanLine 1.6s ease-in-out infinite" }} />
            </div>
          </div>
        )}

        {loading && (
          <div style={{ position: "absolute", inset: 0, background: "#111", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14 }}>
            <div style={{ width: 36, height: 36, border: "3px solid rgba(255,255,255,0.15)", borderTop: "3px solid #22c55e", borderRadius: "50%", animation: "spin 0.9s linear infinite" }} />
            <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 13 }}>Kamera başlatılıyor...</div>
          </div>
        )}

        {error && (
          <div style={{ position: "absolute", inset: 0, background: "#111", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 28, textAlign: "center" }}>
            <div style={{ width: 52, height: 52, borderRadius: 99, background: "#fee2e2", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            </div>
            <div style={{ color: "#fff", fontSize: 14, fontWeight: 600 }}>Kamera Açılamadı</div>
            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 12.5, lineHeight: 1.5 }}>{error}</div>
            <button onClick={() => startScanner(facingMode)} style={{ marginTop: 4, padding: "9px 22px", background: "#22c55e", border: "none", borderRadius: 9, color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: 13 }}>
              Tekrar Dene
            </button>
          </div>
        )}
      </div>

      {/* Bottom panel - last scanned + close */}
      <div style={{ flex: 1, overflowY: "auto", background: "#111", display: "flex", flexDirection: "column" }}>
        {/* Last result bar */}
        <div style={{ padding: "12px 16px", background: lastResult ? "rgba(34,197,94,0.15)" : "rgba(255,255,255,0.05)", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", gap: 12, minHeight: 56 }}>
          {lastResult ? (
            <>
              <div style={{ width: 32, height: 32, borderRadius: 99, background: "#22c55e", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 2 }}>Son Okunan</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#22c55e", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lastResult}</div>
              </div>
            </>
          ) : (
            <>
              <div style={{ width: 32, height: 32, borderRadius: 99, background: "rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><line x1="14" y1="14" x2="21" y2="14"/><line x1="14" y1="18" x2="21" y2="18"/><line x1="14" y1="21" x2="17" y2="21"/></svg>
              </div>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.3)" }}>Barkod bekleniyor...</div>
            </>
          )}
        </div>

        {/* Scanned list */}
        {recentScans && recentScans.length > 0 && (
          <div style={{ padding: "10px 16px 6px", flex: 1 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
              Son Tarananlar ({recentScans.length})
            </div>
            {recentScans.slice(0, 5).map((s, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: i === 0 ? "#fff" : "rgba(255,255,255,0.6)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div>
                  <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.3)", fontFamily: "monospace", marginTop: 1 }}>{s.barcode}</div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#22c55e" }}>{s.counted}</div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>adet</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <style>{`
        @keyframes scanLine {
          0%,100% { top: 4px; }
          50% { top: calc(100% - 6px); }
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
    transfer: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>,
    ikas: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M7 8l3 3-3 3M13 14h4"/></svg>,
    purchasing: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>,
    shipment: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>,
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

// ─── TRANSFERS PAGE ───────────────────────────────────────────────────────────
function TransfersPage({ products, setProducts, setMovements, user, notify, locations }) {
  const [transfers, setTransfers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("list"); // "list" | "new" | "detail"
  const [search, setSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [selectedTransfer, setSelectedTransfer] = useState(null);

  // New transfer form
  const [irsaliyeNo, setIrsaliyeNo] = useState("");
  const [fromLoc, setFromLoc] = useState("");
  const [toLoc, setToLoc] = useState("");
  const [transferItems, setTransferItems] = useState([]);
  const [itemSearch, setItemSearch] = useState("");
  const [comments, setComments] = useState([]);
  const [comment, setComment] = useState("");
  const [barcodeInput, setBarcodeInput] = useState("");
  const [barcodeActive, setBarcodeActive] = useState(false);
  const [showBarcodeCamera, setShowBarcodeCamera] = useState(false);
  const barcodeRef = useRef(null);
  const itemSearchRef = useRef(null);

  const canEdit = user.role !== "viewer";
  const locOptions = locations.length > 0 ? locations.map(l => l.name || l) : [];
  const fmt = (d) => new Date(d).toLocaleString("tr-TR", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" });

  useEffect(() => { loadTransfers(); }, []);

  const loadTransfers = async () => {
    setLoading(true);
    const { data } = await supabase.from("transfers").select("*").order("created_at", { ascending: false }).limit(100);
    if (data) setTransfers(data);
    setLoading(false);
  };

  const openNew = () => {
    setIrsaliyeNo(`IRS-${Date.now().toString().slice(-6)}`);
    setFromLoc(locOptions[0] || "");
    setToLoc("");
    setTransferItems([]);
    setComments([]);
    setComment("");
    setItemSearch("");
    setView("new");
  };

  const addItem = (product) => {
    if (transferItems.find(i => i.productId === product.id)) return;
    setTransferItems(prev => [...prev, { productId: product.id, quantity: 1 }]);
    setItemSearch("");
    itemSearchRef.current?.focus();
  };

  const addByBarcode = (e) => {
    if (e.key !== "Enter") return;
    const code = barcodeInput.trim();
    if (!code) return;
    const product = products.find(p => p.barcode === code || p.sku === code);
    if (product) { addItem(product); setBarcodeInput(""); notify(`✓ ${product.name} eklendi`); }
    else { notify("Barkod bulunamadı: " + code, "error"); setBarcodeInput(""); }
  };

  const handleBarcodeCameraDetect = (code) => {
    const product = products.find(p => p.barcode === code || p.sku === code);
    if (product) {
      addItem(product);
      notify(`✓ ${product.name} eklendi`);
      setShowBarcodeCamera(false);
      setBarcodeActive(false);
      return true;
    }
    return false;
  };

  const activateBarcode = () => {
    setBarcodeActive(true);
    setTimeout(() => barcodeRef.current?.focus(), 100);
  };

  const deactivateBarcode = () => {
    setBarcodeActive(false);
    setBarcodeInput("");
  };

  const updateQty = (productId, qty) => {
    setTransferItems(prev => prev.map(i => i.productId === productId ? { ...i, quantity: Math.max(0, qty) } : i));
  };

  const removeItem = (productId) => setTransferItems(prev => prev.filter(i => i.productId !== productId));

  const sendComment = () => {
    if (!comment.trim()) return;
    setComments(prev => [...prev, { text: comment.trim(), user: user.name || user.username, time: new Date() }]);
    setComment("");
  };

  const doTransfer = async (asDraft = false) => {
    if (!fromLoc || !toLoc) { notify("Çıkış ve giriş şubesi zorunludur", "error"); return; }
    if (fromLoc === toLoc) { notify("Çıkış ve giriş şubesi aynı olamaz", "error"); return; }
    if (transferItems.length === 0) { notify("En az bir ürün ekleyin", "error"); return; }
    if (!asDraft) {
      const bad = transferItems.find(i => { const p = products.find(pr => pr.id === i.productId); return !p || i.quantity <= 0 || p.stock < i.quantity; });
      if (bad) { notify("Bazı ürünlerde yetersiz stok veya geçersiz miktar", "error"); return; }
    }
    setSubmitting(true);
    try {
      const itemsData = transferItems.map(i => {
        const p = products.find(pr => pr.id === i.productId);
        return { productId: i.productId, productName: p?.name, productSku: p?.sku, quantity: i.quantity };
      });
      const transferRow = {
        irsaliye_no: irsaliyeNo,
        from_location: fromLoc,
        to_location: toLoc,
        username: user.username,
        status: asDraft ? "taslak" : "tamamlandı",
        product_id: transferItems[0]?.productId,
        product_name: itemsData.map(i => i.productName).filter(Boolean).join(", "),
        product_sku: "",
        quantity: transferItems.reduce((s, i) => s + i.quantity, 0),
        note: `İrsaliye: ${irsaliyeNo} | Ürünler: ${itemsData.map(i => `${i.productName}(${i.quantity})`).join(", ")}`,
      };
      const { data: tData, error: tErr } = await supabase.from("transfers").insert([transferRow]).select().single();
      if (tErr) throw tErr;
      if (!asDraft) {
        for (const item of transferItems) {
          const p = products.find(pr => pr.id === item.productId);
          if (!p) continue;
          await supabase.from("products").update({ location: toLoc }).eq("id", p.id);
          setProducts(prev => prev.map(pr => pr.id === p.id ? { ...pr, location: toLoc } : pr));
          await supabase.from("movements").insert([
            { product_id: p.id, product_name: p.name, type: "Transfer Çıkış", quantity: item.quantity, prev_stock: p.stock, next_stock: p.stock, username: user.username, note: `${fromLoc} → ${toLoc} | İrs: ${irsaliyeNo}` },
            { product_id: p.id, product_name: p.name, type: "Transfer Giriş", quantity: item.quantity, prev_stock: p.stock, next_stock: p.stock, username: user.username, note: `${fromLoc} → ${toLoc} | İrs: ${irsaliyeNo}` },
          ]);
        }
        const { data: moves } = await supabase.from("movements").select("*").order("created_at", { ascending: false }).limit(200);
        if (moves) setMovements(moves.map(m => ({ id: m.id, productId: m.product_id, productName: m.product_name, type: m.type, quantity: m.quantity, prevStock: m.prev_stock, nextStock: m.next_stock, username: m.username, note: m.note || "", date: m.created_at })));
      }
      setTransfers(prev => [tData, ...prev]);
      notify(asDraft ? "Taslak kaydedildi" : `Transfer tamamlandı (${transferItems.length} ürün)`);
      setView("list");
    } catch(e) { notify("Hata: " + e.message, "error"); }
    setSubmitting(false);
  };

  const inputStyle = { width: "100%", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 9, padding: "10px 14px", color: "#1c1917", fontSize: 14, outline: "none", fontFamily: "inherit" };
  const selectStyle = { ...inputStyle, cursor: "pointer" };

  // ── LIST ──────────────────────────────────────────────────────────────────────
  if (view === "list") {
    const filtered = transfers.filter(t =>
      !search || [t.product_name, t.from_location, t.to_location, t.irsaliye_no].some(v => v?.toLowerCase().includes(search.toLowerCase()))
    );
    return (
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 21, fontWeight: 700, margin: 0, letterSpacing: "-0.03em" }}>Transferler</h1>
            <p style={{ color: "#a8a29e", margin: "4px 0 0", fontSize: 13 }}>Depolar arası ürün transferlerini yönetin</p>
          </div>
          {canEdit && (
            <button onClick={openNew} style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 18px", background: "#18181b", border: "none", borderRadius: 9, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Transfer Ekle
            </button>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 20 }}>
          {[
            { label: "Toplam Transfer", value: transfers.length, icon: "🔄" },
            { label: "Bu Ay", value: transfers.filter(t => new Date(t.created_at).getMonth() === new Date().getMonth()).length, icon: "📅" },
            { label: "Taslak", value: transfers.filter(t => t.status === "taslak").length, icon: "📝" },
          ].map(s => (
            <div key={s.label} style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: 12, padding: "14px 18px", display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 22 }}>{s.icon}</span>
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#18181b" }}>{s.value}</div>
                <div style={{ fontSize: 12, color: "#a8a29e" }}>{s.label}</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ position: "relative", marginBottom: 14 }}>
          <svg style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a8a29e" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="İrsaliye no, ürün veya lokasyon ara..."
            style={{ width: "100%", background: "#fff", border: "1px solid #e7e5e4", borderRadius: 9, padding: "9px 12px 9px 36px", fontSize: 13.5, outline: "none", fontFamily: "inherit", color: "#1c1917" }} />
        </div>

        <div style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#fafaf9", borderBottom: "1px solid #f0eeed" }}>
                {["İrsaliye No", "Çıkış Şubesi", "", "Giriş Şubesi", "Ürün", "Oluşturan", "Tarih", "Durum"].map(h => (
                  <th key={h} style={{ padding: "10px 16px", textAlign: "left", color: "#a8a29e", fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ padding: 40, textAlign: "center", color: "#a8a29e" }}>Yükleniyor...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: 48, textAlign: "center" }}>
                  <div style={{ fontSize: 28, marginBottom: 10 }}>🔄</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#18181b", marginBottom: 4 }}>Henüz transfer yok</div>
                  <div style={{ fontSize: 13, color: "#a8a29e" }}>Transfer Ekle butonuna basarak başlayın</div>
                </td></tr>
              ) : filtered.map(t => (
                <tr key={t.id} onClick={() => { setSelectedTransfer(t); setView("detail"); }}
                  className="table-row" style={{ borderBottom: "1px solid #f5f5f4", cursor: "pointer" }}>
                  <td style={{ padding: "12px 16px" }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#18181b", fontFamily: "monospace" }}>{t.irsaliye_no || `TRF-${t.id?.slice(0,6)}`}</span>
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "#f5f5f4", borderRadius: 8, padding: "5px 10px", fontSize: 12.5, fontWeight: 500, color: "#44403c" }}>📍 {t.from_location}</span>
                  </td>
                  <td style={{ padding: "0 2px", textAlign: "center" }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a8a29e" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "5px 10px", fontSize: 12.5, fontWeight: 500, color: "#16a34a" }}>📍 {t.to_location}</span>
                  </td>
                  <td style={{ padding: "12px 16px", fontSize: 13, color: "#78716c" }}>
                    {Array.isArray(t.items) ? `${t.items.length} ürün` : "1 ürün"}
                  </td>
                  <td style={{ padding: "12px 16px", fontSize: 12.5, color: "#78716c" }}>{t.username}</td>
                  <td style={{ padding: "12px 16px", fontSize: 12.5, color: "#78716c", whiteSpace: "nowrap" }}>{fmt(t.created_at)}</td>
                  <td style={{ padding: "12px 16px" }}>
                    <span style={{ background: t.status === "taslak" ? "#fef9c3" : "#f0fdf4", color: t.status === "taslak" ? "#ca8a04" : "#16a34a", border: `1px solid ${t.status === "taslak" ? "#fef08a" : "#bbf7d0"}`, borderRadius: 99, padding: "3px 10px", fontSize: 11.5, fontWeight: 500, whiteSpace: "nowrap" }}>
                      {t.status === "taslak" ? "📝 Taslak" : "✓ Tamamlandı"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // ── DETAIL ────────────────────────────────────────────────────────────────────
  if (view === "detail" && selectedTransfer) {
    const t = selectedTransfer;
    const itemsList = Array.isArray(t.items) ? t.items : [{ productName: t.product_name, productSku: t.product_sku, quantity: t.quantity }];
    return (
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", background: "#18181b", borderRadius: 10, padding: "11px 18px", marginBottom: 20, gap: 8 }}>
          <button onClick={() => setView("list")} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", fontSize: 13, padding: 0, display: "flex", alignItems: "center", gap: 5 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>Transferler
          </button>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
          <span style={{ color: "#fff", fontSize: 13, fontWeight: 700, fontFamily: "monospace" }}>{t.irsaliye_no || `TRF-${t.id?.slice(0,6)}`}</span>
          <span style={{ marginLeft: "auto", background: t.status === "taslak" ? "#fef9c3" : "#dcfce7", color: t.status === "taslak" ? "#ca8a04" : "#16a34a", borderRadius: 99, padding: "3px 12px", fontSize: 12, fontWeight: 600 }}>
            {t.status === "taslak" ? "Taslak" : "Tamamlandı"}
          </span>
        </div>

        <div style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: 12, padding: 24, marginBottom: 14 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "#18181b", margin: "0 0 16px" }}>Transfer Detay</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            {[["İrsaliye No", t.irsaliye_no || "-", true], ["Oluşturan", t.username], ["Çıkış Şubesi", t.from_location], ["Giriş Şubesi", t.to_location], ["Tarih", fmt(t.created_at)], ["Not", t.note || "-"]].map(([label, val, mono]) => (
              <div key={label}>
                <div style={{ fontSize: 11, color: "#a8a29e", fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 14, color: "#18181b", fontWeight: 500, fontFamily: mono ? "monospace" : "inherit" }}>{val}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: 12, overflow: "hidden", marginBottom: 14 }}>
          <div style={{ padding: "13px 20px", borderBottom: "1px solid #f0eeed", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#18181b", margin: 0 }}>Ürünler</h3>
            <span style={{ fontSize: 12.5, color: "#a8a29e" }}>{itemsList.length} ürün</span>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ background: "#fafaf9" }}>
              {["Ürün", "SKU", "Transfer Adedi"].map(h => <th key={h} style={{ padding: "9px 16px", textAlign: "left", color: "#a8a29e", fontSize: 10.5, fontWeight: 600, textTransform: "uppercase" }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {itemsList.map((item, idx) => (
                <tr key={idx} style={{ borderTop: "1px solid #f5f5f4" }}>
                  <td style={{ padding: "11px 16px", fontSize: 13.5, fontWeight: 500, color: "#18181b" }}>{item.productName || item.product_name}</td>
                  <td style={{ padding: "11px 16px", fontSize: 12, color: "#a8a29e", fontFamily: "monospace" }}>{item.productSku || item.product_sku}</td>
                  <td style={{ padding: "11px 16px", fontSize: 15, fontWeight: 700, color: "#18181b" }}>{item.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: 12, padding: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "#18181b", margin: "0 0 16px", display: "flex", alignItems: "center", gap: 7 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            Zaman Çizelgesi
          </h3>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start", paddingLeft: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: 99, background: "#22c55e", marginTop: 6, flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: "#18181b" }}>{t.status === "taslak" ? "Taslak olarak oluşturuldu" : "Transfer tamamlandı"}</div>
              <div style={{ fontSize: 11.5, color: "#a8a29e", marginTop: 2 }}>{fmt(t.created_at)} · {t.username}</div>
            </div>
          </div>
          {Array.isArray(t.comments) && t.comments.map((c, i) => (
            <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", paddingLeft: 4, marginTop: 12 }}>
              <div style={{ width: 8, height: 8, borderRadius: 99, background: "#3b82f6", marginTop: 6, flexShrink: 0 }} />
              <div style={{ background: "#f5f5f4", borderRadius: 9, padding: "8px 12px" }}>
                <div style={{ fontSize: 13, color: "#1c1917" }}>{c.text}</div>
                <div style={{ fontSize: 11, color: "#a8a29e", marginTop: 2 }}>{c.user}</div>
              </div>
            </div>
          ))}
          <div style={{ marginTop: 16, fontSize: 11.5, color: "#a8a29e", display: "flex", alignItems: "center", gap: 5 }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
            Yorumları sadece siz ve diğer personeller görebilir
          </div>
        </div>
      </div>
    );
  }

  // ── NEW TRANSFER ──────────────────────────────────────────────────────────────
  const productSearch = itemSearch.length > 0
    ? products.filter(p =>
        (p.name.toLowerCase().includes(itemSearch.toLowerCase()) ||
        p.sku.toLowerCase().includes(itemSearch.toLowerCase()) ||
        p.barcode?.includes(itemSearch)) &&
        !transferItems.find(i => i.productId === p.id)
      ).slice(0, 8)
    : [];

  return (
    <div>
      {/* ── Black top bar ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#18181b", borderRadius: 10, padding: "11px 18px", marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => setView("list")} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", fontSize: 13, padding: 0, display: "flex", alignItems: "center", gap: 5 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
            Transferler
          </button>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
          <span style={{ color: "#fff", fontSize: 14, fontWeight: 700 }}>Transfer Ekle</span>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => doTransfer(true)} disabled={submitting}
            style={{ padding: "8px 18px", background: "transparent", border: "1px solid #404040", borderRadius: 8, color: "#d1d5db", cursor: "pointer", fontSize: 13, fontWeight: 500 }}>
            Taslak Olarak Kaydet
          </button>
          <button onClick={() => doTransfer(false)} disabled={submitting}
            style={{ padding: "8px 20px", background: "#6366f1", border: "none", borderRadius: 8, color: "#fff", cursor: submitting ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600, opacity: submitting ? 0.7 : 1 }}>
            {submitting ? "Kaydediliyor..." : "Kaydet ve Onayla"}
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>

        {/* ── Transfer Detay ── */}
        <div style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: 14, padding: 28 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: "#18181b", margin: "0 0 20px", display: "flex", alignItems: "center", gap: 7 }}>
            Transfer Detay
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#c8c4be" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          </h3>

          <div style={{ marginBottom: 18 }}>
            <label style={{ color: "#78716c", fontSize: 12, fontWeight: 500, display: "block", marginBottom: 6 }}>İrsaliye No <span style={{ color: "#ef4444" }}>*</span></label>
            <input value={irsaliyeNo} onChange={e => setIrsaliyeNo(e.target.value)}
              style={{ maxWidth: 400, ...inputStyle }} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
            <div>
              <label style={{ color: "#78716c", fontSize: 12, fontWeight: 500, display: "block", marginBottom: 6 }}>Çıkış Şubesi <span style={{ color: "#ef4444" }}>*</span></label>
              {locOptions.length > 0 ? (
                <select value={fromLoc} onChange={e => setFromLoc(e.target.value)} style={selectStyle}>
                  <option value="">Seçin...</option>
                  {locOptions.map(l => <option key={l}>{l}</option>)}
                </select>
              ) : (
                <input value={fromLoc} onChange={e => setFromLoc(e.target.value)} placeholder="Çıkış lokasyonu..." style={inputStyle} />
              )}
            </div>
            <div>
              <label style={{ color: "#78716c", fontSize: 12, fontWeight: 500, display: "block", marginBottom: 6 }}>Giriş Şubesi <span style={{ color: "#ef4444" }}>*</span></label>
              {locOptions.length > 0 ? (
                <select value={toLoc} onChange={e => setToLoc(e.target.value)}
                  style={{ ...selectStyle, borderColor: toLoc && toLoc === fromLoc ? "#fca5a5" : "#e7e5e4", background: toLoc && toLoc === fromLoc ? "#fef2f2" : "#fafaf9" }}>
                  <option value="">Seçin...</option>
                  {locOptions.filter(l => l !== fromLoc).map(l => <option key={l}>{l}</option>)}
                </select>
              ) : (
                <input value={toLoc} onChange={e => setToLoc(e.target.value)} placeholder="Giriş lokasyonu..." style={inputStyle} />
              )}
              {toLoc && toLoc === fromLoc && (
                <div style={{ marginTop: 6, fontSize: 12, color: "#dc2626", display: "flex", alignItems: "center", gap: 5 }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  Çıkış ve giriş şubesi aynı olamaz
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Ürünler ── */}
        <div style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: 14, padding: 28 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: "#18181b", margin: 0, display: "flex", alignItems: "center", gap: 7 }}>
              Ürünler
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#c8c4be" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            </h3>
            {/* Barkod Button */}
            <div style={{ position: "relative" }}>
              <button onClick={barcodeActive ? deactivateBarcode : activateBarcode}
                style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 14px", background: barcodeActive ? "#18181b" : "#fafaf9", border: `1px solid ${barcodeActive ? "#18181b" : "#e7e5e4"}`, borderRadius: 8, color: barcodeActive ? "#fff" : "#44403c", cursor: "pointer", fontSize: 13, fontWeight: 500, transition: "all 0.15s" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><line x1="14" y1="14" x2="21" y2="14"/><line x1="14" y1="18" x2="21" y2="18"/><line x1="14" y1="21" x2="17" y2="21"/></svg>
                {barcodeActive ? "● Aktif" : "Barkod ile Okut"}
              </button>
            </div>
          </div>

          {/* Product search dropdown */}
          <div style={{ position: "relative", marginBottom: 16 }}>
            <svg style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)" }} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#a8a29e" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input ref={itemSearchRef} value={itemSearch} onChange={e => setItemSearch(e.target.value)} placeholder="Ürün ara.."
              style={{ background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 9, padding: "9px 12px 9px 32px", color: "#1c1917", fontSize: 13.5, outline: "none", fontFamily: "inherit", width: 260 }} />
            {productSearch.length > 0 && (
              <div style={{ position: "absolute", top: "100%", left: 0, width: 320, background: "#fff", border: "1px solid #e7e5e4", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.1)", zIndex: 200, marginTop: 4, overflow: "hidden" }}>
                {productSearch.map(p => (
                  <div key={p.id} onClick={() => addItem(p)}
                    style={{ padding: "10px 14px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #f5f5f4" }}
                    onMouseEnter={e => e.currentTarget.style.background = "#fafaf9"}
                    onMouseLeave={e => e.currentTarget.style.background = "#fff"}>
                    <div>
                      <div style={{ fontSize: 13.5, fontWeight: 500, color: "#18181b" }}>{p.name}</div>
                      <div style={{ fontSize: 11.5, color: "#a8a29e", fontFamily: "monospace" }}>{p.sku} · Stok: {p.stock}{p.location ? ` · ${p.location}` : ""}</div>
                    </div>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a8a29e" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Barcode active overlay */}
          {barcodeActive && (
            <div style={{ background: "#f0fdf4", border: "2px solid #86efac", borderRadius: 10, padding: "12px 16px", marginBottom: 14, display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 8, height: 8, borderRadius: 99, background: "#22c55e", animation: "pulse 1.5s infinite", flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#15803d" }}>Barkod Okuyucu Aktif</div>
                <div style={{ fontSize: 12, color: "#16a34a", marginTop: 2 }}>Barkod tabancasıyla okutun (Enter ile onaylayın) veya kamera kullanın</div>
              </div>
              <input ref={barcodeRef} value={barcodeInput} onChange={e => setBarcodeInput(e.target.value)} onKeyDown={addByBarcode}
                placeholder="Barkodu okutun..."
                autoFocus
                style={{ background: "#fff", border: "1px solid #86efac", borderRadius: 8, padding: "7px 12px", color: "#1c1917", fontSize: 13.5, outline: "none", fontFamily: "inherit", width: 200, fontWeight: 500 }} />
              <button onClick={() => setShowBarcodeCamera(true)}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 13px", background: "#18181b", border: "none", borderRadius: 8, color: "#fff", cursor: "pointer", fontSize: 12.5, fontWeight: 500, flexShrink: 0 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
                Kamera
              </button>
              <button onClick={deactivateBarcode}
                style={{ width: 28, height: 28, background: "#dcfce7", border: "none", borderRadius: 7, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#16a34a", flexShrink: 0 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          )}

          {/* Camera scanner modal */}
          {showBarcodeCamera && (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ background: "#fff", borderRadius: 16, overflow: "hidden", width: "min(480px, 95vw)", boxShadow: "0 24px 64px rgba(0,0,0,0.4)" }}>
                <div style={{ background: "#18181b", padding: "12px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ color: "#fff", fontSize: 14, fontWeight: 600 }}>📷 Barkod Tara</span>
                  <button onClick={() => setShowBarcodeCamera(false)} style={{ background: "none", border: "none", color: "#9ca3af", cursor: "pointer", fontSize: 20, lineHeight: 1 }}>×</button>
                </div>
                <CameraScanner
                  onDetected={handleBarcodeCameraDetect}
                  onClose={() => setShowBarcodeCamera(false)}
                  recentScans={[]}
                />
              </div>
            </div>
          )}

          {/* Items table */}
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f9f9f8", borderRadius: 8 }}>
                {["Ürün", "Çıkış Şube Stoğu", "Transfer Adedi", ""].map(h => (
                  <th key={h} style={{ padding: "9px 14px", textAlign: "left", color: "#a8a29e", fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", borderBottom: "1px solid #f0eeed" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {transferItems.length === 0 ? (
                <tr><td colSpan={4} style={{ padding: "32px 14px", textAlign: "center", color: "#a8a29e", fontSize: 13 }}>
                  Yukarıdan ürün arayın veya barkod ile ekleyin
                </td></tr>
              ) : transferItems.map(item => {
                const p = products.find(pr => pr.id === item.productId);
                if (!p) return null;
                const bad = item.quantity > p.stock;
                return (
                  <tr key={item.productId} style={{ borderBottom: "1px solid #f5f5f4", background: bad ? "#fffbeb" : "#fff" }}>
                    <td style={{ padding: "11px 14px" }}>
                      <div style={{ fontSize: 13.5, fontWeight: 500, color: "#18181b" }}>{p.name}</div>
                      <div style={{ fontSize: 11.5, color: "#a8a29e", fontFamily: "monospace" }}>{p.sku}</div>
                    </td>
                    <td style={{ padding: "11px 14px" }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: p.stock > 0 ? "#18181b" : "#ef4444" }}>{p.stock}</span>
                      {p.location && <span style={{ fontSize: 11.5, color: "#a8a29e", marginLeft: 6 }}>({p.location})</span>}
                    </td>
                    <td style={{ padding: "11px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <button onClick={() => updateQty(item.productId, item.quantity - 1)}
                          style={{ width: 28, height: 28, borderRadius: 7, border: "1px solid #e7e5e4", background: "#fafaf9", cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center", color: "#44403c", lineHeight: 1 }}>−</button>
                        <input type="number" min="0" value={item.quantity} onChange={e => updateQty(item.productId, parseInt(e.target.value) || 0)}
                          style={{ width: 64, textAlign: "center", background: bad ? "#fef3c7" : "#fafaf9", border: `1px solid ${bad ? "#fcd34d" : "#e7e5e4"}`, borderRadius: 8, padding: "5px", color: bad ? "#92400e" : "#1c1917", fontSize: 14, fontWeight: 700, outline: "none", fontFamily: "inherit" }} />
                        <button onClick={() => updateQty(item.productId, item.quantity + 1)}
                          style={{ width: 28, height: 28, borderRadius: 7, border: "1px solid #e7e5e4", background: "#fafaf9", cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center", color: "#44403c", lineHeight: 1 }}>+</button>
                        {bad && <span style={{ fontSize: 11, color: "#d97706", fontWeight: 500 }}>⚠ Yetersiz</span>}
                      </div>
                    </td>
                    <td style={{ padding: "11px 14px" }}>
                      <button onClick={() => removeItem(item.productId)}
                        style={{ width: 28, height: 28, background: "#fef2f2", border: "none", borderRadius: 7, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#dc2626" }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── Zaman Çizelgesi ── */}
        <div style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: 14, padding: 28 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: "#18181b", margin: "0 0 18px", display: "flex", alignItems: "center", gap: 7 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            Zaman Çizelgesi
          </h3>

          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
            <div style={{ width: 34, height: 34, borderRadius: 99, background: "#f0f9ff", border: "1px solid #bfdbfe", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 12, fontWeight: 700, color: "#3b82f6" }}>
              {(user.name || user.username || "").slice(0,2).toUpperCase()}
            </div>
            <div style={{ flex: 1, position: "relative" }}>
              <input value={comment} onChange={e => setComment(e.target.value)} onKeyDown={e => e.key === "Enter" && sendComment()}
                placeholder="Yorum yaz..."
                style={{ width: "100%", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 9, padding: "9px 80px 9px 14px", color: "#1c1917", fontSize: 13.5, outline: "none", fontFamily: "inherit" }} />
              <button onClick={sendComment}
                style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", padding: "5px 12px", background: comment.trim() ? "#6366f1" : "#f0eeed", border: "none", borderRadius: 7, color: comment.trim() ? "#fff" : "#a8a29e", cursor: comment.trim() ? "pointer" : "default", fontSize: 12, fontWeight: 600, transition: "all 0.15s" }}>
                Gönder
              </button>
            </div>
          </div>

          <div style={{ fontSize: 11.5, color: "#a8a29e", display: "flex", alignItems: "center", gap: 5, marginBottom: comments.length > 0 ? 16 : 0 }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
            Yorumları sadece siz ve diğer personeller görebilir
          </div>

          {comments.length === 0 && (
            <div style={{ textAlign: "center", padding: "24px 0 8px" }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: "#f0f0ee", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 8px", fontSize: 20 }}>⚡</div>
              <div style={{ fontSize: 13, color: "#a8a29e" }}>Veri Yok</div>
            </div>
          )}

          {comments.map((c, i) => (
            <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 12 }}>
              <div style={{ width: 28, height: 28, borderRadius: 99, background: "#f0f9ff", border: "1px solid #bfdbfe", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#3b82f6", flexShrink: 0 }}>
                {c.user.slice(0,2).toUpperCase()}
              </div>
              <div style={{ background: "#f5f5f4", borderRadius: 9, padding: "9px 13px", flex: 1 }}>
                <div style={{ fontSize: 13, color: "#1c1917" }}>{c.text}</div>
                <div style={{ fontSize: 11, color: "#a8a29e", marginTop: 2 }}>{c.user}</div>
              </div>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}


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

        .table-row:hover td, .table-row:hover { background: #fafaf9 !important; } @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        .table-row:nth-child(even) { background: transparent !important; }

        .btn-hover { transition: all 0.12s ease !important; }
        .table-row:hover { background: #fafaf9 !important; } .btn-hover:hover { opacity: 0.9; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,0.12) !important; }
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
  const [locations, setLocations] = useState(() => { try { return JSON.parse(localStorage.getItem("stokpro_locations")) || []; } catch { return []; } });
  const [notification, setNotification] = useState(null);
  const [loading, setLoading] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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

        // Load shared settings (categories/brands) from Supabase
        const { data: settingsData } = await supabase
          .from("app_settings")
          .select("*");
        if (settingsData) {
          const cats = settingsData.find(s => s.key === "categories");
          const brnds = settingsData.find(s => s.key === "brands");
          if (cats?.value) { setCategories(cats.value); localStorage.setItem("stokpro_cats", JSON.stringify(cats.value)); }
          if (brnds?.value) { setBrands(brnds.value); localStorage.setItem("stokpro_brands", JSON.stringify(brnds.value)); }
          const locs = settingsData.find(s => s.key === "locations");
          if (locs?.value) { setLocations(locs.value); localStorage.setItem("stokpro_locations", JSON.stringify(locs.value)); }
        }
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

  const renderPage = () => {
    switch(page) {
      case "dashboard": return <Dashboard products={products} movements={movements} criticalProducts={criticalProducts} setPage={setPage} />;
      case "products": return <ProductsPage products={products} setProducts={setProducts} movements={movements} setMovements={setMovements} user={user} notify={notify} categories={categories} brands={brands} locations={locations} />;
      case "movements": return <MovementsPage movements={movements} products={products} setMovements={setMovements} setProducts={setProducts} user={user} notify={notify} />;
      case "transfers": return <TransfersPage products={products} setProducts={setProducts} setMovements={setMovements} user={user} notify={notify} locations={locations} />;
      case "sevkiyat": return <SevkiyatPage products={products} setProducts={setProducts} setMovements={setMovements} user={user} notify={notify} />;
      case "ikas": return <IkasPage products={products} setProducts={setProducts} movements={movements} user={user} notify={notify} />;
      case "counting": return <CountingPage products={products} setProducts={setProducts} movements={movements} setMovements={setMovements} user={user} notify={notify} categories={categories} brands={brands} />;
      case "reports": return <ReportsPage products={products} movements={movements} criticalProducts={criticalProducts} />;
      case "settings": return <SettingsPage user={user} setUser={setUser} appUsers={appUsers} setAppUsers={setAppUsers} notify={notify} categories={categories} setCategories={setCategories} brands={brands} setBrands={setBrands} locations={locations} setLocations={setLocations} />;
      case "purchasing": return <PurchasingPage suppliers={suppliers} setSuppliers={setSuppliers} purchaseOrders={purchaseOrders} setPurchaseOrders={setPurchaseOrders} products={products} setProducts={setProducts} setMovements={setMovements} user={user} notify={notify} />;
      case "shipment": return <ShipmentPage products={products} setProducts={setProducts} setMovements={setMovements} user={user} notify={notify} />;
      default: return <Dashboard products={products} movements={movements} criticalProducts={criticalProducts} setPage={setPage} />;
    }
  };

  const navItems = [
    { id: "dashboard", label: "Özet", icon: "dashboard" },
    { id: "products", label: "Ürünler", icon: "products" },
    { id: "movements", label: "Hareketler", icon: "movements" },
    { id: "transfers", label: "Transferler", icon: "transfer" },
    { id: "counting", label: "Sayım", icon: "scan" },
    { id: "purchasing", label: "Satın Alma", icon: "purchasing" },
    { id: "reports", label: "Raporlar", icon: "reports" },
    { id: "settings", label: "Ayarlar", icon: "settings" },
    { id: "shipment", label: "Sevkiyat", icon: "shipment" },
    { id: "ikas", label: "İkas", icon: "ikas" },
  ];
  const mobileNavItems = [
    { id: "dashboard", label: "Özet", icon: "dashboard" },
    { id: "products", label: "Ürünler", icon: "products" },
    { id: "movements", label: "Hareket", icon: "movements" },
    { id: "counting", label: "Sayım", icon: "scan" },
    { id: "more", label: "Daha", icon: "settings" },
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

        /* ── Mobile ── */
        @media (max-width: 768px) {
          .desktop-sidebar { display: none !important; }
          .mobile-nav { display: flex !important; }
          .main-content { margin-left: 0 !important; padding: 70px 14px 80px !important; }
          .stat-grid-4 { grid-template-columns: repeat(2,1fr) !important; }
          .stat-grid-3 { grid-template-columns: 1fr !important; }
          .chart-row { grid-template-columns: 1fr !important; }
          .two-col { grid-template-columns: 1fr !important; }
          .counting-layout { grid-template-columns: 1fr !important; }
          .counting-sidebar { display: none !important; }
          .hide-mobile { display: none !important; }
          .table-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
        }
        @media (min-width: 769px) {
          .mobile-nav { display: none !important; }
          .mobile-menu-overlay { display: none !important; }
        }
      `}</style>

      {/* Sidebar */}
      <aside className="desktop-sidebar" style={{ width: 220, background: "#fff", borderRight: "1px solid #e7e5e4", display: "flex", flexDirection: "column", position: "fixed", height: "100vh", zIndex: 100 }}>
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
      <main className="main-content" style={{ flex: 1, marginLeft: 220, padding: "28px 32px", overflow: "auto", background: "#fafaf9", minHeight: "100vh" }}>
        {renderPage()}
      </main>

      {/* Notification */}
      {notification && (
        <div style={{ position: "fixed", top: 20, right: 20, left: 20, background: notification.type === "success" ? "#166534" : "#991b1b", border: `1px solid ${notification.type === "success" ? "#16a34a" : "#dc2626"}`, borderRadius: 12, padding: "12px 20px", color: "#fff", fontSize: 14, fontWeight: 500, animation: "slideIn 0.2s ease", zIndex: 9999, display: "flex", alignItems: "center", gap: 8, maxWidth: 420, margin: "0 auto" }}>
          {notification.type === "success" ? <Icon name="check" size={16} /> : <Icon name="warning" size={16} />}
          {notification.msg}
        </div>
      )}

      {/* Mobile top bar */}
      <div className="mobile-nav" style={{ position: "fixed", top: 0, left: 0, right: 0, height: 54, background: "#fff", borderBottom: "1px solid #e7e5e4", zIndex: 200, alignItems: "center", justifyContent: "space-between", padding: "0 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div style={{ width: 26, height: 26, background: "#18181b", borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
          </div>
          <span style={{ fontWeight: 700, fontSize: 15, color: "#18181b" }}>StokPro</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {criticalProducts.length > 0 && (
            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 7, padding: "3px 8px", fontSize: 11.5, fontWeight: 600, color: "#dc2626" }}>
              ⚠ {criticalProducts.length} kritik
            </div>
          )}
          <span style={{ fontSize: 12.5, color: "#78716c", fontWeight: 500 }}>{user.name}</span>
        </div>
      </div>

      {/* Mobile bottom nav */}
      <div className="mobile-nav" style={{ position: "fixed", bottom: 0, left: 0, right: 0, height: 64, background: "#fff", borderTop: "1px solid #e7e5e4", zIndex: 200, alignItems: "center", justifyContent: "space-around", padding: "0 4px", paddingBottom: "env(safe-area-inset-bottom)" }}>
        {mobileNavItems.map(item => {
          const isActive = item.id === "more" ? ["purchasing","reports","settings"].includes(page) : page === item.id;
          return (
            <button key={item.id}
              onClick={() => {
                if (item.id === "more") setMobileMenuOpen(true);
                else { setPage(item.id); setMobileMenuOpen(false); }
              }}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "6px 12px", background: "none", border: "none", cursor: "pointer", color: isActive ? "#18181b" : "#a8a29e", flex: 1 }}>
              <div style={{ position: "relative" }}>
                <Icon name={item.icon} size={20} />
                {item.id === "products" && criticalProducts.length > 0 && (
                  <div style={{ position: "absolute", top: -4, right: -6, width: 14, height: 14, background: "#ef4444", borderRadius: 99, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ fontSize: 8, color: "#fff", fontWeight: 700 }}>{criticalProducts.length > 9 ? "9+" : criticalProducts.length}</span>
                  </div>
                )}
              </div>
              <span style={{ fontSize: 10, fontWeight: isActive ? 600 : 400 }}>{item.label}</span>
              {isActive && <div style={{ position: "absolute", bottom: 0, width: 20, height: 2, background: "#18181b", borderRadius: 99 }} />}
            </button>
          );
        })}
      </div>

      {/* Mobile slide-over menu */}
      {mobileMenuOpen && (
        <>
          <div onClick={() => setMobileMenuOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 300 }} />
          <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#fff", borderRadius: "20px 20px 0 0", zIndex: 301, padding: "20px 16px", paddingBottom: "calc(16px + env(safe-area-inset-bottom))" }}>
            <div style={{ width: 36, height: 4, background: "#e7e5e4", borderRadius: 99, margin: "0 auto 20px" }} />
            <div style={{ fontSize: 11, fontWeight: 600, color: "#a8a29e", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10, paddingLeft: 4 }}>Menü</div>
            {[
              { id: "purchasing", label: "Satın Alma", icon: "purchasing" },
              { id: "reports", label: "Raporlar", icon: "reports" },
              { id: "settings", label: "Ayarlar", icon: "settings" },
            ].map(item => (
              <button key={item.id} onClick={() => { setPage(item.id); setMobileMenuOpen(false); }}
                style={{ display: "flex", alignItems: "center", gap: 13, width: "100%", padding: "13px 14px", background: page === item.id ? "#f5f5f4" : "transparent", border: "none", borderRadius: 11, cursor: "pointer", marginBottom: 4, color: "#1c1917", fontSize: 15, fontWeight: page === item.id ? 600 : 400 }}>
                <div style={{ width: 36, height: 36, borderRadius: 9, background: page === item.id ? "#18181b" : "#f5f5f4", display: "flex", alignItems: "center", justifyContent: "center", color: page === item.id ? "#fff" : "#78716c" }}>
                  <Icon name={item.icon} size={17} />
                </div>
                {item.label}
                {page === item.id && <span style={{ marginLeft: "auto", color: "#18181b" }}>✓</span>}
              </button>
            ))}
            <div style={{ borderTop: "1px solid #f5f5f4", marginTop: 8, paddingTop: 12 }}>
              <button onClick={handleLogout} style={{ display: "flex", alignItems: "center", gap: 13, width: "100%", padding: "13px 14px", background: "transparent", border: "none", borderRadius: 11, cursor: "pointer", color: "#dc2626", fontSize: 15 }}>
                <div style={{ width: 36, height: 36, borderRadius: 9, background: "#fef2f2", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon name="logout" size={17} color="#dc2626" />
                </div>
                Çıkış Yap
              </button>
            </div>
          </div>
        </>
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
      <div className="stat-grid-4" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 12 }}>
        <StatCard title="Toplam Ürün" value={products.length} sub="Tanımlı ürün" icon="products" color="#3b82f6" />
        <StatCard title="Toplam Stok" value={totalStock.toLocaleString("tr-TR")} sub="Tüm ürünler" icon="inventory" color="#44403c" />
        <StatCard title="Kritik Stok" value={criticalProducts.length} sub="Min. seviye altı" icon="warning" color={criticalProducts.length > 0 ? "#dc2626" : "#16a34a"} />
        <StatCard title="Bugünkü Hareket" value={todayMoves.length} sub="Giriş/Çıkış" icon="movements" color="#f59e0b" />
      </div>

      {/* Financial Cards */}
      <div className="stat-grid-3" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 16 }}>
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
      <div className="chart-row" style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 12, marginBottom: 12 }}>

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
      <div className="two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
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
function ProductsPage({ products, setProducts, movements, setMovements, user, notify, categories, brands, locations }) {
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("");
  const [filterLoc, setFilterLoc] = useState("");
  const [bulkLocModal, setBulkLocModal] = useState(false);
  const [bulkLocValue, setBulkLocValue] = useState("");
  const [modal, setModal] = useState(null); // null | "add" | "edit" | "view" | "move" | "bulkMove"
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({});
  const [moveForm, setMoveForm] = useState({ type: "Giriş", quantity: "", note: "" });
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkMoveForm, setBulkMoveForm] = useState({ type: "Giriş", quantity: "", note: "" });
  const [confirmDelete, setConfirmDelete] = useState(false);

  const canEdit = user.role !== "viewer";

  const bulkAssignLocation = async () => {
    if (!bulkLocValue) { notify("Lokasyon seçin", "error"); return; }
    const targets = selectedIds.size > 0 ? [...selectedIds] : products.filter(p => !p.location).map(p => p.id);
    if (targets.length === 0) { notify("Atanacak ürün yok", "error"); return; }
    for (let i = 0; i < targets.length; i += 50) {
      const batch = targets.slice(i, i + 50);
      await supabase.from("products").update({ location: bulkLocValue }).in("id", batch);
    }
    setProducts(prev => prev.map(p => targets.includes(p.id) ? { ...p, location: bulkLocValue } : p));
    notify(`${targets.length} ürüne "${bulkLocValue}" lokasyonu atandı`);
    setBulkLocModal(false);
    setBulkLocValue("");
  };

  const filtered = products.filter(p => {
    const s = search.toLowerCase();
    return (!s || p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s) || p.barcode.includes(s)) &&
      (!filterCat || p.category === filterCat) &&
      (!filterLoc || (filterLoc === "__none__" ? !p.location : p.location === filterLoc));
  });

  const openAdd = () => { setForm({ name: "", sku: "", barcode: "", category: "", brand: "", variant: "", minStock: 5, description: "", stock: 0, costPrice: "", salePrice: "", vatRate: 20 }); setModal("add"); };
  const openEdit = (p) => { setForm({ ...p, costPrice: p.costPrice || "", salePrice: p.salePrice || "", vatRate: p.vatRate || 20 }); setSelected(p); setModal("edit"); };
  const openView = (p) => { setSelected(p); setModal("view"); };
  const openMove = (p) => { setSelected(p); setMoveForm({ type: "Giriş", quantity: "", note: "" }); setModal("move"); };

  const saveProduct = async () => {
    if (!form.name || !form.sku) { notify("Ürün adı ve SKU zorunludur", "error"); return; }
    const dbObj = {
      name: form.name, sku: form.sku, barcode: form.barcode || "",
      category: form.category || "", brand: form.brand || "", location: form.location || "", variant: form.variant || "",
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
      Kategori: p.category, Marka: p.brand, Lokasyon: p.location || "",
      Varyant: p.variant, "Mevcut Stok": p.stock, "Min Stok": p.minStock,
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
      const headers = ["Ürün Adı *", "SKU *", "Barkod", "Kategori", "Marka", "Lokasyon", "Varyant", "Mevcut Stok", "Min Stok", "Maliyet Fiyatı", "Satış Fiyatı (KDV Dahil)", "KDV Oranı %", "Açıklama"];
      const sample = [["Örnek Ürün 1", "URN-001", "1234567890123", "Elektronik", "Samsung", "Ana Depo", "Siyah / 128GB", 50, 10, 100, 250, 20, "Açıklama"], ["Örnek Ürün 2", "URN-002", "", "Giyim", "Nike", "Mağaza", "Beyaz / 42", 30, 5, 200, 450, 20, ""]];
      const ws = XLSX.utils.aoa_to_sheet([headers, ...sample]);
      ws["!cols"] = [35, 20, 20, 18, 15, 18, 20, 14, 10, 18, 22, 12, 30].map(w => ({ wch: w }));
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
        location: headers.findIndex(h => h.includes("Lokasyon") || h.toLowerCase() === "location"),
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
          location: colMap.location >= 0 ? String(row[colMap.location] || "") : "",
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
        location: headers.findIndex(h => h.includes("Lokasyon") || h.toLowerCase() === "location"),
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
          location: colMap.location >= 0 ? (cols[colMap.location]?.replace(/^"|"$/g, "") || "") : "",
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
              <button onClick={() => { setBulkLocValue(""); setBulkLocModal(true); }} className="btn-hover"
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 18px", background: "rgba(3,105,161,0.1)", border: "1px solid rgba(3,105,161,0.2)", borderRadius: 9, color: "#0369a1", cursor: "pointer", fontSize: 13, fontWeight: 500 }}>
                📍 Toplu Lokasyon
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
        <select value={filterLoc} onChange={e => setFilterLoc(e.target.value)}
          style={{ background: "rgba(0,0,0,0.02)", border: "1px solid #e7e5e4", borderRadius: 10, padding: "10px 14px", color: "#78716c", fontSize: 14, outline: "none" }}>
          <option value="">Tüm Lokasyonlar</option>
          <option value="__none__">📭 Lokasyonsuz</option>
          {locations.map(l => <option key={l.name||l} value={l.name||l}>{l.name||l}</option>)}
        </select>
        {products.filter(p => !p.location).length > 0 && (
          <button onClick={() => setBulkLocModal(true)}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 14px", background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 10, color: "#c2410c", cursor: "pointer", fontSize: 13, fontWeight: 500, whiteSpace: "nowrap" }}>
            ⚠️ {products.filter(p => !p.location).length} ürün lokasyonsuz
          </button>
        )}
      </div>

      <div style={{ background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 14, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #e7e5e4" }}>
              <th style={{ padding: "12px 12px", width: 40 }}>
                <input type="checkbox" checked={filtered.length > 0 && selectedIds.size === filtered.length} onChange={toggleSelectAll} style={{ cursor: "pointer", accentColor: "#3b82f6", width: 15, height: 15 }} />
              </th>
              {["Ürün Adı", "SKU", "Kategori", "Marka", "Lokasyon", "Maliyet", "Satış", "Marj", "Stok", "Min", "Durum", ""].map(h => (
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
                <td style={{ padding: "13px 16px" }}>
                  {p.location ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 99, padding: "2px 8px", fontSize: 11.5, fontWeight: 500, color: "#0369a1", whiteSpace: "nowrap" }}>
                      📍 {p.location}
                    </span>
                  ) : <span style={{ color: "#e7e5e4" }}>—</span>}
                </td>
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

      {/* Bulk Location Modal */}
      {bulkLocModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 460, boxShadow: "0 24px 64px rgba(0,0,0,0.18)", overflow: "hidden" }}>
            <div style={{ padding: "20px 24px", borderBottom: "1px solid #f0eeed" }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#18181b" }}>Toplu Lokasyon Ata</div>
              <div style={{ fontSize: 13, color: "#a8a29e", marginTop: 4 }}>
                {selectedIds.size > 0
                  ? `Seçili ${selectedIds.size} ürüne lokasyon atanacak`
                  : `Lokasyonsuz ${products.filter(p => !p.location).length} ürüne lokasyon atanacak`}
              </div>
            </div>
            <div style={{ padding: 24 }}>
              <label style={{ color: "#78716c", fontSize: 12, fontWeight: 500, display: "block", marginBottom: 8 }}>Lokasyon Seç</label>
              {locations.length > 0 ? (
                <select value={bulkLocValue} onChange={e => setBulkLocValue(e.target.value)}
                  style={{ width: "100%", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 9, padding: "11px 14px", fontSize: 14, outline: "none", fontFamily: "inherit", color: bulkLocValue ? "#1c1917" : "#a8a29e", cursor: "pointer" }}>
                  <option value="">Lokasyon seçin...</option>
                  {locations.map(l => {
                    const name = l.name || l;
                    const icons = { depo: "🏭", magaza: "🏪", raf: "📦", diger: "📍" };
                    return <option key={name} value={name}>{icons[l.type] || "📍"} {name}</option>;
                  })}
                </select>
              ) : (
                <input value={bulkLocValue} onChange={e => setBulkLocValue(e.target.value)}
                  placeholder="Lokasyon adı girin..."
                  style={{ width: "100%", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 9, padding: "11px 14px", fontSize: 14, outline: "none", fontFamily: "inherit", color: "#1c1917" }} />
              )}
              <div style={{ marginTop: 14, background: "#fafaf9", borderRadius: 10, padding: "12px 16px", fontSize: 13, color: "#78716c", display: "flex", gap: 8 }}>
                <span>💡</span>
                <span>Bu işlem mevcut lokasyonu olan ürünlerin lokasyonunu <strong>değiştirmez</strong>, yalnızca lokasyonsuz ürünlere atar. Belirli ürünler için önce tablodan seçim yapabilirsiniz.</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, padding: "16px 24px", borderTop: "1px solid #f0eeed", background: "#fafaf9" }}>
              <button onClick={() => { setBulkLocModal(false); setBulkLocValue(""); }}
                style={{ flex: 1, padding: "10px", background: "#fff", border: "1px solid #e7e5e4", borderRadius: 9, color: "#44403c", cursor: "pointer", fontSize: 14, fontWeight: 500 }}>İptal</button>
              <button onClick={bulkAssignLocation}
                style={{ flex: 2, padding: "10px", background: "#18181b", border: "none", borderRadius: 9, color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600 }}>
                Lokasyonu Ata
              </button>
            </div>
          </div>
        </div>
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
            <Field label="Stok Lokasyonu" field="location" options={locations.map(l => l.name || l)} />
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
      return true;
    } else {
      notify(`❌ Barkod bulunamadı: ${code}`, "error");
      return false;
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

      {showCamera && <CameraScanner onDetected={handleCameraDetect} onClose={() => setShowCamera(false)} recentScans={lastScanned} />}

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
  const [phase, setPhase] = useState("setup"); // setup | counting | results | history
  const [filter, setFilter] = useState({ category: "", brand: "" });
  const [countList, setCountList] = useState({}); // { productId: count }
  const [barcodeInput, setBarcodeInput] = useState("");
  const [countName, setCountName] = useState(`Sayım ${new Date().toLocaleDateString("tr-TR")}`);
  const [showCamera, setShowCamera] = useState(false);
  const [lastScanned, setLastScanned] = useState([]);
  const [countSearch, setCountSearch] = useState("");
  const [countHistory, setCountHistory] = useState([]);
  const [historyDetail, setHistoryDetail] = useState(null); // selected session
  const [historyLoading, setHistoryLoading] = useState(false);
  const barcodeRef = useRef(null);

  const canEdit = user.role !== "viewer";

  const filteredProducts = products.filter(p =>
    (!filter.category || p.category === filter.category) &&
    (!filter.brand || p.brand === filter.brand)
  );

  // Load history on mount
  useEffect(() => { loadHistory(); }, []);

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
      return true;
    } else if (product) {
      notify("⚠️ Bu ürün sayım listesinde değil", "error");
      return false;
    } else {
      notify(`❌ Barkod bulunamadı: ${code}`, "error");
      return false;
    }
  };

  const adjustCount = (id, delta) => setCountList(prev => ({ ...prev, [id]: Math.max(0, (prev[id] || 0) + delta) }));
  const setCount = (id, val) => setCountList(prev => ({ ...prev, [id]: Math.max(0, parseInt(val) || 0) }));

  const diffs = filteredProducts.map(p => ({ ...p, counted: countList[p.id] || 0, diff: (countList[p.id] || 0) - p.stock }));
  const hasDiffs = diffs.some(d => d.diff !== 0);

  const loadHistory = async () => {
    setHistoryLoading(true);
    const { data } = await supabase.from("count_sessions").select("*").order("created_at", { ascending: false }).limit(50);
    if (data) setCountHistory(data);
    setHistoryLoading(false);
  };

  const applyDiffs = async () => {
    const changed = diffs.filter(d => d.diff !== 0);
    for (const d of changed) {
      await supabase.from("products").update({ stock: d.counted }).eq("id", d.id);
      await supabase.from("movements").insert([{ product_id: d.id, product_name: d.name, type: "Sayım Farkı", quantity: Math.abs(d.diff), prev_stock: d.stock, next_stock: d.counted, username: user.username, note: `Sayım: ${countName}` }]);
    }
    // Save count session to history
    const sessionData = {
      name: countName,
      username: user.username,
      total_products: filteredProducts.length,
      counted_products: Object.values(countList).filter(v => v > 0).length,
      diff_count: changed.length,
      items: diffs.map(d => ({ id: d.id, name: d.name, sku: d.sku, barcode: d.barcode, system_stock: d.stock, counted: d.counted, diff: d.diff })),
      filter_category: filter.category || "Tümü",
      filter_brand: filter.brand || "Tümü",
      applied: true,
    };
    await supabase.from("count_sessions").insert([sessionData]);
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

  const saveSessionWithoutApplying = async () => {
    const sessionData = {
      name: countName,
      username: user.username,
      total_products: filteredProducts.length,
      counted_products: Object.values(countList).filter(v => v > 0).length,
      diff_count: diffs.filter(d => d.diff !== 0).length,
      items: diffs.map(d => ({ id: d.id, name: d.name, sku: d.sku, barcode: d.barcode, system_stock: d.stock, counted: d.counted, diff: d.diff })),
      filter_category: filter.category || "Tümü",
      filter_brand: filter.brand || "Tümü",
      applied: false,
    };
    await supabase.from("count_sessions").insert([sessionData]);
    notify("Sayım kaydedildi");
    setPhase("setup");
    setCountList({});
  };

  const exportDiffs = () => downloadCSV(diffs.map(d => ({ "Ürün Adı": d.name, SKU: d.sku, "Sistem Stoğu": d.stock, "Sayılan": d.counted, Fark: d.diff, Durum: d.diff > 0 ? "Fazla" : d.diff < 0 ? "Eksik" : "Eşleşti" })), `sayim-${countName}.csv`);

  if (phase === "setup") {
    const fmt = (d) => new Date(d).toLocaleString("tr-TR", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" });
    return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 21, fontWeight: 700, margin: 0, letterSpacing: "-0.03em", color: "#18181b" }}>Stok Sayımları</h1>
        </div>
        {canEdit && (
          <button onClick={() => setPhase("new")}
            style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 18px", background: "#18181b", border: "none", borderRadius: 9, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Stok Sayımı Ekle
          </button>
        )}
      </div>

      {/* Search bar */}
      <div style={{ position: "relative", marginBottom: 14 }}>
        <svg style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#a8a29e" }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input value={countSearch} onChange={e => setCountSearch(e.target.value)} placeholder="Tabloda arama yapın"
          style={{ width: "100%", background: "#fff", border: "1px solid #e7e5e4", borderRadius: 9, padding: "9px 12px 9px 36px", color: "#1c1917", fontSize: 13.5, outline: "none", fontFamily: "inherit" }} />
      </div>

      {/* Table */}
      <div style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#fafaf9", borderBottom: "1px solid #f0eeed" }}>
              {["Ad", "Başlangıç Tarihi", "Kategori", "Marka", "Durum", "Oluşturan", "Ürün Sayısı"].map(h => (
                <th key={h} style={{ padding: "10px 16px", textAlign: "left", color: "#a8a29e", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {historyLoading ? (
              <tr><td colSpan={7} style={{ padding: 32, textAlign: "center", color: "#a8a29e", fontSize: 13 }}>Yükleniyor...</td></tr>
            ) : countHistory.filter(s => !countSearch || s.name.toLowerCase().includes(countSearch.toLowerCase()) || s.username.toLowerCase().includes(countSearch.toLowerCase())).length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: 48, textAlign: "center" }}>
                  <div style={{ fontSize: 28, marginBottom: 10 }}>📋</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#18181b", marginBottom: 4 }}>Henüz sayım yapılmamış</div>
                  <div style={{ fontSize: 13, color: "#a8a29e" }}>Sağ üstten yeni sayım ekleyebilirsiniz</div>
                </td>
              </tr>
            ) : (
              countHistory.filter(s => !countSearch || s.name.toLowerCase().includes(countSearch.toLowerCase()) || s.username.toLowerCase().includes(countSearch.toLowerCase())).map(s => (
                <tr key={s.id} onClick={() => setHistoryDetail(s)} className="table-row"
                  style={{ borderBottom: "1px solid #f5f5f4", cursor: "pointer" }}>
                  <td style={{ padding: "13px 16px" }}>
                    <div style={{ fontSize: 13.5, fontWeight: 500, color: "#18181b" }}>{s.name}</div>
                  </td>
                  <td style={{ padding: "13px 16px", whiteSpace: "nowrap" }}>
                    <div style={{ fontSize: 13, color: "#1c1917" }}>{fmt(s.created_at).split(" ")[0]} {fmt(s.created_at).split(" ")[1]}</div>
                    <div style={{ fontSize: 11.5, color: "#a8a29e", marginTop: 1 }}>{fmt(s.created_at).split(" ").slice(2).join(" ")}</div>
                  </td>
                  <td style={{ padding: "13px 16px", fontSize: 13, color: "#78716c" }}>{s.filter_category || "Tümü"}</td>
                  <td style={{ padding: "13px 16px", fontSize: 13, color: "#78716c" }}>{s.filter_brand || "Tümü"}</td>
                  <td style={{ padding: "13px 16px" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: s.applied ? "#f0fdf4" : "#fef9c3", color: s.applied ? "#16a34a" : "#ca8a04", border: `1px solid ${s.applied ? "#bbf7d0" : "#fef08a"}`, borderRadius: 99, padding: "3px 10px", fontSize: 12, fontWeight: 500, whiteSpace: "nowrap" }}>
                      {s.applied ? (
                        <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/></svg>Tamamlandı</>
                      ) : (
                        <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 8 12 12 14 14"/></svg>Taslak</>
                      )}
                    </span>
                  </td>
                  <td style={{ padding: "13px 16px", fontSize: 13, color: "#78716c" }}>{s.username}</td>
                  <td style={{ padding: "13px 16px", fontSize: 13, fontWeight: 600, color: "#18181b" }}>{s.total_products}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Detail modal */}
      {historyDetail && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 500, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 16px", overflowY: "auto" }}>
          <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 800, boxShadow: "0 24px 64px rgba(0,0,0,0.2)" }}>
            {/* Modal header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 24px", borderBottom: "1px solid #f0eeed" }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#18181b" }}>{historyDetail.name}</div>
                <div style={{ fontSize: 12, color: "#a8a29e", marginTop: 3 }}>{fmt(historyDetail.created_at)} · {historyDetail.username}</div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ background: historyDetail.applied ? "#f0fdf4" : "#fef9c3", color: historyDetail.applied ? "#16a34a" : "#ca8a04", border: `1px solid ${historyDetail.applied ? "#bbf7d0" : "#fef08a"}`, borderRadius: 99, padding: "4px 12px", fontSize: 12, fontWeight: 500 }}>
                  {historyDetail.applied ? "✓ Tamamlandı" : "⏸ Taslak"}
                </span>
                <button onClick={() => { const rows = historyDetail.items.map(i => ({ "Ürün": i.name, "SKU": i.sku, "Barkod": i.barcode, "Sistem Stoğu": i.system_stock, "Sayılan": i.counted, "Fark": i.diff })); exportExcel(rows, `${historyDetail.name}.xlsx`); }}
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 8, color: "#44403c", cursor: "pointer", fontSize: 13, fontWeight: 500 }}>
                  <Icon name="download" size={13} /> Excel
                </button>
                <button onClick={() => setHistoryDetail(null)}
                  style={{ width: 32, height: 32, background: "#f5f5f4", border: "none", borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#78716c" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            </div>
            {/* Summary */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 1, background: "#f0eeed", borderBottom: "1px solid #f0eeed" }}>
              {[
                { label: "Toplam Ürün", value: historyDetail.total_products },
                { label: "Sayılan Ürün", value: historyDetail.counted_products },
                { label: "Fark Tespit Edilen", value: historyDetail.diff_count, color: historyDetail.diff_count > 0 ? "#ef4444" : "#22c55e" },
              ].map(s => (
                <div key={s.label} style={{ background: "#fff", padding: "14px 20px", textAlign: "center" }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: s.color || "#18181b" }}>{s.value}</div>
                  <div style={{ fontSize: 11.5, color: "#a8a29e", marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>
            {/* Items table */}
            <div style={{ maxHeight: 400, overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead style={{ position: "sticky", top: 0, background: "#fafaf9", zIndex: 1 }}>
                  <tr style={{ borderBottom: "1px solid #f0eeed" }}>
                    {["Ürün", "Sistem Stoğu", "Sayılan", "Fark", "Durum"].map(h => (
                      <th key={h} style={{ padding: "9px 16px", textAlign: "left", color: "#a8a29e", fontSize: 10.5, fontWeight: 600, textTransform: "uppercase" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {historyDetail.items.map((item, idx) => (
                    <tr key={idx} style={{ borderBottom: "1px solid #f5f5f4", background: item.diff !== 0 ? (item.diff > 0 ? "#eff6ff" : "#fef2f2") : "#fff" }}>
                      <td style={{ padding: "10px 16px" }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: "#1c1917" }}>{item.name}</div>
                        <div style={{ fontSize: 11, color: "#a8a29e", fontFamily: "monospace" }}>{item.sku}</div>
                      </td>
                      <td style={{ padding: "10px 16px", color: "#78716c", fontWeight: 600, fontSize: 14 }}>{item.system_stock}</td>
                      <td style={{ padding: "10px 16px", color: "#1c1917", fontWeight: 600, fontSize: 14 }}>{item.counted}</td>
                      <td style={{ padding: "10px 16px", fontWeight: 700, fontSize: 15, color: item.diff > 0 ? "#3b82f6" : item.diff < 0 ? "#ef4444" : "#22c55e" }}>
                        {item.diff > 0 ? `+${item.diff}` : item.diff}
                      </td>
                      <td style={{ padding: "10px 16px" }}>
                        <span style={{ background: item.diff === 0 ? "#f0fdf4" : item.diff > 0 ? "#eff6ff" : "#fef2f2", color: item.diff === 0 ? "#16a34a" : item.diff > 0 ? "#3b82f6" : "#ef4444", borderRadius: 99, padding: "2px 8px", fontSize: 11, fontWeight: 500 }}>
                          {item.diff === 0 ? "Eşleşti" : item.diff > 0 ? "Fazla" : "Eksik"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );}

  if (phase === "new") return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      {/* Breadcrumb */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20, fontSize: 13, color: "#a8a29e" }}>
        <button onClick={() => setPhase("setup")} style={{ background: "none", border: "none", cursor: "pointer", color: "#a8a29e", fontSize: 13, padding: 0 }}>Stok Sayımları</button>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
        <span style={{ color: "#18181b", fontWeight: 500 }}>Stok Sayımı Ekle</span>
      </div>

      {/* Stok Sayımı Detay */}
      <div style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: 14, padding: 28, marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: "#18181b", margin: "0 0 20px" }}>Stok Sayımı Detay</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div>
            <label style={{ color: "#78716c", fontSize: 12, fontWeight: 500, display: "block", marginBottom: 6 }}>
              Kategori Filtresi
            </label>
            <select value={filter.category} onChange={e => setFilter(f => ({ ...f, category: e.target.value }))}
              style={{ width: "100%", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 9, padding: "10px 14px", color: "#1c1917", fontSize: 14, outline: "none", cursor: "pointer", fontFamily: "inherit" }}>
              <option value="">Tümü</option>
              {categories.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label style={{ color: "#78716c", fontSize: 12, fontWeight: 500, display: "block", marginBottom: 6 }}>
              Ad <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <input value={countName} onChange={e => setCountName(e.target.value)}
              style={{ width: "100%", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 9, padding: "10px 14px", color: "#1c1917", fontSize: 14, outline: "none", fontFamily: "inherit" }} />
          </div>
          <div>
            <label style={{ color: "#78716c", fontSize: 12, fontWeight: 500, display: "block", marginBottom: 6 }}>
              Marka Filtresi
            </label>
            <select value={filter.brand} onChange={e => setFilter(f => ({ ...f, brand: e.target.value }))}
              style={{ width: "100%", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 9, padding: "10px 14px", color: "#1c1917", fontSize: 14, outline: "none", cursor: "pointer", fontFamily: "inherit" }}>
              <option value="">Tümü</option>
              {brands.map(b => <option key={b}>{b}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 9, padding: "10px 14px", color: "#16a34a", fontSize: 13, fontWeight: 500, width: "100%" }}>
              <span style={{ color: "#78716c" }}>Seçilen kriterlerde </span>
              <strong style={{ color: "#18181b" }}>{filteredProducts.length}</strong>
              <span style={{ color: "#78716c" }}> ürün sayılacak</span>
            </div>
          </div>
        </div>
      </div>

      {/* Stok Sayım Yöntemi */}
      <div style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: 14, padding: 28 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: "#18181b", margin: "0 0 20px" }}>Stok Sayım Yöntemi</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

          {/* Sayarak Ekle */}
          <div style={{ border: "2px solid #e7e5e4", borderRadius: 12, padding: 24, display: "flex", flexDirection: "column", gap: 16, transition: "border-color 0.15s" }}
            onMouseEnter={e => e.currentTarget.style.borderColor = "#18181b"}
            onMouseLeave={e => e.currentTarget.style.borderColor = "#e7e5e4"}>
            <div>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: "#18181b", margin: "0 0 8px" }}>Sayarak Ekle</h3>
              <p style={{ fontSize: 13, color: "#78716c", margin: 0, lineHeight: 1.5 }}>Depoda ürünleri tek tek sayarak veya barkod okuyarak stokları güncelleyin.</p>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {[
                "Hızlı ve yerinde sayım yapan ekipler için idealdir.",
                "Sayım sırasında yalnızca okuttuğunuz veya manuel olarak saydığınız ürünlerin stokları güncellenir.",
                "Barkod okuyucuyla hızlıca ilerleyerek hataları en aza indirebilirsiniz.",
              ].map((text, i) => (
                <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
                  <div style={{ width: 20, height: 20, borderRadius: 5, background: "#f0f9ff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                  <span style={{ fontSize: 12.5, color: "#78716c", lineHeight: 1.5 }}>{text}</span>
                </div>
              ))}
            </div>
            <button onClick={startCounting} disabled={!canEdit}
              style={{ marginTop: "auto", padding: "12px", background: "#18181b", border: "none", borderRadius: 9, color: "#fff", cursor: canEdit ? "pointer" : "not-allowed", fontSize: 14, fontWeight: 600, opacity: canEdit ? 1 : 0.5 }}>
              Sayarak Sayım Başlat
            </button>
          </div>

          {/* Filtreye Göre Ekle */}
          <div style={{ border: "2px solid #e7e5e4", borderRadius: 12, padding: 24, display: "flex", flexDirection: "column", gap: 16, transition: "border-color 0.15s" }}
            onMouseEnter={e => e.currentTarget.style.borderColor = "#18181b"}
            onMouseLeave={e => e.currentTarget.style.borderColor = "#e7e5e4"}>
            <div>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: "#18181b", margin: "0 0 8px" }}>Filtreye Göre Ekle</h3>
              <p style={{ fontSize: 13, color: "#78716c", margin: 0, lineHeight: 1.5 }}>Belirli kriterlere göre tüm ürün listesini sayım için hazırlayın.</p>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {[
                "Sayım sonrası yalnızca saydığınız ürünlerin stokları güncellenir.",
                "Geniş ürün portföyüne sahip işletmeler için önerilir.",
                "Sistem, seçtiğiniz filtreye göre ürünleri listeler.",
              ].map((text, i) => (
                <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
                  <div style={{ width: 20, height: 20, borderRadius: 5, background: "#f0fdf4", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                  <span style={{ fontSize: 12.5, color: "#78716c", lineHeight: 1.5 }}>{text}</span>
                </div>
              ))}
            </div>
            <button onClick={startCounting} disabled={!canEdit}
              style={{ marginTop: "auto", padding: "12px", background: "#18181b", border: "none", borderRadius: 9, color: "#fff", cursor: canEdit ? "pointer" : "not-allowed", fontSize: 14, fontWeight: 600, opacity: canEdit ? 1 : 0.5 }}>
              Filtreye Göre Sayım Ekle
            </button>
          </div>
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
      {showCamera && <CameraScanner onDetected={handleCameraDetect} onClose={() => setShowCamera(false)} recentScans={lastScanned} />}

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
      <div className="counting-layout" style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 14, alignItems: "start" }}>

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
            <button
              onClick={() => barcodeRef.current?.focus()}
              title="Barkod tabancası ile okut"
              style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6, padding: "7px 13px", background: "#f5f5f4", border: "1px solid #e7e5e4", borderRadius: 8, color: "#44403c", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="2" y="4" width="14" height="10" rx="2"/>
                <path d="M16 9h3l2 2v4h-5"/>
                <line x1="6" y1="18" x2="6" y2="14"/>
                <line x1="9" y1="18" x2="9" y2="14"/>
                <line x1="12" y1="18" x2="12" y2="14"/>
                <line x1="5" y1="7" x2="5" y2="11"/>
                <line x1="8" y1="7" x2="8" y2="11"/>
                <line x1="11" y1="7" x2="11" y2="11"/>
              </svg>
              Tabanca
            </button>
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
        <div className="counting-sidebar" style={{ position: "sticky", top: 20 }}>
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
          <button onClick={saveSessionWithoutApplying} className="btn-hover" style={{ ...btnStyle("ghost"), display: "flex", alignItems: "center", gap: 6 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            Kaydet
          </button>
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
function LocationManager({ locations, onSave }) {
  const [list, setList] = useState(locations.map((l, i) => typeof l === "string" ? { id: Date.now() + i, name: l, description: "", type: "depo" } : l));
  const [form, setForm] = useState({ name: "", description: "", type: "depo" });
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const TYPES = [
    { value: "depo", label: "Depo", icon: "🏭", color: "#3b82f6" },
    { value: "magaza", label: "Mağaza", icon: "🏪", color: "#22c55e" },
    { value: "raf", label: "Raf", icon: "📦", color: "#f59e0b" },
    { value: "diger", label: "Diğer", icon: "📍", color: "#a8a29e" },
  ];

  const typeInfo = (t) => TYPES.find(x => x.value === t) || TYPES[3];

  const doSave = async (updated) => {
    setSaving(true); setSaved(false);
    try { await onSave(updated); setSaved(true); setTimeout(() => setSaved(false), 2000); } catch(e) {}
    setSaving(false);
  };

  const add = () => {
    if (!form.name.trim()) return;
    if (list.find(l => l.name.toLowerCase() === form.name.trim().toLowerCase())) return;
    const newItem = { id: Date.now(), name: form.name.trim(), description: form.description.trim(), type: form.type };
    const updated = [...list, newItem];
    setList(updated);
    doSave(updated);
    setForm({ name: "", description: "", type: "depo" });
  };

  const remove = (id) => {
    const updated = list.filter(l => l.id !== id);
    setList(updated);
    doSave(updated);
  };

  const startEdit = (item) => {
    setEditId(item.id);
    setForm({ name: item.name, description: item.description || "", type: item.type || "depo" });
  };

  const saveEdit = () => {
    if (!form.name.trim()) return;
    const updated = list.map(l => l.id === editId ? { ...l, name: form.name.trim(), description: form.description.trim(), type: form.type } : l);
    setList(updated);
    doSave(updated);
    setEditId(null);
    setForm({ name: "", description: "", type: "depo" });
  };

  return (
    <div>
      {/* Add / Edit form */}
      <div style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: 14, padding: 20, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <h4 style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: "#18181b" }}>
            {editId ? "Lokasyon Düzenle" : "Yeni Lokasyon Ekle"}
          </h4>
          <div style={{ fontSize: 11.5, fontWeight: 500 }}>
            {saving && <span style={{ color: "#a8a29e" }}>⏳ Kaydediliyor...</span>}
            {saved && !saving && <span style={{ color: "#16a34a" }}>✓ Kaydedildi</span>}
          </div>
        </div>

        {/* Type selector */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {TYPES.map(t => (
            <button key={t.value} onClick={() => setForm(f => ({ ...f, type: t.value }))}
              style={{ flex: 1, padding: "8px 4px", borderRadius: 9, border: `2px solid ${form.type === t.value ? t.color : "#e7e5e4"}`, background: form.type === t.value ? `${t.color}12` : "#fafaf9", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, transition: "all 0.1s" }}>
              <span style={{ fontSize: 16 }}>{t.icon}</span>
              <span style={{ fontSize: 11, fontWeight: form.type === t.value ? 600 : 400, color: form.type === t.value ? t.color : "#a8a29e" }}>{t.label}</span>
            </button>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            onKeyDown={e => e.key === "Enter" && !editId && add()}
            placeholder="Lokasyon adı (örn: Ana Depo, A Rafı...)"
            style={{ width: "100%", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 8, padding: "9px 12px", color: "#1c1917", fontSize: 13.5, outline: "none", fontFamily: "inherit" }} />
          <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            placeholder="Açıklama (isteğe bağlı)"
            style={{ width: "100%", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 8, padding: "9px 12px", color: "#1c1917", fontSize: 13.5, outline: "none", fontFamily: "inherit" }} />
          <div style={{ display: "flex", gap: 8 }}>
            {editId ? (
              <>
                <button onClick={saveEdit} style={{ flex: 1, padding: "9px", background: "#18181b", border: "none", borderRadius: 8, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Güncelle</button>
                <button onClick={() => { setEditId(null); setForm({ name: "", description: "", type: "depo" }); }}
                  style={{ padding: "9px 16px", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 8, color: "#78716c", cursor: "pointer", fontSize: 13 }}>İptal</button>
              </>
            ) : (
              <button onClick={add} style={{ flex: 1, padding: "9px", background: "#18181b", border: "none", borderRadius: 8, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                + Lokasyon Ekle
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Locations list */}
      {list.length === 0 ? (
        <div style={{ background: "#fff", border: "2px dashed #e7e5e4", borderRadius: 14, padding: 32, textAlign: "center" }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>📍</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#18181b", marginBottom: 4 }}>Henüz lokasyon yok</div>
          <div style={{ fontSize: 13, color: "#a8a29e" }}>Yukarıdan ilk lokasyonunuzu ekleyin</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {list.map(item => {
            const t = typeInfo(item.type);
            return (
              <div key={item.id} style={{ background: "#fff", border: `1px solid ${editId === item.id ? t.color : "#e7e5e4"}`, borderRadius: 11, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, transition: "border-color 0.15s" }}>
                <div style={{ width: 38, height: 38, borderRadius: 10, background: `${t.color}15`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>
                  {t.icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: "#18181b" }}>{item.name}</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 3 }}>
                    <span style={{ fontSize: 11, fontWeight: 500, color: t.color, background: `${t.color}12`, borderRadius: 99, padding: "1px 7px" }}>{t.label}</span>
                    {item.description && <span style={{ fontSize: 11.5, color: "#a8a29e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.description}</span>}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button onClick={() => startEdit(item)}
                    style={{ width: 30, height: 30, background: "#f5f5f4", border: "none", borderRadius: 7, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#78716c" }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                  <button onClick={() => remove(item.id)}
                    style={{ width: 30, height: 30, background: "#fef2f2", border: "none", borderRadius: 7, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#dc2626" }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ListManager({ title, items, onSave, color }) {
  const [list, setList] = useState([...items]);
  const [newItem, setNewItem] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = async (updated) => {
    setSaving(true);
    setSaved(false);
    try {
      await onSave(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch(e) {}
    setSaving(false);
  };

  const add = () => {
    const v = newItem.trim();
    if (!v || list.includes(v)) return;
    const updated = [...list, v];
    setList(updated);
    save(updated);
    setNewItem("");
  };

  const remove = (item) => {
    const updated = list.filter(i => i !== item);
    setList(updated);
    save(updated);
  };

  return (
    <div style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: 14, padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#1c1917" }}>{title}</h3>
        <div style={{ fontSize: 11.5, fontWeight: 500 }}>
          {saving && <span style={{ color: "#a8a29e" }}>⏳ Kaydediliyor...</span>}
          {saved && !saving && <span style={{ color: "#16a34a" }}>✓ Kaydedildi</span>}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input value={newItem} onChange={e => setNewItem(e.target.value)} onKeyDown={e => e.key === "Enter" && add()}
          placeholder={`Yeni ekle...`}
          style={{ flex: 1, background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 8, padding: "8px 12px", color: "#1c1917", fontSize: 13, outline: "none", fontFamily: "inherit" }} />
        <button onClick={add} style={{ background: "#18181b", border: "none", borderRadius: 8, padding: "8px 14px", color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 16 }}>+</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 280, overflowY: "auto" }}>
        {list.map(item => (
          <div key={item} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fafaf9", border: "1px solid #f0eeed", borderRadius: 8, padding: "7px 12px" }}>
            <span style={{ color: "#1c1917", fontSize: 13 }}>{item}</span>
            <button onClick={() => remove(item)} style={{ background: "transparent", border: "none", borderRadius: 6, padding: "2px 6px", color: "#dc2626", cursor: "pointer", fontSize: 14, lineHeight: 1 }}>✕</button>
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

// ─── SEVKİYAT SAYFASI ────────────────────────────────────────────────────────
function ShipmentPage({ products, setProducts, setMovements, user, notify }) {
  const [tab, setTab] = useState("list"); // list | new | label_designer
  const [shipments, setShipments] = useState(() => {
    try { return JSON.parse(localStorage.getItem("stokpro_shipments") || "[]"); } catch { return []; }
  });
  const [selected, setSelected] = useState(null); // selected shipment
  const [labelTemplate, setLabelTemplate] = useState(() => {
    try { return JSON.parse(localStorage.getItem("stokpro_label_template") || "null"); } catch { return null; }
  });

  const saveShipments = (s) => { setShipments(s); localStorage.setItem("stokpro_shipments", JSON.stringify(s)); };
  const saveLabelTemplate = (t) => { setLabelTemplate(t); localStorage.setItem("stokpro_label_template", JSON.stringify(t)); };

  // ── NEW SHIPMENT FORM STATE ──
  const [form, setForm] = useState({
    shipment_no: `SEV-${Date.now().toString().slice(-6)}`,
    customer_name: "", customer_address: "", customer_phone: "",
    note: "", date: new Date().toISOString().slice(0, 10),
    boxes: [{ id: 1, items: [] }]
  });
  const [addingProduct, setAddingProduct] = useState(null); // box id
  const [productSearch, setProductSearch] = useState("");
  const [productQty, setProductQty] = useState(1);

  const addBox = () => {
    const newId = Math.max(...form.boxes.map(b => b.id)) + 1;
    setForm(f => ({ ...f, boxes: [...f.boxes, { id: newId, items: [] }] }));
  };

  const removeBox = (boxId) => {
    if (form.boxes.length === 1) return;
    setForm(f => ({ ...f, boxes: f.boxes.filter(b => b.id !== boxId) }));
  };

  const addProductToBox = (boxId, product, qty) => {
    setForm(f => ({
      ...f,
      boxes: f.boxes.map(b => {
        if (b.id !== boxId) return b;
        const existing = b.items.find(i => i.product_id === product.id);
        if (existing) {
          return { ...b, items: b.items.map(i => i.product_id === product.id ? { ...i, qty: i.qty + qty } : i) };
        }
        return { ...b, items: [...b.items, { product_id: product.id, product_name: product.name, sku: product.sku || "", qty }] };
      })
    }));
    setAddingProduct(null);
    setProductSearch("");
    setProductQty(1);
  };

  const removeItemFromBox = (boxId, productId) => {
    setForm(f => ({
      ...f,
      boxes: f.boxes.map(b => b.id !== boxId ? b : { ...b, items: b.items.filter(i => i.product_id !== productId) })
    }));
  };

  const saveShipment = () => {
    const totalItems = form.boxes.reduce((s, b) => s + b.items.reduce((ss, i) => ss + i.qty, 0), 0);
    if (!form.customer_name) { notify("Müşteri adı zorunlu", "error"); return; }
    if (totalItems === 0) { notify("En az bir ürün ekleyin", "error"); return; }
    const shipment = { ...form, id: Date.now(), created_at: new Date().toISOString(), status: "hazır", total_boxes: form.boxes.length, total_items: totalItems };
    saveShipments([shipment, ...shipments]);
    notify(`${form.shipment_no} sevkiyatı kaydedildi`, "success");
    setTab("list");
    setForm({ shipment_no: `SEV-${Date.now().toString().slice(-6)}`, customer_name: "", customer_address: "", customer_phone: "", note: "", date: new Date().toISOString().slice(0, 10), boxes: [{ id: 1, items: [] }] });
  };

  const filteredProducts = products.filter(p =>
    p.name?.toLowerCase().includes(productSearch.toLowerCase()) ||
    p.sku?.toLowerCase().includes(productSearch.toLowerCase())
  ).slice(0, 8);

  // ── PACKING LIST PRINT ──
  const printPackingList = (shipment) => {
    const tpl = labelTemplate || defaultLabelTemplate;
    const w = tpl.width_mm; const h = tpl.height_mm;
    const win = window.open("", "_blank");
    const boxesHtml = shipment.boxes.map((box, bi) => `
      <div class="box-section">
        <div class="box-header">KOLİ ${bi + 1} / ${shipment.boxes.length}</div>
        <table>
          <thead><tr><th>Ürün</th><th>SKU</th><th>Adet</th></tr></thead>
          <tbody>${box.items.map(i => `<tr><td>${i.product_name}</td><td>${i.sku}</td><td>${i.qty}</td></tr>`).join("")}</tbody>
        </table>
      </div>
    `).join("");
    win.document.write(`<!DOCTYPE html><html><head><title>Packing List - ${shipment.shipment_no}</title>
    <style>
      body { font-family: Arial, sans-serif; font-size: 11px; margin: 20px; }
      h2 { font-size: 16px; margin: 0 0 4px; }
      .header { border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 12px; }
      .info { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 12px; }
      .box-section { margin-bottom: 16px; page-break-inside: avoid; }
      .box-header { background: #000; color: #fff; padding: 4px 8px; font-weight: bold; font-size: 12px; margin-bottom: 4px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #ccc; padding: 3px 6px; text-align: left; }
      th { background: #f5f5f5; font-weight: bold; }
      @media print { body { margin: 5mm; } }
    </style></head><body>
    <div class="header">
      <h2>📦 PACKING LIST — ${shipment.shipment_no}</h2>
      <div class="info">
        <div><b>Müşteri:</b> ${shipment.customer_name}</div>
        <div><b>Tarih:</b> ${shipment.date}</div>
        <div><b>Adres:</b> ${shipment.customer_address || "—"}</div>
        <div><b>Toplam Koli:</b> ${shipment.total_boxes}</div>
      </div>
    </div>
    ${boxesHtml}
    </body></html>`);
    win.document.close();
    setTimeout(() => win.print(), 500);
  };

  // ── KOLİ ETİKETİ PRINT ──
  const printBoxLabels = (shipment) => {
    const tpl = labelTemplate || defaultLabelTemplate;
    const w = tpl.width_mm; const h = tpl.height_mm;
    const labelsHtml = shipment.boxes.map((box, bi) => {
      const itemsSummary = box.items.map(i => `${i.product_name} x${i.qty}`).join(", ");
      const barcodeVal = `${shipment.shipment_no}-K${bi + 1}`;
      return `
        <div class="label" style="width:${w}mm;height:${h}mm;">
          ${tpl.show_logo && tpl.logo_text ? `<div class="logo">${tpl.logo_text}</div>` : ""}
          ${tpl.show_shipment_no ? `<div class="shipment-no">${shipment.shipment_no}</div>` : ""}
          ${tpl.show_customer ? `<div class="customer">${shipment.customer_name}</div>` : ""}
          ${tpl.show_address && shipment.customer_address ? `<div class="address">${shipment.customer_address}</div>` : ""}
          ${tpl.show_box_no ? `<div class="box-no">KOLİ ${bi + 1} / ${shipment.boxes.length}</div>` : ""}
          ${tpl.show_items ? `<div class="items">${itemsSummary}</div>` : ""}
          ${tpl.show_date ? `<div class="date">${shipment.date}</div>` : ""}
          ${tpl.show_barcode ? `<div class="barcode"><svg id="bc${bi}" class="barcode-svg"></svg></div>` : ""}
        </div>
      `;
    }).join('<div class="page-break"></div>');

    const win = window.open("", "_blank");
    win.document.write(`<!DOCTYPE html><html><head><title>Etiketler - ${shipment.shipment_no}</title>
    <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.0/dist/JsBarcode.all.min.js"><\/script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { background: #fff; }
      .label {
        display: flex; flex-direction: column; justify-content: space-between;
        padding: ${tpl.padding_mm || 3}mm;
        border: 1px solid #000;
        font-family: ${tpl.font_family || "Arial"}, sans-serif;
        overflow: hidden; page-break-after: always;
      }
      .logo { font-size: ${tpl.logo_size || 14}px; font-weight: bold; text-align: center; border-bottom: 1px solid #000; padding-bottom: 2mm; margin-bottom: 2mm; }
      .shipment-no { font-size: ${tpl.shipment_no_size || 10}px; font-weight: bold; }
      .customer { font-size: ${tpl.customer_size || 12}px; font-weight: bold; }
      .address { font-size: ${tpl.address_size || 9}px; color: #444; }
      .box-no { font-size: ${tpl.box_no_size || 18}px; font-weight: 900; text-align: center; border: 2px solid #000; padding: 1mm; margin: 1mm 0; }
      .items { font-size: ${tpl.items_size || 8}px; color: #555; overflow: hidden; max-height: 15mm; }
      .date { font-size: ${tpl.date_size || 8}px; color: #888; }
      .barcode-svg { width: 100%; height: ${tpl.barcode_height || 12}mm; }
      .page-break { page-break-after: always; }
      @media print { @page { size: ${w}mm ${h}mm; margin: 0; } }
    </style></head><body>
    ${labelsHtml}
    <script>
      window.onload = function() {
        document.querySelectorAll('.barcode-svg').forEach(function(el, i) {
          try {
            JsBarcode(el, '${shipment.shipment_no}-K' + (i+1), {
              format: "CODE128", width: 1.5, height: 40, displayValue: true, fontSize: 10
            });
          } catch(e) {}
        });
        setTimeout(function() { window.print(); }, 800);
      };
    <\/script>
    </body></html>`);
    win.document.close();
  };

  // ── DEFAULT LABEL TEMPLATE ──
  const defaultLabelTemplate = {
    width_mm: 100, height_mm: 70, padding_mm: 3,
    font_family: "Arial",
    show_logo: true, logo_text: "StokPro", logo_size: 14,
    show_shipment_no: true, shipment_no_size: 10,
    show_customer: true, customer_size: 12,
    show_address: true, address_size: 9,
    show_box_no: true, box_no_size: 18,
    show_items: true, items_size: 8,
    show_date: true, date_size: 8,
    show_barcode: true, barcode_height: 12,
  };

  const tpl = labelTemplate || defaultLabelTemplate;

  // ── LABEL DESIGNER ──
  const LabelDesigner = () => {
    const [local, setLocal] = useState({ ...defaultLabelTemplate, ...(labelTemplate || {}) });
    const upd = (k, v) => setLocal(l => ({ ...l, [k]: v }));
    const previewItems = ["Ürün A x2", "Ürün B x1"];
    const previewBarcode = "SEV-001-K1";

    return (
      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 24 }}>
        {/* Sol: Ayarlar */}
        <div style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: 10, padding: 20, overflowY: "auto", maxHeight: "75vh" }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16 }}>🎨 Etiket Ayarları</div>

          {/* Boyut */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#78716c", textTransform: "uppercase", marginBottom: 8 }}>Boyut</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {[["Genişlik (mm)", "width_mm"], ["Yükseklik (mm)", "height_mm"], ["Kenar boşluğu (mm)", "padding_mm"]].map(([label, key]) => (
                <div key={key}>
                  <div style={{ fontSize: 10, color: "#78716c", marginBottom: 3 }}>{label}</div>
                  <input type="number" value={local[key]} onChange={e => upd(key, +e.target.value)}
                    style={{ width: "100%", padding: "5px 8px", border: "1px solid #e7e5e4", borderRadius: 6, fontSize: 12 }} />
                </div>
              ))}
            </div>
          </div>

          {/* Font */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#78716c", textTransform: "uppercase", marginBottom: 8 }}>Font</div>
            <select value={local.font_family} onChange={e => upd("font_family", e.target.value)}
              style={{ width: "100%", padding: "6px 8px", border: "1px solid #e7e5e4", borderRadius: 6, fontSize: 12 }}>
              {["Arial", "Courier New", "Times New Roman", "Verdana", "Tahoma"].map(f => <option key={f}>{f}</option>)}
            </select>
          </div>

          {/* Alanlar */}
          {[
            { key: "show_logo", label: "Logo / Firma Adı", textKey: "logo_text", sizeKey: "logo_size", hasText: true },
            { key: "show_shipment_no", label: "Sevkiyat No", sizeKey: "shipment_no_size" },
            { key: "show_customer", label: "Müşteri Adı", sizeKey: "customer_size" },
            { key: "show_address", label: "Adres", sizeKey: "address_size" },
            { key: "show_box_no", label: "Koli No (büyük)", sizeKey: "box_no_size" },
            { key: "show_items", label: "Ürün Listesi", sizeKey: "items_size" },
            { key: "show_date", label: "Tarih", sizeKey: "date_size" },
            { key: "show_barcode", label: "Barkod", sizeKey: "barcode_height", sizeLabel: "Yükseklik (mm)" },
          ].map(field => (
            <div key={field.key} style={{ marginBottom: 12, padding: 10, background: "#fafaf9", borderRadius: 8, border: "1px solid #e7e5e4" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: field.hasText || field.sizeKey ? 8 : 0 }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{field.label}</span>
                <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <div style={{ width: 36, height: 20, background: local[field.key] ? "#22c55e" : "#e7e5e4", borderRadius: 10, position: "relative", transition: "background 0.2s" }}
                    onClick={() => upd(field.key, !local[field.key])}>
                    <div style={{ width: 16, height: 16, background: "#fff", borderRadius: "50%", position: "absolute", top: 2, left: local[field.key] ? 18 : 2, transition: "left 0.2s" }} />
                  </div>
                </label>
              </div>
              {local[field.key] && (
                <div style={{ display: "flex", gap: 8 }}>
                  {field.hasText && (
                    <input value={local[field.textKey]} onChange={e => upd(field.textKey, e.target.value)}
                      placeholder="Firma adı" style={{ flex: 1, padding: "4px 8px", border: "1px solid #e7e5e4", borderRadius: 5, fontSize: 11 }} />
                  )}
                  {field.sizeKey && (
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ fontSize: 10, color: "#78716c", whiteSpace: "nowrap" }}>{field.sizeLabel || "Font (px)"}</span>
                      <input type="number" value={local[field.sizeKey]} onChange={e => upd(field.sizeKey, +e.target.value)}
                        style={{ width: 52, padding: "4px 6px", border: "1px solid #e7e5e4", borderRadius: 5, fontSize: 11 }} />
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          <button onClick={() => { saveLabelTemplate(local); notify("Şablon kaydedildi", "success"); }}
            style={{ width: "100%", padding: "10px", background: "#18181b", color: "#fff", border: "none", borderRadius: 8, fontWeight: 600, cursor: "pointer", marginTop: 8 }}>
            💾 Şablonu Kaydet
          </button>
        </div>

        {/* Sağ: Önizleme */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: 10, padding: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16 }}>👁️ Önizleme</div>
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", padding: 20, background: "#f5f5f4", borderRadius: 8 }}>
              <div style={{
                width: `${local.width_mm * 2.5}px`, height: `${local.height_mm * 2.5}px`,
                border: "2px solid #000", padding: `${local.padding_mm * 2.5}px`,
                fontFamily: `${local.font_family}, sans-serif`,
                display: "flex", flexDirection: "column", justifyContent: "space-between",
                background: "#fff", overflow: "hidden", position: "relative"
              }}>
                {local.show_logo && <div style={{ fontSize: local.logo_size, fontWeight: "bold", textAlign: "center", borderBottom: "1px solid #000", paddingBottom: 3 }}>{local.logo_text || "StokPro"}</div>}
                {local.show_shipment_no && <div style={{ fontSize: local.shipment_no_size, fontWeight: "bold" }}>SEV-001</div>}
                {local.show_customer && <div style={{ fontSize: local.customer_size, fontWeight: "bold" }}>Müşteri Adı</div>}
                {local.show_address && <div style={{ fontSize: local.address_size, color: "#555" }}>Adres Bilgisi</div>}
                {local.show_box_no && <div style={{ fontSize: local.box_no_size, fontWeight: 900, textAlign: "center", border: "2px solid #000", padding: 2 }}>KOLİ 1 / 3</div>}
                {local.show_items && <div style={{ fontSize: local.items_size, color: "#555" }}>{previewItems.join(", ")}</div>}
                {local.show_date && <div style={{ fontSize: local.date_size, color: "#888" }}>{new Date().toLocaleDateString("tr-TR")}</div>}
                {local.show_barcode && <div style={{ background: "#000", height: local.barcode_height * 2, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ color: "#fff", fontSize: 8 }}>||||||||||||||||</span>
                </div>}
              </div>
            </div>
            <div style={{ textAlign: "center", marginTop: 8, fontSize: 11, color: "#78716c" }}>
              {local.width_mm}mm × {local.height_mm}mm
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ── SHIPMENT DETAIL ──
  const ShipmentDetail = ({ s }) => (
    <div style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: 10, padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{s.shipment_no}</div>
          <div style={{ color: "#78716c", fontSize: 13 }}>{s.customer_name} • {s.date}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => printPackingList(s)} style={{ padding: "8px 16px", background: "#f5f5f4", border: "1px solid #e7e5e4", borderRadius: 7, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>📄 Packing List</button>
          <button onClick={() => printBoxLabels(s)} style={{ padding: "8px 16px", background: "#18181b", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>🖨️ Etiket Yazdır</button>
          <button onClick={() => setSelected(null)} style={{ padding: "8px 12px", background: "#f5f5f4", border: "1px solid #e7e5e4", borderRadius: 7, cursor: "pointer" }}>✕</button>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
        {[["Toplam Koli", s.total_boxes], ["Toplam Ürün", s.total_items], ["Durum", s.status]].map(([l, v]) => (
          <div key={l} style={{ background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 8, padding: "12px 16px" }}>
            <div style={{ fontSize: 11, color: "#78716c", marginBottom: 4 }}>{l}</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{v}</div>
          </div>
        ))}
      </div>
      {s.customer_address && <div style={{ marginBottom: 12, fontSize: 13, color: "#57534e" }}>📍 {s.customer_address}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
        {s.boxes.map((box, bi) => (
          <div key={box.id} style={{ border: "1px solid #e7e5e4", borderRadius: 8, overflow: "hidden" }}>
            <div style={{ background: "#18181b", color: "#fff", padding: "8px 14px", fontWeight: 700, fontSize: 13 }}>
              📦 KOLİ {bi + 1} / {s.boxes.length}
            </div>
            <div style={{ padding: 12 }}>
              {box.items.length === 0 ? <div style={{ color: "#a8a29e", fontSize: 12 }}>Boş koli</div> :
                box.items.map(item => (
                  <div key={item.product_id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #f5f5f4", fontSize: 13 }}>
                    <span>{item.product_name}</span>
                    <span style={{ fontWeight: 600, color: "#18181b" }}>x{item.qty}</span>
                  </div>
                ))
              }
              <div style={{ marginTop: 8, fontSize: 11, color: "#78716c", textAlign: "right" }}>
                Toplam: {box.items.reduce((s, i) => s + i.qty, 0)} adet
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div style={{ animation: "fadeUp 0.3s ease" }}>
      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)", borderRadius: 14, padding: "24px 28px", marginBottom: 24, color: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.5px" }}>📦 Sevkiyat</div>
            <div style={{ fontSize: 13, opacity: 0.7, marginTop: 4 }}>Koli yönetimi, packing list ve etiket yazdırma</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {[["list", "📋 Sevkiyatlar"], ["new", "➕ Yeni Sevkiyat"], ["label_designer", "🎨 Etiket Tasarımcısı"]].map(([t, l]) => (
              <button key={t} onClick={() => { setTab(t); setSelected(null); }}
                style={{ padding: "8px 14px", background: tab === t ? "#fff" : "rgba(255,255,255,0.15)", color: tab === t ? "#0f172a" : "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: tab === t ? 700 : 500, fontSize: 13 }}>
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* List Tab */}
      {tab === "list" && !selected && (
        <div>
          {shipments.length === 0 ? (
            <div style={{ textAlign: "center", padding: 60, color: "#78716c" }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>📭</div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>Henüz sevkiyat yok</div>
              <button onClick={() => setTab("new")} style={{ marginTop: 16, padding: "10px 20px", background: "#18181b", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>İlk Sevkiyatı Oluştur</button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {shipments.map(s => (
                <div key={s.id} onClick={() => setSelected(s)} style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: 10, padding: "16px 20px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", transition: "all 0.15s" }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = "#a8a29e"}
                  onMouseLeave={e => e.currentTarget.style.borderColor = "#e7e5e4"}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{s.shipment_no}</div>
                    <div style={{ fontSize: 13, color: "#78716c", marginTop: 2 }}>{s.customer_name} • {s.date}</div>
                  </div>
                  <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                    <div style={{ textAlign: "center" }}><div style={{ fontSize: 18, fontWeight: 700 }}>{s.total_boxes}</div><div style={{ fontSize: 10, color: "#78716c" }}>Koli</div></div>
                    <div style={{ textAlign: "center" }}><div style={{ fontSize: 18, fontWeight: 700 }}>{s.total_items}</div><div style={{ fontSize: 10, color: "#78716c" }}>Ürün</div></div>
                    <span style={{ background: "#dcfce7", color: "#16a34a", padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600 }}>{s.status}</span>
                    <div style={{ display: "flex", gap: 6 }} onClick={e => e.stopPropagation()}>
                      <button onClick={() => printPackingList(s)} style={{ padding: "6px 10px", background: "#f5f5f4", border: "1px solid #e7e5e4", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>📄</button>
                      <button onClick={() => printBoxLabels(s)} style={{ padding: "6px 10px", background: "#18181b", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>🖨️</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "list" && selected && <ShipmentDetail s={selected} />}

      {/* New Shipment Tab */}
      {tab === "new" && (
        <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 20 }}>
          {/* Müşteri Bilgileri */}
          <div style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: 10, padding: 20, height: "fit-content" }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16 }}>👤 Sevkiyat Bilgileri</div>
            {[["Sevkiyat No", "shipment_no"], ["Müşteri Adı *", "customer_name"], ["Adres", "customer_address"], ["Telefon", "customer_phone"], ["Tarih", "date", "date"], ["Not", "note"]].map(([label, key, type]) => (
              <div key={key} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#78716c", marginBottom: 4 }}>{label}</div>
                {key === "note" ?
                  <textarea value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} rows={3}
                    style={{ width: "100%", padding: "8px", border: "1px solid #e7e5e4", borderRadius: 6, fontSize: 13, resize: "vertical", fontFamily: "inherit" }} /> :
                  <input type={type || "text"} value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                    style={{ width: "100%", padding: "8px", border: "1px solid #e7e5e4", borderRadius: 6, fontSize: 13 }} />
                }
              </div>
            ))}
            <button onClick={saveShipment} style={{ width: "100%", padding: "12px", background: "#18181b", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer", fontSize: 14, marginTop: 8 }}>
              💾 Sevkiyatı Kaydet
            </button>
          </div>

          {/* Koliler */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>📦 Koliler ({form.boxes.length})</div>
              <button onClick={addBox} style={{ padding: "8px 14px", background: "#f5f5f4", border: "1px solid #e7e5e4", borderRadius: 7, cursor: "pointer", fontWeight: 600, fontSize: 13 }}>+ Koli Ekle</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {form.boxes.map((box, bi) => (
                <div key={box.id} style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: 10, overflow: "hidden" }}>
                  <div style={{ background: "#18181b", color: "#fff", padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontWeight: 700 }}>📦 KOLİ {bi + 1}</span>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => setAddingProduct(box.id)}
                        style={{ padding: "4px 10px", background: "rgba(255,255,255,0.2)", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 12 }}>+ Ürün</button>
                      {form.boxes.length > 1 && <button onClick={() => removeBox(box.id)}
                        style={{ padding: "4px 8px", background: "rgba(239,68,68,0.3)", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 12 }}>✕</button>}
                    </div>
                  </div>
                  <div style={{ padding: 12 }}>
                    {box.items.length === 0 ? <div style={{ color: "#a8a29e", fontSize: 12, textAlign: "center", padding: 12 }}>Ürün eklenmedi</div> :
                      box.items.map(item => (
                        <div key={item.product_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #f5f5f4" }}>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{item.product_name}</div>
                            {item.sku && <div style={{ fontSize: 11, color: "#78716c" }}>{item.sku}</div>}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontWeight: 700, fontSize: 14 }}>x{item.qty}</span>
                            <button onClick={() => removeItemFromBox(box.id, item.product_id)}
                              style={{ color: "#ef4444", background: "none", border: "none", cursor: "pointer", fontSize: 14 }}>✕</button>
                          </div>
                        </div>
                      ))
                    }
                    {/* Add product inline */}
                    {addingProduct === box.id && (
                      <div style={{ marginTop: 12, padding: 12, background: "#fafaf9", borderRadius: 8, border: "1px solid #e7e5e4" }}>
                        <input autoFocus placeholder="Ürün ara..." value={productSearch} onChange={e => setProductSearch(e.target.value)}
                          style={{ width: "100%", padding: "8px", border: "1px solid #e7e5e4", borderRadius: 6, fontSize: 13, marginBottom: 8 }} />
                        {productSearch && filteredProducts.map(p => (
                          <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 8px", borderRadius: 6, cursor: "pointer", background: "#fff", marginBottom: 4, border: "1px solid #e7e5e4" }}>
                            <div>
                              <div style={{ fontSize: 12, fontWeight: 600 }}>{p.name}</div>
                              <div style={{ fontSize: 10, color: "#78716c" }}>{p.sku} • Stok: {p.quantity ?? 0}</div>
                            </div>
                            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                              <input type="number" min={1} value={productQty} onChange={e => setProductQty(+e.target.value)}
                                style={{ width: 50, padding: "4px", border: "1px solid #e7e5e4", borderRadius: 5, fontSize: 12, textAlign: "center" }} />
                              <button onClick={() => addProductToBox(box.id, p, productQty)}
                                style={{ padding: "4px 10px", background: "#18181b", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 12 }}>Ekle</button>
                            </div>
                          </div>
                        ))}
                        <button onClick={() => { setAddingProduct(null); setProductSearch(""); }}
                          style={{ marginTop: 4, padding: "4px 10px", background: "#f5f5f4", border: "1px solid #e7e5e4", borderRadius: 5, cursor: "pointer", fontSize: 12 }}>İptal</button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Label Designer Tab */}
      {tab === "label_designer" && <LabelDesigner />}
    </div>
  );
}

// ─── SETTINGS PAGE ───────────────────────────────────────────────────────────
// ─── İKAS ENTEGRASYON SAYFASI ────────────────────────────────────────────────
function IkasPage({ products, setProducts, movements, user, notify }) {
  const EDGE_URL = `${SUPABASE_URL}/functions/v1/ikas-proxy`;

  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(null); // null | "products" | "orders" | "test"
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [tab, setTab] = useState("dashboard"); // "dashboard" | "orders" | "settings"
  const [form, setForm] = useState({ store_name: "", client_id: "", client_secret: "" });
  const [showSecret, setShowSecret] = useState(false);
  const [syncLog, setSyncLog] = useState([]);

  const isAdmin = user.role === "admin";
  const isConnected = !!(settings?.store_name && settings?.client_id && settings?.client_secret);
  const supabaseUrl = window.SUPABASE_URL || supabase.supabaseUrl || "";

  useEffect(() => { loadSettings(); loadOrders(); }, []);

  const addLog = (msg, type = "info") => {
    setSyncLog(prev => [{ msg, type, time: new Date().toLocaleTimeString("tr-TR") }, ...prev.slice(0, 19)]);
  };

  const loadSettings = async () => {
    setLoading(true);
    const { data } = await supabase.from("ikas_settings").select("*").single();
    if (data) {
      setSettings(data);
      setForm({ store_name: data.store_name || "", client_id: data.client_id || "", client_secret: "" });
    }
    setLoading(false);
  };

  const loadOrders = async () => {
    setOrdersLoading(true);
    const { data } = await supabase.from("ikas_orders").select("*").order("created_at_ikas", { ascending: false }).limit(50);
    if (data) setOrders(data);
    setOrdersLoading(false);
  };

  const saveSettings = async () => {
    if (!form.store_name || !form.client_id) { notify("Mağaza adı ve Client ID zorunludur", "error"); return; }
    setSaving(true);
    const updateData = {
      store_name: form.store_name.replace(/\.myikas\.com.*/, "").trim(),
      client_id: form.client_id.trim(),
      ...(form.client_secret ? { client_secret: form.client_secret.trim(), access_token: "", token_expires_at: null } : {}),
    };
    const { error } = await supabase.from("ikas_settings").update(updateData).eq("id", settings?.id || "00000000-0000-0000-0000-000000000001");
    if (error) { notify("Kaydedilemedi: " + error.message, "error"); }
    else { notify("İkas ayarları kaydedildi"); await loadSettings(); }
    setSaving(false);
  };

  const callProxy = async (action, extra = {}) => {
    const anonKey = SUPABASE_ANON_KEY || supabase.supabaseKey || "";
    const res = await fetch(EDGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${anonKey}` },
      body: JSON.stringify({ action, ...extra }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  };

  const testConnection = async () => {
    setSyncing("test");
    try {
      const data = await callProxy("testConnection");
      addLog(`✓ Bağlantı başarılı — Client ID: ${data.clientId}`, "success");
      notify("İkas bağlantısı başarılı!");
      await loadSettings();
    } catch (e) { addLog(`✗ Bağlantı hatası: ${e.message}`, "error"); notify("Bağlantı başarısız: " + e.message, "error"); }
    setSyncing(null);
  };

  const syncProducts = async () => {
    setSyncing("products");
    addLog("Ürün senkronizasyonu başladı...", "info");
    try {
      const data = await callProxy("syncProducts");
      addLog(`✓ ${data.created} yeni ürün eklendi, ${data.synced} güncellendi (toplam ${data.total})`, "success");
      notify(`Senkronizasyon tamamlandı: ${data.created} yeni, ${data.synced} güncellendi`);
      // Ürünleri yenile
      const { data: fresh } = await supabase.from("products").select("*").order("created_at", { ascending: false });
      if (fresh) setProducts(fresh.map(p => ({
        id: p.id, name: p.name, sku: p.sku, barcode: p.barcode || "",
        category: p.category || "", brand: p.brand || "", location: p.location || "",
        variant: p.variant || "", stock: p.stock, minStock: p.min_stock,
        costPrice: p.cost_price, salePrice: p.sale_price, vatRate: p.vat_rate || 20,
        description: p.description || "", ikas_variant_id: p.ikas_variant_id || "", ikas_product_id: p.ikas_product_id || "",
      })));
      await loadSettings();
    } catch (e) { addLog(`✗ Ürün sync hatası: ${e.message}`, "error"); notify("Sync hatası: " + e.message, "error"); }
    setSyncing(null);
  };

  const syncOrders = async () => {
    setSyncing("orders");
    addLog("Sipariş senkronizasyonu başladı...", "info");
    try {
      const data = await callProxy("syncOrders");
      addLog(`✓ ${data.count} sipariş senkronize edildi`, "success");
      notify(`${data.count} sipariş güncellendi`);
      await loadOrders();
    } catch (e) { addLog(`✗ Sipariş sync hatası: ${e.message}`, "error"); notify("Hata: " + e.message, "error"); }
    setSyncing(null);
  };

  const togglePushStock = async () => {
    const newVal = !settings?.push_stock_enabled;
    await supabase.from("ikas_settings").update({ push_stock_enabled: newVal }).eq("id", settings.id);
    setSettings(s => ({ ...s, push_stock_enabled: newVal }));
    notify(`Anlık stok push ${newVal ? "aktif" : "pasif"}`);
  };

  const fmt = (d) => d ? new Date(d).toLocaleString("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
  const statusColor = (s) => ({ "PAID": "#16a34a", "PENDING": "#ca8a04", "CANCELLED": "#dc2626", "REFUNDED": "#7c3aed" }[s] || "#78716c");
  const statusLabel = (s) => ({ "PAID": "Ödendi", "PENDING": "Bekliyor", "CANCELLED": "İptal", "REFUNDED": "İade" }[s] || s);

  const tabStyle = (t) => ({
    padding: "8px 16px", background: tab === t ? "#18181b" : "transparent",
    border: "none", borderRadius: 8, color: tab === t ? "#fff" : "#78716c",
    cursor: "pointer", fontSize: 13, fontWeight: 600, transition: "all 0.15s",
  });

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "#a8a29e" }}>Yükleniyor...</div>;

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: "linear-gradient(135deg, #6366f1, #8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M7 8l3 3-3 3M13 14h4"/></svg>
          </div>
          <div>
            <h1 style={{ fontSize: 21, fontWeight: 700, margin: 0, letterSpacing: "-0.03em" }}>İkas Entegrasyon</h1>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
              <div style={{ width: 7, height: 7, borderRadius: 99, background: isConnected ? "#22c55e" : "#e7e5e4" }} />
              <span style={{ fontSize: 12.5, color: isConnected ? "#16a34a" : "#a8a29e" }}>
                {isConnected ? `${settings.store_name}.myikas.com bağlı` : "Bağlantı kurulmadı"}
              </span>
            </div>
          </div>
        </div>
        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, background: "#f5f5f4", borderRadius: 10, padding: 4 }}>
          {[["dashboard", "📊 Özet"], ["orders", "📦 Siparişler"], ["settings", "⚙️ Ayarlar"]].map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)} style={tabStyle(t)}>{label}</button>
          ))}
        </div>
      </div>

      {/* ── DASHBOARD TAB ── */}
      {tab === "dashboard" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Not connected warning */}
          {!isConnected && (
            <div style={{ background: "#fefce8", border: "1px solid #fde68a", borderRadius: 12, padding: "16px 20px", display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 20 }}>⚠️</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#92400e" }}>İkas bağlantısı kurulmamış</div>
                <div style={{ fontSize: 13, color: "#a16207", marginTop: 2 }}>Ayarlar sekmesinden Client ID ve Secret girerek bağlanın.</div>
              </div>
              <button onClick={() => setTab("settings")} style={{ marginLeft: "auto", padding: "7px 14px", background: "#18181b", border: "none", borderRadius: 8, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 500 }}>
                Ayarlara Git →
              </button>
            </div>
          )}

          {/* Stats */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
            {[
              { label: "Bağlı Ürün", value: products.filter(p => p.ikas_variant_id).length, icon: "📦", sub: `${products.length} toplam` },
              { label: "Sipariş", value: orders.length, icon: "🛒", sub: "son 50" },
              { label: "Son Sync", value: settings?.last_sync ? fmt(settings.last_sync) : "—", icon: "🔄", sub: settings?.last_sync_result || "" },
            ].map(s => (
              <div key={s.label} style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: 12, padding: "16px 18px" }}>
                <div style={{ fontSize: 22, marginBottom: 8 }}>{s.icon}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#18181b" }}>{s.value}</div>
                <div style={{ fontSize: 12, color: "#a8a29e", marginTop: 2 }}>{s.label}</div>
                {s.sub && <div style={{ fontSize: 11, color: "#c8c4be", marginTop: 2 }}>{s.sub}</div>}
              </div>
            ))}
          </div>

          {/* Sync buttons */}
          <div style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: 14, padding: 24 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#18181b", margin: "0 0 16px" }}>Senkronizasyon</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              {[
                { action: "test", label: "Bağlantı Test Et", icon: "🔌", fn: testConnection, desc: "API erişimini doğrula" },
                { action: "products", label: "Ürünleri Çek", icon: "📥", fn: syncProducts, desc: "İkas'tan tüm ürünleri senkronize et" },
                { action: "orders", label: "Siparişleri Çek", icon: "📋", fn: syncOrders, desc: "Son 50 siparişi güncelle" },
              ].map(btn => (
                <button key={btn.action} onClick={btn.fn} disabled={!isConnected || syncing !== null}
                  style={{ padding: "16px", background: syncing === btn.action ? "#f5f5f4" : "#fafaf9", border: `1px solid ${syncing === btn.action ? "#6366f1" : "#e7e5e4"}`, borderRadius: 12, cursor: isConnected && syncing === null ? "pointer" : "not-allowed", opacity: (!isConnected || (syncing !== null && syncing !== btn.action)) ? 0.5 : 1, textAlign: "left", transition: "all 0.15s" }}>
                  <div style={{ fontSize: 22, marginBottom: 8 }}>{syncing === btn.action ? "⏳" : btn.icon}</div>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: "#18181b" }}>{syncing === btn.action ? "İşleniyor..." : btn.label}</div>
                  <div style={{ fontSize: 12, color: "#a8a29e", marginTop: 3 }}>{btn.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Push stock toggle */}
          <div style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: 14, padding: 20, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#18181b", display: "flex", alignItems: "center", gap: 8 }}>
                <span>⚡ Anlık Stok Push</span>
                {settings?.push_stock_enabled && <span style={{ fontSize: 11, background: "#dcfce7", color: "#16a34a", borderRadius: 99, padding: "2px 8px", fontWeight: 500 }}>Aktif</span>}
              </div>
              <div style={{ fontSize: 12.5, color: "#a8a29e", marginTop: 3 }}>Stok hareketi olduğunda İkas stoku otomatik güncellenir</div>
            </div>
            <button onClick={togglePushStock} disabled={!isConnected}
              style={{ width: 46, height: 26, borderRadius: 99, border: "none", background: settings?.push_stock_enabled ? "#22c55e" : "#e7e5e4", cursor: isConnected ? "pointer" : "not-allowed", position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
              <div style={{ width: 20, height: 20, borderRadius: 99, background: "#fff", position: "absolute", top: 3, left: settings?.push_stock_enabled ? 23 : 3, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
            </button>
          </div>

          {/* Sync log */}
          {syncLog.length > 0 && (
            <div style={{ background: "#18181b", borderRadius: 12, padding: 16, fontFamily: "monospace" }}>
              <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 10, fontFamily: "inherit" }}>SYNC LOG</div>
              {syncLog.map((l, i) => (
                <div key={i} style={{ fontSize: 12, color: l.type === "error" ? "#f87171" : l.type === "success" ? "#4ade80" : "#9ca3af", marginBottom: 4 }}>
                  <span style={{ color: "#4b5563" }}>[{l.time}]</span> {l.msg}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── ORDERS TAB ── */}
      {tab === "orders" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ fontSize: 14, color: "#78716c" }}>{orders.length} sipariş</div>
            <button onClick={syncOrders} disabled={syncing === "orders" || !isConnected}
              style={{ padding: "8px 16px", background: "#18181b", border: "none", borderRadius: 8, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 500, opacity: (!isConnected || syncing === "orders") ? 0.5 : 1 }}>
              {syncing === "orders" ? "⏳ Yükleniyor..." : "🔄 Güncelle"}
            </button>
          </div>
          <div style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: 12, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#fafaf9", borderBottom: "1px solid #f0eeed" }}>
                  {["Sipariş No", "Müşteri", "Ürünler", "Toplam", "Tarih", "Durum"].map(h => (
                    <th key={h} style={{ padding: "10px 16px", textAlign: "left", color: "#a8a29e", fontSize: 10.5, fontWeight: 600, textTransform: "uppercase" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ordersLoading ? (
                  <tr><td colSpan={6} style={{ padding: 40, textAlign: "center", color: "#a8a29e" }}>Yükleniyor...</td></tr>
                ) : orders.length === 0 ? (
                  <tr><td colSpan={6} style={{ padding: 48, textAlign: "center" }}>
                    <div style={{ fontSize: 28, marginBottom: 10 }}>🛒</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#18181b" }}>Henüz sipariş yok</div>
                    <div style={{ fontSize: 13, color: "#a8a29e", marginTop: 4 }}>Güncelle butonuna basarak İkas'tan siparişleri çekin</div>
                  </td></tr>
                ) : orders.map(o => (
                  <tr key={o.id} className="table-row" style={{ borderBottom: "1px solid #f5f5f4" }}>
                    <td style={{ padding: "12px 16px", fontFamily: "monospace", fontSize: 13, fontWeight: 600, color: "#18181b" }}>#{o.order_number}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: "#18181b" }}>{o.customer_name || "—"}</div>
                      <div style={{ fontSize: 11.5, color: "#a8a29e" }}>{o.customer_email}</div>
                    </td>
                    <td style={{ padding: "12px 16px", fontSize: 12.5, color: "#78716c" }}>
                      {Array.isArray(o.items) ? o.items.map((item, i) => (
                        <div key={i}>{item.variant?.product?.name || "Ürün"} × {item.quantity}</div>
                      )) : "—"}
                    </td>
                    <td style={{ padding: "12px 16px", fontWeight: 700, color: "#18181b" }}>
                      ₺{Number(o.total_price || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 })}
                    </td>
                    <td style={{ padding: "12px 16px", fontSize: 12.5, color: "#78716c", whiteSpace: "nowrap" }}>{fmt(o.created_at_ikas)}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <span style={{ background: `${statusColor(o.status)}20`, color: statusColor(o.status), borderRadius: 99, padding: "3px 10px", fontSize: 11.5, fontWeight: 500, whiteSpace: "nowrap" }}>
                        {statusLabel(o.status)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── SETTINGS TAB ── */}
      {tab === "settings" && isAdmin && (
        <div style={{ maxWidth: 600 }}>
          <div style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: 14, padding: 28, marginBottom: 16 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: "#18181b", margin: "0 0 6px" }}>İkas API Bilgileri</h3>
            <p style={{ fontSize: 13, color: "#a8a29e", margin: "0 0 20px" }}>
              İkas paneli → Uygulamalar → Uygulamalarım → Private App oluştur
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ color: "#78716c", fontSize: 12, fontWeight: 500, display: "block", marginBottom: 6 }}>Mağaza Adı <span style={{ color: "#ef4444" }}>*</span></label>
                <div style={{ display: "flex", alignItems: "center", gap: 0, border: "1px solid #e7e5e4", borderRadius: 9, overflow: "hidden" }}>
                  <input value={form.store_name} onChange={e => setForm(f => ({ ...f, store_name: e.target.value }))}
                    placeholder="magaza-adiniz"
                    style={{ flex: 1, background: "#fafaf9", border: "none", padding: "10px 14px", fontSize: 14, outline: "none", fontFamily: "inherit", color: "#1c1917" }} />
                  <span style={{ padding: "10px 14px", background: "#f0eeed", fontSize: 13, color: "#78716c", borderLeft: "1px solid #e7e5e4", whiteSpace: "nowrap" }}>.myikas.com</span>
                </div>
              </div>
              <div>
                <label style={{ color: "#78716c", fontSize: 12, fontWeight: 500, display: "block", marginBottom: 6 }}>Client ID <span style={{ color: "#ef4444" }}>*</span></label>
                <input value={form.client_id} onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  style={{ width: "100%", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 9, padding: "10px 14px", fontSize: 13.5, outline: "none", fontFamily: "monospace", color: "#1c1917" }} />
              </div>
              <div>
                <label style={{ color: "#78716c", fontSize: 12, fontWeight: 500, display: "block", marginBottom: 6 }}>
                  Client Secret {settings?.client_secret ? <span style={{ color: "#16a34a", fontWeight: 400 }}>(kayıtlı ✓)</span> : <span style={{ color: "#ef4444" }}>*</span>}
                </label>
                <div style={{ position: "relative" }}>
                  <input value={form.client_secret} onChange={e => setForm(f => ({ ...f, client_secret: e.target.value }))}
                    type={showSecret ? "text" : "password"}
                    placeholder={settings?.client_secret ? "Değiştirmek için yeni secret girin" : "Client Secret"}
                    style={{ width: "100%", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 9, padding: "10px 40px 10px 14px", fontSize: 13.5, outline: "none", fontFamily: "monospace", color: "#1c1917" }} />
                  <button onClick={() => setShowSecret(s => !s)}
                    style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#a8a29e", fontSize: 16 }}>
                    {showSecret ? "🙈" : "👁"}
                  </button>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button onClick={saveSettings} disabled={saving}
                style={{ flex: 1, padding: "11px", background: "#18181b", border: "none", borderRadius: 9, color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
                {saving ? "Kaydediliyor..." : "Kaydet"}
              </button>
              {isConnected && (
                <button onClick={testConnection} disabled={syncing !== null}
                  style={{ padding: "11px 20px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 9, color: "#16a34a", cursor: "pointer", fontSize: 14, fontWeight: 500 }}>
                  {syncing === "test" ? "⏳" : "🔌 Test Et"}
                </button>
              )}
            </div>
          </div>

          {/* Kurulum rehberi */}
          <div style={{ background: "#f8faff", border: "1px solid #dbeafe", borderRadius: 14, padding: 24 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#1e40af", margin: "0 0 14px", display: "flex", alignItems: "center", gap: 7 }}>
              📖 Kurulum Rehberi
            </h3>
            {[
              ["1", "Private App Oluştur", "İkas Admin → Uygulamalar → Uygulamalarım → 'Daha Fazla' → Private App Oluştur"],
              ["2", "Scope Seç", "products:read, products:write, orders:read izinlerini seçin"],
              ["3", "Credentials Kopyala", "Client ID ve Secret'ı buraya yapıştırın"],
              ["4", "Edge Function Deploy Et", "Aşağıdaki terminal komutlarını çalıştırın"],
              ["5", "Webhook Kur", "Supabase Dashboard → Database → Webhooks"],
            ].map(([num, title, desc]) => (
              <div key={num} style={{ display: "flex", gap: 12, marginBottom: 12 }}>
                <div style={{ width: 24, height: 24, borderRadius: 99, background: "#3b82f6", color: "#fff", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{num}</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#1e40af" }}>{title}</div>
                  <div style={{ fontSize: 12, color: "#3b82f6", marginTop: 2 }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "settings" && !isAdmin && (
        <div style={{ padding: 40, textAlign: "center", color: "#a8a29e" }}>Bu sayfayı görüntülemek için admin yetkisi gereklidir.</div>
      )}
    </div>
  );
}


function SevkiyatPage({ products, setProducts, setMovements, user, notify }) {
  const [view, setView] = useState("list");
  const [sevkiyatlar, setSevkiyatlar] = useState([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ no: "", musteri: "", adres: "", tel: "", tarih: new Date().toISOString().split("T")[0], tip: "serbest", aciklama: "" });
  const [koliler, setKoliler] = useState([]);
  const [activeKoli, setActiveKoli] = useState(null);
  const [barcodeInput, setBarcodeInput] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editId, setEditId] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [labelSettings, setLabelSettings] = useState({
    width: 100, height: 70,
    firmaAdi: "FİRMA ADI",
    logoUrl: "",
    showLogo: false,
    showFirmaAdi: true, showMusteri: true, showAdres: true,
    showSevkNo: true, showKoliNo: true, showTarih: true,
    showBarkod: true, showUrunler: true, maxUrun: 8,
    fontSize: 8, fontSizeBaslik: 11,
  });

  const fmt = (d) => d ? new Date(d).toLocaleDateString("tr-TR") : "-";
  const genNo = () => `SVK-${Date.now().toString().slice(-6)}`;

  useEffect(() => { loadSevkiyatlar(); }, []);

  const loadSevkiyatlar = async () => {
    setLoading(true);
    const { data } = await supabase.from("sevkiyatlar").select("*").order("created_at", { ascending: false }).limit(100);
    if (data) setSevkiyatlar(data);
    setLoading(false);
  };

  const newSevkiyat = () => {
    setEditId(null);
    setForm({ no: genNo(), musteri: "", adres: "", tel: "", tarih: new Date().toISOString().split("T")[0], tip: "serbest", aciklama: "" });
    setKoliler([{ id: 1, no: "K-001", urunler: [] }]);
    setActiveKoli(1);
    setView("new");
  };

  const editSevkiyat = (s) => {
    setEditId(s.id);
    setForm({ no: s.no, musteri: s.musteri, adres: s.adres||"", tel: s.tel||"", tarih: s.tarih||new Date().toISOString().split("T")[0], tip: s.tip||"serbest", aciklama: s.aciklama||"" });
    setKoliler(s.koliler || [{ id: 1, no: "K-001", urunler: [] }]);
    setActiveKoli((s.koliler||[{ id: 1 }])[0]?.id || 1);
    setView("new");
  };

  const deleteSevkiyat = async (id) => {
    const { error } = await supabase.from("sevkiyatlar").delete().eq("id", id);
    if (error) return notify("Hata: " + error.message);
    setSevkiyatlar(prev => prev.filter(s => s.id !== id));
    setDeleteConfirm(null);
    notify("Sevkiyat silindi");
  };

  const addKoli = () => {
    const newId = Math.max(...koliler.map(k => k.id), 0) + 1;
    setKoliler(prev => [...prev, { id: newId, no: `K-${String(newId).padStart(3,"0")}`, urunler: [] }]);
    setActiveKoli(newId);
  };

  const removeKoli = (id) => {
    if (koliler.length === 1) return notify("En az 1 koli olmalı");
    setKoliler(prev => prev.filter(k => k.id !== id));
    if (activeKoli === id) setActiveKoli(koliler.find(k => k.id !== id)?.id);
  };

  const addProductToKoli = (product, qty = 1) => {
    setKoliler(prev => prev.map(k => {
      if (k.id !== activeKoli) return k;
      const existing = k.urunler.find(u => u.productId === product.id);
      if (existing) return { ...k, urunler: k.urunler.map(u => u.productId === product.id ? { ...u, qty: u.qty + qty } : u) };
      return { ...k, urunler: [...k.urunler, { productId: product.id, productName: product.name, sku: product.sku || "", barcode: product.barcode || "", qty }] };
    }));
    setBarcodeInput(""); setSearchQ("");
  };

  const updateQty = (koliId, productId, qty) => {
    setKoliler(prev => prev.map(k => k.id !== koliId ? k : {
      ...k, urunler: qty <= 0 ? k.urunler.filter(u => u.productId !== productId) : k.urunler.map(u => u.productId === productId ? { ...u, qty } : u)
    }));
  };

  const handleBarcodeKey = (e) => {
    if (e.key === "Enter") {
      const val = barcodeInput.trim();
      if (!val) return;
      const found = products.find(p => p.barcode === val || p.sku === val);
      if (found) addProductToKoli(found);
      else notify("Ürün bulunamadı: " + val);
      setBarcodeInput("");
    }
  };

  const totalUrun = () => koliler.reduce((s, k) => s + k.urunler.reduce((ss, u) => ss + u.qty, 0), 0);

  const saveSevkiyat = async () => {
    if (!form.musteri) return notify("Müşteri adı zorunlu");
    if (totalUrun() === 0) return notify("En az 1 ürün ekleyin");
    setSubmitting(true);
    const row = { no: form.no, musteri: form.musteri, adres: form.adres, tel: form.tel, tarih: form.tarih, aciklama: form.aciklama, durum: "hazırlanıyor", koliler, toplam_koli: koliler.length, toplam_urun: totalUrun(), created_by: user.username };
    let error;
    if (editId) {
      const res = await supabase.from("sevkiyatlar").update(row).eq("id", editId).select().single();
      error = res.error;
      if (!error) { setSevkiyatlar(prev => prev.map(s => s.id === editId ? res.data : s)); notify("Sevkiyat güncellendi"); }
    } else {
      const res = await supabase.from("sevkiyatlar").insert([row]).select().single();
      error = res.error;
      if (!error) { setSevkiyatlar(prev => [res.data, ...prev]); notify(`Sevkiyat kaydedildi (${koliler.length} koli)`); }
    }
    if (error) { notify("Hata: " + error.message); setSubmitting(false); return; }
    setView("list"); setSubmitting(false);
  };

  // Logo upload handler
  const handleLogoUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setLabelSettings(p => ({...p, logoUrl: ev.target.result, showLogo: true}));
    reader.readAsDataURL(file);
  };

  const generateLabelHTML = (koli, sevk, koliIdx, toplamKoli) => {
    const ls = labelSettings;
    return `<div style="width:${ls.width}mm;height:${ls.height}mm;border:1.5px solid #000;padding:3mm;box-sizing:border-box;font-family:Arial,sans-serif;font-size:${ls.fontSize}pt;page-break-after:always;background:white;display:flex;flex-direction:column;gap:1mm;overflow:hidden;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid #000;padding-bottom:1.5mm;margin-bottom:1mm;">
        <div style="display:flex;align-items:center;gap:2mm;">
          ${ls.showLogo && ls.logoUrl ? `<img src="${ls.logoUrl}" style="height:8mm;max-width:20mm;object-fit:contain;" />` : ""}
          ${ls.showFirmaAdi ? `<span style="font-size:${ls.fontSizeBaslik}pt;font-weight:bold;">${ls.firmaAdi}</span>` : ""}
        </div>
        <div style="text-align:right;font-size:${ls.fontSize-1}pt;">
          ${ls.showSevkNo ? `<div><b>${sevk.no}</b></div>` : ""}
          ${ls.showTarih ? `<div>${fmt(sevk.tarih)}</div>` : ""}
        </div>
      </div>
      ${ls.showMusteri || ls.showAdres ? `<div style="font-size:${ls.fontSize}pt;margin-bottom:1mm;">${ls.showMusteri ? `<div><b>${sevk.musteri}</b></div>` : ""}${ls.showAdres && sevk.adres ? `<div style="color:#444;font-size:${ls.fontSize-1}pt;">${sevk.adres}</div>` : ""}</div>` : ""}
      ${ls.showKoliNo ? `<div style="background:#000;color:#fff;padding:1.5mm 2mm;font-weight:bold;font-size:${ls.fontSizeBaslik+1}pt;text-align:center;letter-spacing:0.05em;">KOLİ ${koliIdx} / ${toplamKoli}</div>` : ""}
      ${ls.showUrunler ? `<div style="flex:1;overflow:hidden;">
        <table style="width:100%;border-collapse:collapse;font-size:${ls.fontSize-1}pt;">
          <tr style="border-bottom:1px solid #ddd;"><th style="text-align:left;padding:0.5mm 1mm;">Ürün</th><th style="text-align:center;padding:0.5mm 1mm;width:12mm;">SKU</th><th style="text-align:right;padding:0.5mm 1mm;width:8mm;">Adet</th></tr>
          ${koli.urunler.slice(0,ls.maxUrun).map(u=>`<tr style="border-bottom:1px solid #f0f0f0;"><td style="padding:0.5mm 1mm;">${u.productName.substring(0,22)}${u.productName.length>22?"…":""}</td><td style="padding:0.5mm 1mm;text-align:center;font-size:${ls.fontSize-2}pt;color:#666;">${u.sku||"-"}</td><td style="padding:0.5mm 1mm;text-align:right;font-weight:bold;">${u.qty}</td></tr>`).join("")}
          ${koli.urunler.length>ls.maxUrun?`<tr><td colspan="3" style="padding:0.5mm 1mm;color:#888;font-size:${ls.fontSize-2}pt;">+${koli.urunler.length-ls.maxUrun} ürün daha...</td></tr>`:""}
          <tr style="border-top:1px solid #000;font-weight:bold;"><td colspan="2" style="padding:0.5mm 1mm;">TOPLAM</td><td style="text-align:right;padding:0.5mm 1mm;">${koli.urunler.reduce((s,u)=>s+u.qty,0)}</td></tr>
        </table>
      </div>` : ""}
      ${ls.showBarkod ? `<div style="text-align:center;margin-top:auto;padding-top:1mm;"><svg xmlns="http://www.w3.org/2000/svg" width="160" height="32"><rect width="160" height="32" fill="white"/>${Array.from({length:80},(_,i)=>`<rect x="${i*2}" y="0" width="${i%3===0?2:1}" height="24" fill="black"/>`).join("")}<text x="80" y="31" text-anchor="middle" font-size="6" font-family="monospace">${sevk.no}-K${String(koliIdx).padStart(3,"0")}</text></svg></div>` : ""}
    </div>`;
  };

  const printLabels = (sevkData) => {
    const allKoliler = sevkData.koliler || [];
    const html = `<!DOCTYPE html><html><head><style>@page{margin:0;size:${labelSettings.width}mm ${labelSettings.height}mm;}body{margin:0;padding:0;}</style></head><body>${allKoliler.map((k,i)=>generateLabelHTML(k,sevkData,i+1,allKoliler.length)).join("")}</body></html>`;
    const win = window.open("","_blank"); win.document.write(html); win.document.close(); setTimeout(()=>win.print(),500);
  };

  const printPackingList = (sevkData) => {
    const allKoliler = sevkData.koliler || [];
    const html = `<!DOCTYPE html><html><head><style>@page{margin:12mm;}body{font-family:Arial,sans-serif;font-size:10pt;}.header{display:flex;justify-content:space-between;border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:12px;}.koli-block{border:1px solid #ccc;margin-bottom:10px;page-break-inside:avoid;}.koli-header{background:#000;color:#fff;padding:5px 10px;font-weight:bold;display:flex;justify-content:space-between;}table{width:100%;border-collapse:collapse;}th{background:#f0f0f0;text-align:left;padding:4px 8px;border-bottom:1px solid #ccc;font-size:9pt;}td{padding:3px 8px;border-bottom:1px solid #eee;font-size:9pt;}.total{font-weight:bold;background:#f9f9f9;}</style></head><body>
      <div class="header"><div>${labelSettings.showLogo && labelSettings.logoUrl ? `<img src="${labelSettings.logoUrl}" style="height:16mm;max-width:40mm;object-fit:contain;margin-bottom:4px;display:block;" />` : ""}<h2 style="margin:0;">📦 PACKING LIST</h2><h3 style="margin:4px 0 0;">${sevkData.no}</h3></div><div style="text-align:right;"><div><b>Tarih:</b> ${fmt(sevkData.tarih)}</div><div><b>Müşteri:</b> ${sevkData.musteri}</div>${sevkData.adres?`<div style="font-size:9pt;color:#555;">${sevkData.adres}</div>`:""}<div style="margin-top:4px;"><b>${allKoliler.length} Koli / ${sevkData.toplam_urun||0} Ürün</b></div></div></div>
      ${allKoliler.map((koli,idx)=>`<div class="koli-block"><div class="koli-header"><span>KOLİ ${idx+1} / ${allKoliler.length} — ${koli.no}</span><span>${koli.urunler.reduce((s,u)=>s+u.qty,0)} adet</span></div><table><tr><th>#</th><th>Ürün Adı</th><th>SKU</th><th>Barkod</th><th>Adet</th></tr>${koli.urunler.map((u,i)=>`<tr><td>${i+1}</td><td>${u.productName}</td><td>${u.sku||"-"}</td><td>${u.barcode||"-"}</td><td><b>${u.qty}</b></td></tr>`).join("")}<tr class="total"><td colspan="4">TOPLAM</td><td>${koli.urunler.reduce((s,u)=>s+u.qty,0)}</td></tr></table></div>`).join("")}
      <div style="margin-top:16px;border-top:1px solid #ccc;padding-top:6px;font-size:8pt;color:#888;">StokPro • ${new Date().toLocaleString("tr-TR")} • Hazırlayan: ${sevkData.created_by||"-"}</div>
    </body></html>`;
    const win = window.open("","_blank"); win.document.write(html); win.document.close(); setTimeout(()=>win.print(),500);
  };

  const filteredProducts = searchQ.length > 1 ? products.filter(p => p.name?.toLowerCase().includes(searchQ.toLowerCase()) || p.sku?.toLowerCase().includes(searchQ.toLowerCase())).slice(0,8) : [];
  const durumRenk = { "hazırlanıyor": "#ca8a04", "tamamlandı": "#16a34a", "iptal": "#dc2626", "beklemede": "#7c3aed" };

  // ─── ETIKET TASARIMI ──────────────────────────────────────────────────────
  if (view === "label-designer") {
    const ls = labelSettings;
    const prev_sevk = { no: "SVK-001234", musteri: "Örnek Müşteri A.Ş.", adres: "Atatürk Cad. No:5 İstanbul", tarih: new Date().toISOString() };
    const prev_koli = { id:1, no:"K-001", urunler:[{productName:"Ürün Adı Örnek 1",sku:"SKU001",barcode:"1234567890",qty:12},{productName:"Ürün Adı Örnek 2",sku:"SKU002",barcode:"0987654321",qty:5},{productName:"Ürün Adı Örnek 3",sku:"SKU003",barcode:"1122334455",qty:8},{productName:"Ürün Adı Örnek 4",sku:"SKU004",barcode:"5566778899",qty:3}]};
    const Tog = ({lbl, k}) => (
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <span style={{fontSize:13}}>{lbl}</span>
        <div onClick={()=>setLabelSettings(p=>({...p,[k]:!p[k]}))} style={{width:36,height:20,borderRadius:10,background:ls[k]?"#22c55e":"#e7e5e4",cursor:"pointer",position:"relative",transition:"background 0.2s"}}>
          <div style={{position:"absolute",top:2,left:ls[k]?18:2,width:16,height:16,borderRadius:"50%",background:"#fff",transition:"left 0.2s",boxShadow:"0 1px 3px rgba(0,0,0,0.2)"}}/>
        </div>
      </div>
    );
    const Inp = ({lbl, k, type="text", min, max}) => (
      <div style={{marginBottom:12}}>
        <label style={{display:"block",fontSize:11,fontWeight:600,color:"#78716c",marginBottom:4}}>{lbl}</label>
        <input type={type} value={ls[k]} min={min} max={max} onChange={e=>setLabelSettings(p=>({...p,[k]:type==="number"?Number(e.target.value):e.target.value}))} style={{width:"100%",padding:"6px 10px",border:"1px solid #e7e5e4",borderRadius:6,fontSize:13,boxSizing:"border-box"}}/>
      </div>
    );
    return (
      <div style={{display:"flex",height:"calc(100vh - 60px)",overflow:"hidden",background:"#f5f5f4"}}>
        <div style={{width:290,background:"#fff",borderRight:"1px solid #e7e5e4",overflowY:"auto",padding:20,flexShrink:0}}>
          <button onClick={()=>setView("list")} style={{display:"flex",alignItems:"center",gap:6,background:"none",border:"none",cursor:"pointer",color:"#78716c",fontSize:13,marginBottom:16,padding:0}}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg> Geri
          </button>
          <h3 style={{fontSize:15,fontWeight:700,margin:"0 0 16px"}}>🎨 Etiket Tasarımcısı</h3>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <Inp lbl="Genişlik (mm)" k="width" type="number" min={40} max={200}/>
            <Inp lbl="Yükseklik (mm)" k="height" type="number" min={30} max={200}/>
          </div>

          {/* Logo bölümü */}
          <div style={{background:"#f9f8f7",borderRadius:8,padding:"12px 14px",marginBottom:12}}>
            <div style={{fontSize:11,fontWeight:700,color:"#78716c",marginBottom:8,textTransform:"uppercase",letterSpacing:"0.05em"}}>Logo</div>
            <Tog lbl="Logo Göster" k="showLogo"/>
            {ls.showLogo && (
              <div>
                <label style={{display:"block",width:"100%",padding:"8px",background:"#fff",border:"2px dashed #e7e5e4",borderRadius:8,textAlign:"center",cursor:"pointer",fontSize:12,color:"#78716c"}}>
                  {ls.logoUrl ? "✅ Logo yüklendi — değiştirmek için tıkla" : "📁 Logo yükle (PNG/JPG)"}
                  <input type="file" accept="image/*" onChange={handleLogoUpload} style={{display:"none"}}/>
                </label>
                {ls.logoUrl && (
                  <div style={{marginTop:8,display:"flex",alignItems:"center",gap:8}}>
                    <img src={ls.logoUrl} style={{height:32,maxWidth:80,objectFit:"contain",border:"1px solid #e7e5e4",borderRadius:4,padding:2}}/>
                    <button onClick={()=>setLabelSettings(p=>({...p,logoUrl:"",showLogo:false}))} style={{fontSize:11,color:"#dc2626",background:"none",border:"none",cursor:"pointer"}}>Sil</button>
                  </div>
                )}
              </div>
            )}
          </div>

          <Inp lbl="Firma Adı" k="firmaAdi"/>

          <div style={{background:"#f9f8f7",borderRadius:8,padding:"12px 14px",marginBottom:12}}>
            <div style={{fontSize:11,fontWeight:700,color:"#78716c",marginBottom:8,textTransform:"uppercase",letterSpacing:"0.05em"}}>Gösterilecek Alanlar</div>
            <Tog lbl="Firma Adı" k="showFirmaAdi"/>
            <Tog lbl="Müşteri Adı" k="showMusteri"/>
            <Tog lbl="Adres" k="showAdres"/>
            <Tog lbl="Sevkiyat No" k="showSevkNo"/>
            <Tog lbl="Koli No / Toplam" k="showKoliNo"/>
            <Tog lbl="Tarih" k="showTarih"/>
            <Tog lbl="Ürün Listesi" k="showUrunler"/>
            <Tog lbl="Barkod" k="showBarkod"/>
          </div>

          {ls.showUrunler && <Inp lbl="Maks. Ürün Satırı" k="maxUrun" type="number" min={1} max={20}/>}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <Inp lbl="Font (pt)" k="fontSize" type="number" min={6} max={14}/>
            <Inp lbl="Başlık (pt)" k="fontSizeBaslik" type="number" min={8} max={18}/>
          </div>
          <button onClick={()=>printLabels({...prev_sevk, koliler:[prev_koli]})} style={{width:"100%",padding:10,background:"#18181b",color:"#fff",border:"none",borderRadius:8,fontSize:13,fontWeight:600,cursor:"pointer"}}>
            🖨️ Test Yazdır
          </button>
        </div>
        <div style={{flex:1,overflowY:"auto",padding:32,display:"flex",flexDirection:"column",alignItems:"center"}}>
          <div style={{fontSize:12,color:"#a8a29e",marginBottom:16}}>ÖNİZLEME — {ls.width}mm × {ls.height}mm</div>
          <div style={{background:"#fff",boxShadow:"0 4px 24px rgba(0,0,0,0.12)",borderRadius:8,overflow:"hidden"}} dangerouslySetInnerHTML={{__html:generateLabelHTML(prev_koli,prev_sevk,1,3)}}/>
          <div style={{marginTop:12,fontSize:11,color:"#a8a29e",textAlign:"center"}}>Yazdırırken: Kenar Boşluğu → Yok, Ölçek → 100%</div>
        </div>
      </div>
    );
  }

  // ─── YENİ / DÜZENLE SEVKİYAT ──────────────────────────────────────────────
  if (view === "new") {
    const activeKoliData = koliler.find(k => k.id === activeKoli);
    return (
      <div style={{padding:24,maxWidth:1100,margin:"0 auto"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:24}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <button onClick={()=>setView("list")} style={{background:"none",border:"none",cursor:"pointer",color:"#78716c",display:"flex",alignItems:"center",gap:4,fontSize:13}}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg> Sevkiyatlar
            </button>
            <span style={{color:"#d6d3d1"}}>/</span>
            <h2 style={{fontSize:18,fontWeight:700,margin:0}}>{editId ? "Sevkiyat Düzenle" : "Yeni Sevkiyat"}</h2>
          </div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>setView("label-designer")} style={{padding:"8px 14px",background:"#f5f5f4",border:"1px solid #e7e5e4",borderRadius:8,fontSize:13,cursor:"pointer"}}>🎨 Etiket Tasarla</button>
            <button onClick={saveSevkiyat} disabled={submitting} style={{padding:"8px 16px",background:"#18181b",color:"#fff",border:"none",borderRadius:8,fontSize:13,fontWeight:600,cursor:"pointer"}}>
              {submitting?"Kaydediliyor...": editId ? "✏️ Güncelle" : "💾 Kaydet"}
            </button>
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1.5fr",gap:20}}>
          <div>
            <div style={{background:"#fff",borderRadius:12,padding:20,border:"1px solid #e7e5e4",marginBottom:16}}>
              <div style={{fontSize:11,fontWeight:700,color:"#78716c",marginBottom:14,textTransform:"uppercase",letterSpacing:"0.05em"}}>Sevkiyat Bilgileri</div>
              {[["no","Sevkiyat No","SVK-001"],["musteri","Müşteri *","Müşteri adı"],["adres","Adres","Teslimat adresi"],["tel","Telefon","0212 555 00 00"]].map(([k,lbl,ph])=>(
                <div key={k} style={{marginBottom:10}}>
                  <label style={{display:"block",fontSize:11,fontWeight:600,color:"#78716c",marginBottom:3}}>{lbl}</label>
                  <input value={form[k]} onChange={e=>setForm(p=>({...p,[k]:e.target.value}))} placeholder={ph} style={{width:"100%",padding:"8px 10px",border:"1px solid #e7e5e4",borderRadius:8,fontSize:13,boxSizing:"border-box"}}/>
                </div>
              ))}
              <div style={{marginBottom:10}}>
                <label style={{display:"block",fontSize:11,fontWeight:600,color:"#78716c",marginBottom:3}}>Tarih</label>
                <input type="date" value={form.tarih} onChange={e=>setForm(p=>({...p,tarih:e.target.value}))} style={{width:"100%",padding:"8px 10px",border:"1px solid #e7e5e4",borderRadius:8,fontSize:13,boxSizing:"border-box"}}/>
              </div>
              <div>
                <label style={{display:"block",fontSize:11,fontWeight:600,color:"#78716c",marginBottom:3}}>Açıklama</label>
                <textarea value={form.aciklama} onChange={e=>setForm(p=>({...p,aciklama:e.target.value}))} rows={2} placeholder="İsteğe bağlı not..." style={{width:"100%",padding:"8px 10px",border:"1px solid #e7e5e4",borderRadius:8,fontSize:13,resize:"vertical",boxSizing:"border-box"}}/>
              </div>
            </div>
            <div style={{background:"#f0fdf4",borderRadius:12,padding:16,border:"1px solid #bbf7d0"}}>
              <div style={{fontSize:11,fontWeight:700,color:"#16a34a",marginBottom:10,textTransform:"uppercase",letterSpacing:"0.05em"}}>Özet</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                {[["Toplam Koli",koliler.length],["Toplam Ürün",totalUrun()+" adet"]].map(([lbl,val])=>(
                  <div key={lbl} style={{background:"#fff",borderRadius:8,padding:"10px 12px",border:"1px solid #dcfce7"}}>
                    <div style={{fontSize:11,color:"#78716c"}}>{lbl}</div>
                    <div style={{fontSize:18,fontWeight:700}}>{val}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div style={{background:"#fff",borderRadius:12,border:"1px solid #e7e5e4",overflow:"hidden"}}>
            <div style={{borderBottom:"1px solid #e7e5e4",padding:"12px 16px",display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
              {koliler.map(k=>(
                <div key={k.id} onClick={()=>setActiveKoli(k.id)} style={{display:"flex",alignItems:"center",gap:5,padding:"5px 10px",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:500,background:activeKoli===k.id?"#18181b":"#f5f5f4",color:activeKoli===k.id?"#fff":"#57534e",border:"1px solid "+(activeKoli===k.id?"#18181b":"#e7e5e4")}}>
                  📦 {k.no}
                  <span style={{background:activeKoli===k.id?"#ffffff22":"#e7e5e4",borderRadius:99,padding:"1px 5px",fontSize:11}}>{k.urunler.reduce((s,u)=>s+u.qty,0)}</span>
                  {koliler.length>1&&<span onClick={e=>{e.stopPropagation();removeKoli(k.id);}} style={{fontSize:13,opacity:0.5,marginLeft:2,fontWeight:400}}>×</span>}
                </div>
              ))}
              <button onClick={addKoli} style={{padding:"5px 10px",background:"#f0fdf4",border:"1px dashed #22c55e",borderRadius:8,fontSize:12,color:"#16a34a",cursor:"pointer",fontWeight:600}}>+ Koli Ekle</button>
            </div>
            <div style={{padding:"12px 16px",borderBottom:"1px solid #f5f5f4",display:"flex",gap:8}}>
              <input value={barcodeInput} onChange={e=>setBarcodeInput(e.target.value)} onKeyDown={handleBarcodeKey}
                placeholder="📷 Barkod okut → Enter" autoFocus
                style={{flex:1,padding:"8px 10px",border:"2px solid #18181b",borderRadius:8,fontSize:13}}/>
              <div style={{flex:1,position:"relative"}}>
                <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="🔍 Ürün ara..."
                  style={{width:"100%",padding:"8px 10px",border:"1px solid #e7e5e4",borderRadius:8,fontSize:13,boxSizing:"border-box"}}/>
                {filteredProducts.length>0&&(
                  <div style={{position:"absolute",top:"100%",left:0,right:0,background:"#fff",border:"1px solid #e7e5e4",borderRadius:8,boxShadow:"0 4px 16px rgba(0,0,0,0.1)",zIndex:100,maxHeight:180,overflowY:"auto"}}>
                    {filteredProducts.map(p=>(
                      <div key={p.id} onClick={()=>addProductToKoli(p)} style={{padding:"8px 12px",cursor:"pointer",fontSize:13,borderBottom:"1px solid #f5f5f4",display:"flex",justifyContent:"space-between"}}
                        onMouseEnter={e=>e.currentTarget.style.background="#f5f5f4"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                        <span>{p.name}</span><span style={{fontSize:11,color:"#a8a29e"}}>Stok:{p.stock}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div style={{padding:16,minHeight:200}}>
              {!activeKoliData||activeKoliData.urunler.length===0?(
                <div style={{textAlign:"center",padding:"32px 0",color:"#a8a29e",fontSize:13}}>📦 Bu koliye ürün eklenmedi<br/><small>Barkod okutun veya ürün arayın</small></div>
              ):(
                <table style={{width:"100%",borderCollapse:"collapse"}}>
                  <thead><tr>{["Ürün","SKU","Adet",""].map(h=><th key={h} style={{padding:"6px 8px",textAlign:h==="Adet"?"center":"left",fontSize:11,color:"#a8a29e",fontWeight:600,textTransform:"uppercase",borderBottom:"1px solid #f5f5f4"}}>{h}</th>)}</tr></thead>
                  <tbody>{activeKoliData.urunler.map(u=>(
                    <tr key={u.productId}>
                      <td style={{padding:"8px",fontSize:13}}>{u.productName}</td>
                      <td style={{padding:"8px",fontSize:12,color:"#78716c",fontFamily:"monospace"}}>{u.sku||"-"}</td>
                      <td style={{padding:"8px",textAlign:"center"}}>
                        <div style={{display:"flex",alignItems:"center",gap:6,justifyContent:"center"}}>
                          <button onClick={()=>updateQty(activeKoli,u.productId,u.qty-1)} style={{width:24,height:24,border:"1px solid #e7e5e4",borderRadius:6,background:"#f5f5f4",cursor:"pointer"}}>−</button>
                          <span style={{fontSize:14,fontWeight:700,minWidth:28,textAlign:"center"}}>{u.qty}</span>
                          <button onClick={()=>updateQty(activeKoli,u.productId,u.qty+1)} style={{width:24,height:24,border:"1px solid #e7e5e4",borderRadius:6,background:"#f5f5f4",cursor:"pointer"}}>+</button>
                        </div>
                      </td>
                      <td style={{padding:"8px"}}><button onClick={()=>updateQty(activeKoli,u.productId,0)} style={{background:"none",border:"none",cursor:"pointer",color:"#dc2626",fontSize:16}}>×</button></td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── LİSTE ────────────────────────────────────────────────────────────────
  return (
    <div style={{padding:24}}>
      {/* Silme onay modalı */}
      {deleteConfirm && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"#fff",borderRadius:16,padding:28,maxWidth:380,width:"90%",boxShadow:"0 20px 60px rgba(0,0,0,0.2)"}}>
            <div style={{fontSize:32,marginBottom:12,textAlign:"center"}}>🗑️</div>
            <h3 style={{fontSize:16,fontWeight:700,margin:"0 0 8px",textAlign:"center"}}>Sevkiyatı Sil</h3>
            <p style={{fontSize:13,color:"#78716c",textAlign:"center",margin:"0 0 20px"}}><b>{deleteConfirm.no}</b> numaralı sevkiyat kalıcı olarak silinecek.</p>
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>setDeleteConfirm(null)} style={{flex:1,padding:"10px",background:"#f5f5f4",border:"1px solid #e7e5e4",borderRadius:8,fontSize:13,cursor:"pointer"}}>İptal</button>
              <button onClick={()=>deleteSevkiyat(deleteConfirm.id)} style={{flex:1,padding:"10px",background:"#dc2626",color:"#fff",border:"none",borderRadius:8,fontSize:13,fontWeight:600,cursor:"pointer"}}>Sil</button>
            </div>
          </div>
        </div>
      )}

      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:24}}>
        <div>
          <h1 style={{fontSize:21,fontWeight:700,margin:0,letterSpacing:"-0.03em"}}>Sevkiyat</h1>
          <p style={{fontSize:13,color:"#78716c",margin:"4px 0 0"}}>Koli bazlı sevkiyat ve packing list yönetimi</p>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={()=>setView("label-designer")} style={{padding:"9px 16px",background:"#f5f5f4",border:"1px solid #e7e5e4",borderRadius:8,fontSize:13,cursor:"pointer",fontWeight:500}}>🎨 Etiket Tasarımcısı</button>
          <button onClick={newSevkiyat} style={{padding:"9px 16px",background:"#18181b",color:"#fff",border:"none",borderRadius:8,fontSize:13,fontWeight:600,cursor:"pointer"}}>+ Yeni Sevkiyat</button>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:20}}>
        {[["📦","Toplam",sevkiyatlar.length],["⏳","Hazırlanıyor",sevkiyatlar.filter(s=>s.durum==="hazırlanıyor").length],["✅","Tamamlandı",sevkiyatlar.filter(s=>s.durum==="tamamlandı").length],["🗂️","Toplam Koli",sevkiyatlar.reduce((s,sv)=>s+(sv.toplam_koli||0),0)]].map(([icon,lbl,val])=>(
          <div key={lbl} style={{background:"#fff",borderRadius:12,padding:"16px 20px",border:"1px solid #e7e5e4"}}>
            <div style={{fontSize:20}}>{icon}</div>
            <div style={{fontSize:22,fontWeight:700,margin:"4px 0 2px"}}>{val}</div>
            <div style={{fontSize:12,color:"#78716c"}}>{lbl}</div>
          </div>
        ))}
      </div>
      <div style={{background:"#fff",borderRadius:12,border:"1px solid #e7e5e4",overflow:"hidden"}}>
        {loading?<div style={{textAlign:"center",padding:40,color:"#a8a29e"}}>Yükleniyor...</div>:sevkiyatlar.length===0?(
          <div style={{textAlign:"center",padding:48}}>
            <div style={{fontSize:40,marginBottom:12}}>📦</div>
            <div style={{fontSize:15,fontWeight:600,color:"#44403c",marginBottom:4}}>Henüz sevkiyat yok</div>
            <div style={{fontSize:13,color:"#a8a29e",marginBottom:16}}>Yeni Sevkiyat butonuna basarak başlayın</div>
            <button onClick={newSevkiyat} style={{padding:"9px 20px",background:"#18181b",color:"#fff",border:"none",borderRadius:8,fontSize:13,cursor:"pointer"}}>+ Yeni Sevkiyat</button>
          </div>
        ):(
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr style={{borderBottom:"1px solid #f5f5f4"}}>{["Sevkiyat No","Müşteri","Tarih","Koli","Ürün","Durum","İşlemler"].map(h=><th key={h} style={{padding:"10px 16px",textAlign:"left",fontSize:11,color:"#a8a29e",fontWeight:600,textTransform:"uppercase",whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
            <tbody>{sevkiyatlar.map(s=>(
              <tr key={s.id} style={{borderBottom:"1px solid #f5f5f4"}} onMouseEnter={e=>e.currentTarget.style.background="#fafaf9"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <td style={{padding:"12px 16px",fontSize:13,fontWeight:600,fontFamily:"monospace"}}>{s.no}</td>
                <td style={{padding:"12px 16px",fontSize:13}}><div>{s.musteri}</div>{s.adres&&<div style={{fontSize:11,color:"#a8a29e"}}>{s.adres.substring(0,30)}{s.adres.length>30?"...":""}</div>}</td>
                <td style={{padding:"12px 16px",fontSize:12,color:"#78716c"}}>{fmt(s.tarih)}</td>
                <td style={{padding:"12px 16px",fontSize:13,textAlign:"center",fontWeight:600}}>{s.toplam_koli||0}</td>
                <td style={{padding:"12px 16px",fontSize:13,textAlign:"center"}}>{s.toplam_urun||0}</td>
                <td style={{padding:"12px 16px"}}>
                  <span style={{padding:"3px 10px",borderRadius:99,fontSize:11,fontWeight:600,background:(durumRenk[s.durum]||"#78716c")+"22",color:durumRenk[s.durum]||"#78716c"}}>{s.durum}</span>
                </td>
                <td style={{padding:"12px 16px"}}>
                  <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                    <button onClick={()=>printPackingList(s)} title="Packing List" style={{padding:"5px 9px",background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:6,fontSize:12,cursor:"pointer",color:"#0369a1"}}>📋</button>
                    <button onClick={()=>printLabels(s)} title="Etiket Yazdır" style={{padding:"5px 9px",background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:6,fontSize:12,cursor:"pointer",color:"#16a34a"}}>🏷️</button>
                    <button onClick={()=>editSevkiyat(s)} title="Düzenle" style={{padding:"5px 9px",background:"#fefce8",border:"1px solid #fde68a",borderRadius:6,fontSize:12,cursor:"pointer",color:"#ca8a04"}}>✏️</button>
                    <button onClick={()=>setDeleteConfirm(s)} title="Sil" style={{padding:"5px 9px",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:6,fontSize:12,cursor:"pointer",color:"#dc2626"}}>🗑️</button>
                  </div>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function SettingsPage({ user, setUser, appUsers, setAppUsers, notify, categories, setCategories, brands, setBrands, locations, setLocations }) {
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
        {[["password", "Şifre Değiştir"], ...(isAdmin ? [["users", "Kullanıcı Yönetimi"], ["lists", "Kategori & Marka"], ["locations", "Stok Lokasyonları"]] : [])].map(([id, label]) => (
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
          <ListManager title="Kategoriler" items={categories} onSave={async (items) => {
              setCategories(items);
              localStorage.setItem("stokpro_cats", JSON.stringify(items));
              await supabase.from("app_settings").upsert({ key: "categories", value: items }, { onConflict: "key" });
              notify("Kategoriler kaydedildi");
            }} color="#3b82f6" />
          <ListManager title="Markalar" items={brands} onSave={async (items) => {
              setBrands(items);
              localStorage.setItem("stokpro_brands", JSON.stringify(items));
              await supabase.from("app_settings").upsert({ key: "brands", value: items }, { onConflict: "key" });
              notify("Markalar kaydedildi");
            }} color="#44403c" />
        </div>
      )}

      {tab === "locations" && isAdmin && (
        <div style={{ maxWidth: 520 }}>
          <div style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: "#18181b", margin: "0 0 4px" }}>Stok Lokasyonları</h3>
            <p style={{ fontSize: 13, color: "#a8a29e", margin: 0 }}>Depo, mağaza veya raf gibi stok lokasyonlarını yönetin. Bu lokasyonlar sayım ve hareket ekranlarında kullanılır.</p>
          </div>
          <LocationManager locations={locations} onSave={async (items) => {
            setLocations(items);
            localStorage.setItem("stokpro_locations", JSON.stringify(items));
            await supabase.from("app_settings").upsert({ key: "locations", value: items }, { onConflict: "key" });
            notify("Lokasyonlar kaydedildi");
          }} />
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
