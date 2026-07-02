import React, { useState, useEffect, useRef, useCallback, MouseEvent } from "react";
import {
  Volume2, Sparkles, Download, Play, Pause,
  RefreshCw, Clock, Trash2, Disc, Info,
  Check, Headphones, X, MapPin, AlertCircle,
} from "lucide-react";

// ─── Splash Screen ────────────────────────────────────────────────────────────
function SplashScreen({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState<"enter" | "show" | "exit">("enter");

  useEffect(() => {
    // Enter: 1s, Show: 4.8s, Exit (slow alpha): 1.2s = 7s total
    const t1 = setTimeout(() => setPhase("show"), 1000);
    const t2 = setTimeout(() => setPhase("exit"), 5800);
    const t3 = setTimeout(() => onDone(), 7000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onDone]);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      display: "flex", alignItems: "center", justifyContent: "center",
      overflow: "hidden",
      transition: "opacity 1.5s ease",
      opacity: phase === "exit" ? 0 : 1,
    }}>
      {/* Blurred background */}
      <div style={{
        position: "absolute", inset: 0,
        backgroundImage: "url(/splash_logo.png)",
        backgroundSize: "cover",
        backgroundPosition: "center",
        filter: "blur(28px) brightness(0.35)",
        transform: "scale(1.1)",
      }} />

      {/* Dark overlay */}
      <div style={{
        position: "absolute", inset: 0,
        background: "rgba(4,10,20,0.55)",
      }} />

      {/* Logo image — centered, full natural size */}
      <div style={{
        position: "relative", zIndex: 2,
        display: "flex", flexDirection: "column", alignItems: "center", gap: 24,
        transition: "transform 1s cubic-bezier(.22,1,.36,1), opacity 1s ease",
        transform: phase === "enter" ? "scale(0.88) translateY(24px)" : phase === "exit" ? "scale(1.04) translateY(-16px)" : "scale(1) translateY(0)",
        opacity: phase === "enter" ? 0 : phase === "exit" ? 0 : 1,
      }}>
        <img
          src="/splash_logo.png"
          alt="Sado AI"
          style={{
            maxWidth: "min(88vw, 480px)",
            maxHeight: "min(70vh, 480px)",
            objectFit: "contain",
            borderRadius: 24,
            boxShadow: "0 32px 100px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.06)",
          }}
        />
        {/* Loading dots */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: 7, height: 7, borderRadius: "50%",
              background: "rgba(0,203,194,0.85)",
              animation: `pulseDot ${0.8}s ease-in-out ${i * 0.22}s infinite alternate`,
            }} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface HistoryItem {
  id: string; text: string; synthesizedText?: string | null;
  dialect?: string; voiceName: string; style: string; speed: number;
  timestamp: string; audioBase64: string; duration: number;
}
interface Toast { id: string; message: string; type: "error" | "success" | "info"; }

// ─── IndexedDB Audio Store ────────────────────────────────────────────────────
const IDB_NAME = "ozbek_ovoz_db";
const IDB_STORE = "audio_store";
const IDB_MAX_BYTES = 20 * 1024 * 1024; // 20MB limit

function openAudioDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveAudioToDB(id: string, audioBase64: string): Promise<void> {
  try {
    const db = await openAudioDB();
    // Hajmni tekshirish — agar limit oshsa eng eski yozuvni o'chirish
    const tx1 = db.transaction(IDB_STORE, "readonly");
    const store1 = tx1.objectStore(IDB_STORE);
    const allReq = store1.getAll();
    await new Promise<void>((res, rej) => { allReq.onsuccess = () => res(); allReq.onerror = () => rej(); });
    const all = allReq.result as { id: string; audioBase64: string }[];
    let totalSize = all.reduce((s, r) => s + (r.audioBase64?.length || 0), 0);
    totalSize += audioBase64.length;
    // Eng eskilarini o'chirish
    if (totalSize > IDB_MAX_BYTES && all.length > 0) {
      const tx2 = db.transaction(IDB_STORE, "readwrite");
      const store2 = tx2.objectStore(IDB_STORE);
      // Eng eski = array boshidagi (yangilari oxirida)
      let i = 0;
      while (totalSize > IDB_MAX_BYTES && i < all.length) {
        totalSize -= (all[i].audioBase64?.length || 0);
        store2.delete(all[i].id);
        i++;
      }
      await new Promise<void>((res) => { tx2.oncomplete = () => res(); });
    }
    // Yangi audio saqlash
    const tx3 = db.transaction(IDB_STORE, "readwrite");
    tx3.objectStore(IDB_STORE).put({ id, audioBase64 });
    await new Promise<void>((res) => { tx3.oncomplete = () => res(); });
  } catch { /* IndexedDB xatolik — e'tiborsiz */ }
}

async function getAudioFromDB(id: string): Promise<string | null> {
  try {
    const db = await openAudioDB();
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(id);
    return new Promise((res) => {
      req.onsuccess = () => res(req.result?.audioBase64 || null);
      req.onerror = () => res(null);
    });
  } catch { return null; }
}

async function deleteAudioFromDB(id: string | "ALL"): Promise<void> {
  try {
    const db = await openAudioDB();
    const tx = db.transaction(IDB_STORE, "readwrite");
    if (id === "ALL") tx.objectStore(IDB_STORE).clear();
    else tx.objectStore(IDB_STORE).delete(id);
    await new Promise<void>((res) => { tx.oncomplete = () => res(); });
  } catch { /* e'tiborsiz */ }
}

// ─── Design Tokens ────────────────────────────────────────────────────────────
const C = {
  BG: "#0e1520",
  BG2: "#121c2a",
  SURFACE: "#16202e",
  CARD: "#1c2840",
  CARD2: "#20304a",
  BORDER: "#2e4060",
  ACCENT: "#00cbc2",
  ADIM: "rgba(0,203,194,0.12)",
  AMED: "rgba(0,203,194,0.22)",
  TEXT1: "#f0f6ff",
  TEXT2: "#c0d0e8",
  TEXT3: "#7a90b0",
  RED: "#ff5c5c",
  REDDIM: "rgba(255,92,92,0.12)",
  GREEN: "#22c55e",
};

// ─── Data ─────────────────────────────────────────────────────────────────────
const DIALECTS = [
  { id: "standard", name: "Standart", full: "Standart — Adabiy O'zbek Tili", desc: "Adabiy o'zbek tili — to'g'ri va aniq talaffuz" },
  { id: "toshkent", name: "Toshkent", full: "Toshkent", desc: "Shahar ohangdorligi, votti-botti, samimiy poytaxt shevasi" },
  { id: "andijon", name: "Andijon", full: "Andijon", desc: "Vodiyning eng muloyim, xushmuomala va shirinsuxan shevasi" },
  { id: "fargona", name: "Farg'ona", full: "Farg'ona", desc: "Yumshoq, samimiy va qadimiy adabiy vodiy shevasi" },
  { id: "namangan", name: "Namangan", full: "Namangan", desc: "Ohangdor urg'ular va o'ziga xos vodiy xalqona nutqi" },
  { id: "samarqand", name: "Samarqand", full: "Samarqand", desc: "Boraftasiz, kelgansiz — go'zal tojikcha ohangdorlik" },
  { id: "buxoro", name: "Buxoro", full: "Buxoro", desc: "Qadimiy muloyim ohang va forsiy unli tovushlar ohangi" },
  { id: "xorazm", name: "Xorazm", full: "Xorazm", desc: "O'g'uz: galing, giding — mutlaqo o'zgacha ohangdorlik" },
  { id: "qashqadaryo", name: "Qashqadaryo", full: "Qashqadaryo", desc: "Qipchoq: baratirmiz, atibdi — qat'iy va janubiy ohang" },
  { id: "surxondaryo", name: "Surxondaryo", full: "Surxondaryo", desc: "Janubiy qat'iy talaffuz, mardona va ohangdor nutq" },
  { id: "jizzax", name: "Jizzax", full: "Jizzax", desc: "Dinamik markaziy cho'l shevasi va o'ziga xos urg'ular" },
  { id: "sirdaryo", name: "Sirdaryo", full: "Sirdaryo", desc: "Toshkent-Jizzax chorrahasidagi samimiy xalqona sheva" },
  { id: "navoiy", name: "Navoiy", full: "Navoiy", desc: "Markaziy-g'arbiy, cho'l ohangdorligi va Buxoro unsurlari" },
];

const VOICES = [
  { name: "Shaxnoza", gender: "Ayol", desc: "Mayin va ifodali ovoz", sticker: "🧕🏻", color: "#f472b6", glow: "rgba(244,114,182,0.35)", recommended: true },
  { name: "Nigora", gender: "Ayol", desc: "Aniq va ravon ma'ruzachi", sticker: "🧕🏻", color: "#a78bfa", glow: "rgba(167,139,250,0.35)", recommended: false },
  { name: "Umar", gender: "Erkak", desc: "Samimiy va yoqimli ovoz", sticker: "🤵", color: "#38bdf8", glow: "rgba(56,189,248,0.35)", recommended: false },
  { name: "Mustafo", gender: "Erkak", desc: "Shiddatli va vazmin ovoz", sticker: " 👨‍💼 ", color: "#fb923c", glow: "rgba(251,146,60,0.35)", recommended: false },
  { name: "Ali", gender: "Erkak", desc: "Muloyim va iliq nutq ohangi", sticker: "👨‍💼", color: "#34d399", glow: "rgba(52,211,153,0.35)", recommended: false },
];

const EMOTIONS = [
  { id: "natural", label: "Tabiiy", icon: "🍃" },
  { id: "cheerful", label: "Xushchaqchaq", icon: "😊" },
  { id: "calm", label: "Sokin", icon: "🌙" },
  { id: "serious", label: "Rasmiy", icon: "📋" },
  { id: "dramatic", label: "Dramatik", icon: "🎬" },
];

// ─── Audio Utils ──────────────────────────────────────────────────────────────
function b64ToU8(b: string): Uint8Array {
  const s = window.atob(b); const a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a;
}
function pcmToWav(pcm: Uint8Array, sr = 24000): Blob {
  const buf = new ArrayBuffer(44 + pcm.length), v = new DataView(buf);
  v.setUint32(0, 0x52494646, false); v.setUint32(4, 36 + pcm.length, true);
  v.setUint32(8, 0x57415645, false); v.setUint32(12, 0x666d7420, false);
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  v.setUint32(36, 0x64617461, false); v.setUint32(40, pcm.length, true);
  new Uint8Array(buf, 44).set(pcm);
  return new Blob([buf], { type: "audio/wav" });
}
function genWaveform(s: Int16Array, n = 40): number[] {
  const step = Math.floor(s.length / n);
  if (step <= 0) return Array(n).fill(0.3);
  return Array.from({ length: n }, (_, i) => {
    let sum = 0; for (let j = i * step; j < Math.min((i + 1) * step, s.length); j++) sum += Math.abs(s[j]);
    return Math.max(Math.min(sum / (step * 16000), 1), 0.12);
  });
}
function encMp3(s: Int16Array, sr = 24000): Blob {
  // @ts-ignore
  if (!window.lamejs) throw new Error("LameJS topilmadi");
  // @ts-ignore
  const e = new window.lamejs.Mp3Encoder(1, sr, 128); const out: Int8Array[] = [];
  for (let i = 0; i < s.length; i += 1152) { const b = e.encodeBuffer(s.subarray(i, i + 1152)); if (b.length) out.push(new Int8Array(b)); }
  const f = e.flush(); if (f.length) out.push(new Int8Array(f));
  return new Blob(out, { type: "audio/mp3" });
}

// ─── Responsive Hook ──────────────────────────────────────────────────────────
function useWindowWidth() {
  const [width, setWidth] = useState(typeof window !== "undefined" ? window.innerWidth : 1200);
  useEffect(() => {
    const h = () => setWidth(window.innerWidth);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return width;
}


function ParticlesBg() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    let animId: number;
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize(); window.addEventListener("resize", resize);
    const pts = Array.from({ length: 55 }, () => ({
      x: Math.random() * canvas.width, y: Math.random() * canvas.height,
      r: Math.random() * 2.2 + 0.4,
      vx: (Math.random() - 0.5) * 0.28, vy: (Math.random() - 0.5) * 0.28,
      op: Math.random() * 0.22 + 0.04, dir: Math.random() > 0.5 ? 0.0015 : -0.0015,
    }));
    const draw = () => {
      animId = requestAnimationFrame(draw);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of pts) {
        p.x += p.vx; p.y += p.vy; p.op += p.dir;
        if (p.op > 0.3 || p.op < 0.02) p.dir *= -1;
        if (p.x < 0) p.x = canvas.width; if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height; if (p.y > canvas.height) p.y = 0;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0,203,194,${p.op})`; ctx.fill();
      }
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 100) {
            ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y);
            ctx.strokeStyle = `rgba(0,203,194,${0.06 * (1 - dist / 100)})`; ctx.lineWidth = 0.6; ctx.stroke();
          }
        }
      }
    };
    draw();
    return () => { cancelAnimationFrame(animId); window.removeEventListener("resize", resize); };
  }, []);
  return <canvas ref={ref} style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none" }} />;
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function ToastContainer({ toasts, onRemove }: { toasts: Toast[]; onRemove: (id: string) => void }) {
  const W = useWindowWidth();
  const mob = W < 768;
  return (
    <div style={{
      position: "fixed", top: mob ? 10 : 76,
      right: mob ? 10 : 20, left: mob ? 10 : "auto",
      zIndex: 200, display: "flex", flexDirection: "column", gap: 10
    }}>
      {toasts.map(t => <ToastItem key={t.id} toast={t} onRemove={onRemove} />)}
    </div>
  );
}
function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
  useEffect(() => { const t = setTimeout(() => onRemove(toast.id), 5000); return () => clearTimeout(t); }, [toast.id, onRemove]);
  const col = toast.type === "error" ? C.RED : toast.type === "success" ? C.GREEN : C.ACCENT;
  return (
    <div style={{
      position: "relative", overflow: "hidden",
      padding: "12px 40px 12px 14px", borderRadius: 12, minWidth: 0, maxWidth: 420,
      background: C.CARD2, border: `1px solid ${col}`,
      boxShadow: `0 8px 32px rgba(0,0,0,0.5)`,
      animation: "slideInRight 0.3s cubic-bezier(0.34,1.56,0.64,1) both",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <AlertCircle size={15} color={col} style={{ flexShrink: 0, marginTop: 2 }} />
        <p style={{ fontSize: 13, fontWeight: 600, color: C.TEXT1, lineHeight: 1.5, flex: 1 }}>{toast.message}</p>
      </div>
      <button onClick={() => onRemove(toast.id)}
        style={{
          position: "absolute", top: 10, right: 10, width: 24, height: 24, borderRadius: 6,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "transparent", border: "none", cursor: "pointer", color: C.TEXT3, transition: "color 0.15s"
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = C.TEXT1; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = C.TEXT3; }}
      ><X size={13} /></button>
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 2, background: "rgba(255,255,255,0.05)" }}>
        <div style={{ height: "100%", background: col, animation: "toastProgress 5s linear forwards", opacity: 0.8 }} />
      </div>
    </div>
  );
}

// ─── Synthesis Modal ──────────────────────────────────────────────────────────
function SynthesisModal({ voice, dialect, style }: { voice: string; dialect: string; style: string }) {
  const steps = [
    { label: "Matn tahlil qilinmoqda", done: false },
    { label: "Sheva qo'llanilmoqda", done: false },
    { label: "Ovoz sintezi amalga oshirilmoqda", done: false },
  ];
  const [step, setStep] = React.useState(0);
  useEffect(() => {
    const t1 = setTimeout(() => setStep(1), 900);
    const t2 = setTimeout(() => setStep(2), 2100);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);
  const mob = typeof window !== "undefined" && window.innerWidth < 768;

  // Wave bar heights va opacity — faqat bir marta hisoblash (re-render loop oldini olish)
  const waveBars = React.useMemo(() =>
    Array.from({ length: 16 }).map((_, i) => ({
      opacity: 0.3 + Math.random() * 0.5,
      height: 12 + Math.random() * 16,
      dur: 0.6 + i * 0.07,
    })), []);

  return (
    <div className="modal-overlay" style={{
      position: "fixed", inset: 0, zIndex: 100,
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: mob ? 16 : 24,
      background: "rgba(6,12,22,0.88)", backdropFilter: "blur(24px)",
    }}>
      <div className="scaleIn modal-card" style={{
        width: "100%",
        maxWidth: mob ? 360 : 420,
        background: C.CARD, border: `1px solid ${C.BORDER}`,
        borderRadius: 20,
        overflow: "hidden",
        boxShadow: `0 32px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(0,203,194,0.08)`,
      }}>
        {/* Top accent bar */}
        <div style={{ height: 3, background: `linear-gradient(90deg,transparent 0%,${C.ACCENT} 40%,#00e8df 60%,transparent 100%)` }} />

        <div style={{ padding: mob ? "24px 18px 20px" : "32px 28px 28px" }}>
          {/* Animated icon */}
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}>
            <div style={{
              width: 72, height: 72, borderRadius: 20, position: "relative",
              background: `linear-gradient(135deg,rgba(0,203,194,0.12),rgba(0,203,194,0.06))`,
              border: `1.5px solid rgba(0,203,194,0.3)`,
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: `0 0 40px rgba(0,203,194,0.2)`,
            }}>
              <Volume2 size={30} color={C.ACCENT} style={{ animation: "pulseDot 1.5s ease-in-out infinite" }} />
              {/* Orbit ring */}
              <div style={{
                position: "absolute", inset: -10, borderRadius: "50%",
                border: `2px dashed rgba(0,203,194,0.2)`,
                animation: "spinAnim 4s linear infinite",
              }} />
            </div>
          </div>

          <h2 style={{
            fontSize: 18, fontWeight: 800, color: C.TEXT1, textAlign: "center",
            letterSpacing: "-0.03em", marginBottom: 6
          }}>Ovoz Sintez Qilinmoqda</h2>
          <p style={{ fontSize: 12, color: C.TEXT3, textAlign: "center", marginBottom: 24, lineHeight: 1.55 }}>
            {voice} ovozi · {dialect === "standard" ? "Adabiy O'zbek" : dialect} shevasi
          </p>

          {/* Progress steps */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
            {steps.map((s, i) => {
              const done = i < step;
              const active = i === step;
              return (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "11px 14px", borderRadius: 10,
                  background: done ? "rgba(34,197,94,0.06)" : active ? C.ADIM : C.SURFACE,
                  border: `1px solid ${done ? "rgba(34,197,94,0.2)" : active ? "rgba(0,203,194,0.25)" : C.BORDER}`,
                  transition: "all 0.3s",
                }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: 8, flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: done ? "rgba(34,197,94,0.15)" : active ? C.ADIM : C.CARD2,
                    border: `1px solid ${done ? "rgba(34,197,94,0.3)" : active ? "rgba(0,203,194,0.3)" : C.BORDER}`,
                  }}>
                    {done
                      ? <Check size={12} color={C.GREEN} strokeWidth={3} />
                      : active
                        ? <RefreshCw size={11} color={C.ACCENT} style={{ animation: "spinAnim 1s linear infinite" }} />
                        : <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.BORDER, display: "block" }} />}
                  </div>
                  <span style={{
                    fontSize: 12, fontWeight: active ? 700 : 500,
                    color: done ? C.GREEN : active ? C.ACCENT : C.TEXT3,
                    transition: "color 0.3s",
                  }}>{s.label}</span>
                </div>
              );
            })}
          </div>

          {/* Animated wave bars — memoized values */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 3, height: 28 }}>
            {waveBars.map((bar, i) => (
              <div key={i} style={{
                width: 4, borderRadius: 4,
                background: `rgba(0,203,194,${bar.opacity})`,
                animation: `pulseDot ${bar.dur}s ease-in-out infinite alternate`,
                height: `${bar.height}px`,
              }} />
            ))}
          </div>

          <p style={{ fontSize: 10, color: C.TEXT3, textAlign: "center", marginTop: 16, fontWeight: 500 }}>
            Iltimos, kuting — bu jarayon bir necha soniya yoki daqiqa olishi mumkin
          </p>
        </div>

        {/* Bottom bar */}
        <div style={{ height: 2, background: `linear-gradient(90deg,transparent,rgba(0,203,194,0.3),transparent)` }} />
      </div>
    </div>
  );
}

// ─── HistoryPlayerDialog ──────────────────────────────────────────────────────
function HistoryPlayerDialog({
  item, onClose, onLoadToMain, onDownload,
}: {
  item: HistoryItem;
  onClose: () => void;
  onLoadToMain: (item: HistoryItem) => void;
  onDownload: (item: HistoryItem, e: React.MouseEvent) => void;
}) {
  const W = useWindowWidth();
  const isMobile = W < 640;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const animRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [waveformBars, setWaveformBars] = useState<number[]>([]);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const voice = VOICES.find(v => v.name === item.voiceName);
  const dial = DIALECTS.find(d => d.id === (item.dialect || "standard"));
  const emo = EMOTIONS.find(e => e.id === item.style);
  const fmt = (s: number) => isNaN(s) ? "0:00" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  // Setup audio on mount
  useEffect(() => {
    try {
      const pcm = b64ToU8(item.audioBase64);
      const wav = pcmToWav(pcm, 24000);
      const url = URL.createObjectURL(wav);
      const s16 = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2);
      setWaveformBars(genWaveform(s16, 40));
      setAudioUrl(url);
      return () => { URL.revokeObjectURL(url); };
    } catch { }
  }, [item.id]);

  // Audio element listeners
  useEffect(() => {
    const a = audioRef.current; if (!a || !audioUrl) return;
    a.src = audioUrl;
    const onPlay = () => { setIsPlaying(true); setupAnalyser(); };
    const onPause = () => setIsPlaying(false);
    const onTime = () => setCurrentTime(a.currentTime);
    const onMeta = () => setDuration(a.duration);
    const onEnd = () => { setIsPlaying(false); setCurrentTime(0); };
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("ended", onEnd);
    return () => {
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("ended", onEnd);
    };
  }, [audioUrl]);

  // Cleanup on unmount
  useEffect(() => () => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    audioCtxRef.current?.close().catch(() => { });
  }, []);

  // ESC key
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const setupAnalyser = () => {
    const a = audioRef.current; if (!a) return;
    try {
      if (!audioCtxRef.current) {
        const AC = window.AudioContext || (window as any).webkitAudioContext;
        audioCtxRef.current = new AC();
        analyserRef.current = audioCtxRef.current.createAnalyser();
        analyserRef.current.fftSize = 64;
        sourceRef.current = audioCtxRef.current.createMediaElementSource(a);
        sourceRef.current.connect(analyserRef.current);
        analyserRef.current.connect(audioCtxRef.current.destination);
      }
      if (audioCtxRef.current.state === "suspended") audioCtxRef.current.resume();
      drawSpectrum();
    } catch { }
  };

  const drawSpectrum = () => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    const canvas = canvasRef.current; const analyser = analyserRef.current;
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const len = analyser.frequencyBinCount; const data = new Uint8Array(len);
    const draw = () => {
      animRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(data);
      ctx.fillStyle = C.SURFACE; ctx.fillRect(0, 0, canvas.width, canvas.height);
      const bw = (canvas.width / len) - 3; let x = 1.5;
      for (let i = 0; i < len; i++) {
        const h = Math.max((data[i] / 255) * canvas.height * 0.92, 3);
        const g = ctx.createLinearGradient(0, canvas.height, 0, canvas.height - h);
        g.addColorStop(0, "rgba(0,203,194,0.3)"); g.addColorStop(0.5, C.ACCENT); g.addColorStop(1, "rgba(160,255,250,1)");
        ctx.fillStyle = g;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, canvas.height - h, bw, h, 2); else ctx.rect(x, canvas.height - h, bw, h);
        ctx.fill(); x += bw + 3;
      }
    }; draw();
  };

  const togglePlay = () => {
    if (!audioRef.current || !audioUrl) return;
    isPlaying ? audioRef.current.pause() : audioRef.current.play().catch(() => { });
  };

  const handleWaveClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || duration === 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    audioRef.current.currentTime = ((e.clientX - r.left) / r.width) * duration;
  };

  const progress = duration > 0 ? currentTime / duration : 0;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 150,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: isMobile ? "12px" : "20px",
        background: "rgba(4,10,20,0.88)", backdropFilter: "blur(28px)",
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {audioUrl && <audio ref={audioRef} src={audioUrl} />}

      <div
        className="scaleIn modal-card"
        style={{
          width: "100%", maxWidth: isMobile ? "100%" : 520,
          maxHeight: "95vh",
          overflowY: "auto",
          background: C.CARD,
          border: `1px solid ${C.BORDER}`,
          borderRadius: isMobile ? 18 : 24,
          boxShadow: `0 32px 96px rgba(0,0,0,0.75), 0 0 0 1px rgba(0,203,194,0.07)`,
          display: "flex", flexDirection: "column",
        }}
      >
        {/* Top accent bar */}
        <div style={{ height: 3, background: `linear-gradient(90deg,transparent 0%,${C.ACCENT} 40%,#00e8df 60%,transparent 100%)`, flexShrink: 0 }} />

        {/* ── Header ── */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: isMobile ? "14px 14px 12px" : "18px 22px 14px",
          borderBottom: `1px solid ${C.BORDER}`, flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: isMobile ? 36 : 44, height: isMobile ? 36 : 44, borderRadius: 12,
              background: `linear-gradient(135deg,rgba(0,203,194,0.12),rgba(0,203,194,0.06))`,
              border: `1.5px solid rgba(0,203,194,0.25)`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: isMobile ? 18 : 22, flexShrink: 0,
            }}>
              {voice?.sticker || "🎙️"}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span style={{ fontSize: isMobile ? 14 : 15, fontWeight: 800, color: C.TEXT1, letterSpacing: "-0.02em" }}>
                  {item.voiceName}
                </span>
                <span style={{
                  fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
                  background: voice ? `rgba(${voice.color.slice(1).match(/../g)?.map(h => parseInt(h, 16)).join(",")},0.15)` : C.ADIM,
                  color: voice?.color || C.ACCENT
                }}>
                  {voice?.gender}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 3, flexWrap: "wrap" }}>
                <span style={{ fontSize: 10, color: C.TEXT3 }}>{emo?.icon} {emo?.label}</span>
                <span style={{ color: C.BORDER }}>·</span>
                <span style={{ fontSize: 10, color: C.TEXT3 }}>{item.speed.toFixed(1)}×</span>
                {item.dialect && item.dialect !== "standard" && (
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: "1px 7px", borderRadius: 20,
                    background: C.ADIM, color: C.ACCENT
                  }}>{dial?.name || item.dialect}</span>
                )}
                <span style={{ color: C.BORDER }}>·</span>
                <span style={{ fontSize: 10, color: C.TEXT3 }}>{item.timestamp}</span>
              </div>
            </div>
          </div>

          {/* X close button */}
          <button
            onClick={onClose}
            style={{
              width: isMobile ? 34 : 38, height: isMobile ? 34 : 38, borderRadius: 10,
              background: C.SURFACE, border: `1px solid ${C.BORDER}`,
              color: C.TEXT3, cursor: "pointer", flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all 0.15s",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = C.REDDIM; (e.currentTarget as HTMLElement).style.color = C.RED; (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,92,92,0.3)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = C.SURFACE; (e.currentTarget as HTMLElement).style.color = C.TEXT3; (e.currentTarget as HTMLElement).style.borderColor = C.BORDER; }}
          >
            <X size={15} />
          </button>
        </div>

        {/* ── Content ── */}
        <div style={{ padding: isMobile ? "14px" : "20px", display: "flex", flexDirection: "column", gap: isMobile ? 12 : 16 }}>

          {/* Matn */}
          <div style={{
            padding: isMobile ? "10px 12px" : "13px 16px", borderRadius: 12,
            background: C.SURFACE, border: `1px solid ${C.BORDER}`,
          }}>
            <p style={{
              fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em",
              color: C.TEXT3, marginBottom: 6
            }}>Matn</p>
            <p style={{ fontSize: isMobile ? 13 : 14, color: C.TEXT1, lineHeight: 1.65, fontWeight: 500 }}>
              {item.text}
            </p>
          </div>

          {/* Sheva matni */}
          {item.synthesizedText && item.synthesizedText !== item.text && (
            <div style={{
              padding: isMobile ? "10px 12px" : "13px 16px", borderRadius: 12,
              background: `linear-gradient(135deg,rgba(0,203,194,0.05),rgba(0,203,194,0.02))`,
              border: `1px solid rgba(0,203,194,0.18)`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <MapPin size={10} color={C.ACCENT} />
                <p style={{
                  fontSize: 9, fontWeight: 800, textTransform: "uppercase",
                  letterSpacing: "0.1em", color: C.ACCENT
                }}>Sheva Matni</p>
              </div>
              <p style={{ fontSize: isMobile ? 12 : 13, color: C.TEXT2, lineHeight: 1.65, userSelect: "all" }}>
                {item.synthesizedText}
              </p>
            </div>
          )}

          {/* Waveform scrubber */}
          <div
            onClick={handleWaveClick}
            style={{
              display: "flex", alignItems: "flex-end", gap: 2, height: isMobile ? 44 : 52,
              padding: "6px 10px", borderRadius: 12, cursor: "pointer",
              background: C.SURFACE, border: `1px solid ${C.BORDER}`,
              position: "relative", overflow: "hidden",
            }}
          >
            {/* Progress overlay */}
            <div style={{
              position: "absolute", inset: 0, left: 0,
              width: `${progress * 100}%`,
              background: `linear-gradient(90deg,rgba(0,203,194,0.07),rgba(0,203,194,0.04))`,
              pointerEvents: "none", transition: "width 0.05s",
            }} />
            {waveformBars.map((bh, i) => {
              const played = (i / waveformBars.length) < progress;
              return (
                <div key={i} style={{
                  flex: 1, borderRadius: 3,
                  height: `${Math.floor(bh * (isMobile ? 30 : 38)) + 4}px`,
                  background: played ? C.ACCENT : C.BORDER,
                  boxShadow: played ? `0 0 6px rgba(0,203,194,0.45)` : "none",
                  transition: "background 0.05s",
                }} />
              );
            })}
          </div>

          {/* Time */}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: -8, padding: "0 2px" }}>
            <span style={{ fontSize: 10, fontFamily: "monospace", color: C.TEXT3 }}>{fmt(currentTime)}</span>
            <span style={{ fontSize: 10, fontFamily: "monospace", color: C.TEXT3 }}>{fmt(duration)}</span>
          </div>

          {/* Controls */}
          <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 10 : 14 }}>
            {/* Play/Pause */}
            <button
              onClick={togglePlay}
              style={{
                width: isMobile ? 52 : 60, height: isMobile ? 52 : 60,
                borderRadius: "50%", flexShrink: 0,
                cursor: "pointer", border: "none",
                background: `linear-gradient(135deg,#009d96,${C.ACCENT})`,
                boxShadow: `0 6px 24px rgba(0,203,194,0.45)`,
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 0.15s",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = "scale(1.07)"; (e.currentTarget as HTMLElement).style.boxShadow = `0 8px 30px rgba(0,203,194,0.55)`; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = "scale(1)"; (e.currentTarget as HTMLElement).style.boxShadow = `0 6px 24px rgba(0,203,194,0.45)`; }}
            >
              {isPlaying
                ? <Pause size={22} fill={C.BG} color={C.BG} />
                : <Play size={22} fill={C.BG} color={C.BG} style={{ marginLeft: 2 }} />}
            </button>

            {/* Track info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                <Disc size={12} color={C.ACCENT} style={{ animation: isPlaying ? "spinAnim 2s linear infinite" : "none" }} />
                <span style={{
                  fontSize: isMobile ? 11 : 12, fontWeight: 800, color: C.ACCENT,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
                }}>
                  {item.voiceName} · {(item.dialect === "standard" || !item.dialect) ? "Adabiy" : (dial?.name || item.dialect)}
                </span>
              </div>
              <p style={{ fontSize: 10, color: C.TEXT3, fontFamily: "monospace" }}>WAV · SADO AI</p>
            </div>

            {/* Download */}
            <button
              onClick={e => onDownload(item, e)}
              title="MP3 yuklab olish"
              style={{
                width: isMobile ? 40 : 46, height: isMobile ? 40 : 46,
                borderRadius: 12, cursor: "pointer", flexShrink: 0,
                background: C.SURFACE, border: `1px solid ${C.BORDER}`,
                color: C.TEXT2, display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 0.15s",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = C.ADIM; (e.currentTarget as HTMLElement).style.color = C.ACCENT; (e.currentTarget as HTMLElement).style.borderColor = "rgba(0,203,194,0.3)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = C.SURFACE; (e.currentTarget as HTMLElement).style.color = C.TEXT2; (e.currentTarget as HTMLElement).style.borderColor = C.BORDER; }}
            >
              <Download size={16} />
            </button>
          </div>

          {/* Load to main player button */}
          <button
            onClick={() => onLoadToMain(item)}
            style={{
              width: "100%", padding: isMobile ? "13px" : "14px",
              borderRadius: 12, cursor: "pointer",
              background: `linear-gradient(135deg,rgba(0,148,143,0.15),rgba(0,203,194,0.1))`,
              border: `1px solid rgba(0,203,194,0.25)`,
              color: C.ACCENT, fontSize: isMobile ? 13 : 14, fontWeight: 700,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              transition: "all 0.15s", letterSpacing: "-0.01em",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = `linear-gradient(135deg,rgba(0,148,143,0.28),rgba(0,203,194,0.18))`; (e.currentTarget as HTMLElement).style.borderColor = "rgba(0,203,194,0.5)"; (e.currentTarget as HTMLElement).style.boxShadow = `0 4px 18px rgba(0,203,194,0.18)`; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = `linear-gradient(135deg,rgba(0,148,143,0.15),rgba(0,203,194,0.1))`; (e.currentTarget as HTMLElement).style.borderColor = "rgba(0,203,194,0.25)"; (e.currentTarget as HTMLElement).style.boxShadow = "none"; }}
          >
            <Headphones size={16} />
            Asosiy playerga yuklash
          </button>
        </div>

        {/* Bottom bar */}
        <div style={{ height: 2, background: `linear-gradient(90deg,transparent,rgba(0,203,194,0.25),transparent)`, flexShrink: 0, marginTop: "auto" }} />
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [showSplash, setShowSplash] = useState(true);
  const onSplashDone = useCallback(() => setShowSplash(false), []);
  const [text, setText] = useState("");
  const [voiceName, setVoiceName] = useState("Shaxnoza");
  const [style, setStyle] = useState("natural");
  const [speed, setSpeed] = useState(1.0);
  const [dialect, setDialect] = useState("standard");
  const [synthesizedText, setSynthesizedText] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [showSynthModal, setShowSynthModal] = useState(false);
  // Sintez paytidagi holat — keyinchalik o'zgartirishlar player ni o'zgartirmasin
  const [synthSnapshot, setSynthSnapshot] = useState<{
    voiceName: string; dialect: string; style: string; speed: number;
    synthesizedText: string | null;
  } | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [mp3Url, setMp3Url] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [waveformBars, setWaveformBars] = useState<number[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [historyPlayItem, setHistoryPlayItem] = useState<HistoryItem | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const animRef = useRef<number | null>(null);
  const aiToastShown = useRef(false);

  const addToast = useCallback((message: string, type: Toast["type"] = "error") => {
    const id = Date.now().toString() + Math.random();
    setToasts(p => [...p, { id, message, type }]);
  }, []);
  const removeToast = useCallback((id: string) => setToasts(p => p.filter(t => t.id !== id)), []);

  useEffect(() => {
    (async () => {
      try {
        const c = localStorage.getItem("ozbek_ovoz_history");
        if (c) {
          const items: HistoryItem[] = JSON.parse(c);
          // IndexedDB dan audio yuklash
          for (const item of items) {
            if (!item.audioBase64) {
              const audio = await getAudioFromDB(item.id);
              if (audio) item.audioBase64 = audio;
            }
          }
          setHistory(items);
        }
      } catch { }
    })();
  }, []);
  useEffect(() => { if (audioRef.current) audioRef.current.playbackRate = speed; }, [speed, audioUrl]);
  useEffect(() => {
    const a = audioRef.current; if (!a) return;
    const onPlay = () => { setIsPlaying(true); setupAnalyser(); };
    const onPause = () => setIsPlaying(false);
    const onTime = () => setCurrentTime(a.currentTime);
    const onMeta = () => { setDuration(a.duration); a.playbackRate = speed; };
    const onEnd = () => { setIsPlaying(false); setCurrentTime(0); };
    a.addEventListener("play", onPlay); a.addEventListener("pause", onPause);
    a.addEventListener("timeupdate", onTime); a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("ended", onEnd);
    return () => {
      a.removeEventListener("play", onPlay); a.removeEventListener("pause", onPause);
      a.removeEventListener("timeupdate", onTime); a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("ended", onEnd);
    };
  }, [audioUrl, speed]);
  useEffect(() => () => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    audioCtxRef.current?.close().catch(() => { });
  }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") setShowHistory(false); };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, []);

  const setupAnalyser = () => {
    const a = audioRef.current; if (!a) return;
    try {
      if (!audioCtxRef.current) {
        const AC = window.AudioContext || (window as any).webkitAudioContext;
        audioCtxRef.current = new AC();
        analyserRef.current = audioCtxRef.current.createAnalyser();
        analyserRef.current.fftSize = 64;
        sourceRef.current = audioCtxRef.current.createMediaElementSource(a);
        sourceRef.current.connect(analyserRef.current);
        analyserRef.current.connect(audioCtxRef.current.destination);
      }
      if (audioCtxRef.current.state === "suspended") audioCtxRef.current.resume();
      drawSpectrum();
    } catch { }
  };

  const drawSpectrum = () => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    const canvas = canvasRef.current; const analyser = analyserRef.current;
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const len = analyser.frequencyBinCount; const data = new Uint8Array(len);
    const draw = () => {
      animRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(data);
      ctx.fillStyle = C.SURFACE; ctx.fillRect(0, 0, canvas.width, canvas.height);
      const bw = (canvas.width / len) - 3; let x = 1.5;
      for (let i = 0; i < len; i++) {
        const h = Math.max((data[i] / 255) * canvas.height * 0.92, 3);
        const g = ctx.createLinearGradient(0, canvas.height, 0, canvas.height - h);
        g.addColorStop(0, "rgba(0,203,194,0.3)"); g.addColorStop(0.5, C.ACCENT); g.addColorStop(1, "rgba(160,255,250,1)");
        ctx.fillStyle = g; const y = canvas.height - h;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, bw, h, 2); else ctx.rect(x, y, bw, h);
        ctx.fill(); x += bw + 3;
      }
    }; draw();
  };

  const processAudio = (b64: string, play = true) => {
    try {
      const pcm = b64ToU8(b64); const wav = pcmToWav(pcm, 24000);
      const wUrl = URL.createObjectURL(wav);
      const s16 = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2);
      setWaveformBars(genWaveform(s16, 40));
      try { setMp3Url(URL.createObjectURL(encMp3(s16, 24000))); } catch { }
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioUrl(wUrl); setCurrentTime(0);
      if (play) setTimeout(() => audioRef.current?.play().catch(() => { }), 80);
    } catch (e: any) { addToast("Audio qayta ishlashda xatolik: " + e.message); }
  };

  const handleSynthesize = async () => {
    const cc = text.trim().length === 0 ? 0 : text.trim().replace(/\s+/g, " ").length;
    if (cc === 0) { addToast("Matn kiritish talab qilinadi."); return; }
    if (cc < 100) { addToast("100 ta belgidan ko'proq matn kiriting! Noqulaylik uchun uzr so'raymiz! Serverimizga yuklamani kamaytirish maqsadida shunday qilmoqdamiz!.", "error"); return; }
    if (cc > 500) { addToast("Matn 500 belgidan oshmasin."); return; }
    setIsGenerating(true);
    setShowSynthModal(true);
    setSynthesizedText(null);
    try {
      const r = await fetch("/api/tts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim(), voiceName, style, speed, dialect })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Server xatosi.");
      processAudio(d.audioBase64, true);
      const snapshotSynthText = (d.metadata?.synthesizedText && d.metadata.synthesizedText !== text.trim())
        ? d.metadata.synthesizedText : null;
      setSynthesizedText(snapshotSynthText);
      // Sintez paytidagi holatni "muzlatib" qo'yamiz
      setSynthSnapshot({
        voiceName,
        dialect,
        style,
        speed,
        synthesizedText: snapshotSynthText,
      });
      const item: HistoryItem = {
        id: Date.now().toString(), text: text.trim(),
        synthesizedText: d.metadata?.synthesizedText || null,
        dialect, voiceName, style, speed,
        timestamp: new Date().toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" }),
        audioBase64: d.audioBase64, duration: 0,
      };
      setHistory(prev => {
        // Hamma sintezlarni saqlaymiz — dublikat filtrsiz
        const u = [item, ...prev].slice(0, 20);
        try {
          // audioBase64 localStorage ga sig'maydi — faqat metadata saqlanadi
          const toSave = u.map(({ audioBase64, ...rest }) => rest);
          localStorage.setItem("ozbek_ovoz_history", JSON.stringify(toSave));
        } catch { /* localStorage limiti */ }
        // Audio IndexedDB ga saqlanadi
        saveAudioToDB(item.id, item.audioBase64);
        return u;
      });
      setShowSynthModal(false);
    } catch (e: any) {
      setShowSynthModal(false);
      addToast(e.message || "Tizimda nosozlik yuz berdi.Keynroq qayta urining!");
    }
    finally { setIsGenerating(false); }
  };

  const handleEnhance = async () => {
    const cc = text.trim().length === 0 ? 0 : text.trim().replace(/\s+/g, " ").length;
    if (cc === 0) { addToast("Tahrirlash uchun matn kiriting."); return; }
    if (cc < 100) { addToast("100 ta belgidan ko'proq matn kiriting! Noqulaylik uchun uzr so'raymiz! Serverimizga yuklamani kamaytirish maqsadida shunday qilmoqdamiz!.", "error"); return; }
    setIsEnhancing(true);
    try {
      const r = await fetch("/api/enhance-text", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim() })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Server xatosi.");
      if (d.enhancedText) setText(d.enhancedText);
    } catch (e: any) { addToast("Imlo tekshirishda xatolik: " + e.message); }
    finally { setIsEnhancing(false); }
  };

  const handleWaveClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || duration === 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    audioRef.current.currentTime = ((e.clientX - r.left) / r.width) * duration;
  };

  const togglePlay = () => {
    if (!audioRef.current || !audioUrl) return;
    isPlaying ? audioRef.current.pause() : audioRef.current.play().catch(() => { });
  };

  const loadHistoryItem = (item: HistoryItem) => {
    // Endi tarixdan bosqanda — dialog ichida ijro qilinadi
    setHistoryPlayItem(item);
    setShowHistory(false);
  };

  const loadHistoryToMain = (item: HistoryItem) => {
    setText(item.text); setVoiceName(item.voiceName); setStyle(item.style);
    setSpeed(item.speed); setDialect(item.dialect || "standard");
    setSynthesizedText(item.synthesizedText || null);
    setSynthSnapshot({
      voiceName: item.voiceName,
      dialect: item.dialect || "standard",
      style: item.style,
      speed: item.speed,
      synthesizedText: item.synthesizedText || null,
    });
    processAudio(item.audioBase64, true);
    setHistoryPlayItem(null);
  };

  const downloadMp3 = (item: HistoryItem, e: MouseEvent) => {
    e.stopPropagation();
    try {
      const pcm = b64ToU8(item.audioBase64);
      const s16 = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2);
      const url = URL.createObjectURL(encMp3(s16, 24000));
      const a = document.createElement("a"); a.href = url;
      a.download = `ovoz_${item.voiceName}_${item.style}.mp3`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch { addToast("MP3 yuklab olishda xatolik."); }
  };

  // confirmDelete: o'chirishdan avval tasdiqlash uchun
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; text: string } | null>(null);

  const deleteItem = (id: string, itemText: string, e: MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete({ id, text: itemText });
  };

  const doDeleteItem = (id: string) => {
    if (id === "ALL") {
      setHistory([]);
      localStorage.removeItem("ozbek_ovoz_history");
      deleteAudioFromDB("ALL");
    } else {
      setHistory(prev => {
        const u = prev.filter(i => i.id !== id);
        try {
          const toSave = u.map(({ audioBase64, ...rest }) => rest);
          localStorage.setItem("ozbek_ovoz_history", JSON.stringify(toSave));
        } catch { /* localStorage limiti */ }
        deleteAudioFromDB(id);
        return u;
      });
    }
    setConfirmDelete(null);
  };

  const fmt = (s: number) => isNaN(s) ? "0:00" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const activeVoice = VOICES.find(v => v.name === voiceName)!;
  const activeDial = DIALECTS.find(d => d.id === dialect)!;
  // Ko'p space = 1 belgi, faqat space = 0
  const countChars = (t: string) => t.trim().length === 0 ? 0 : t.trim().replace(/\s+/g, " ").length;
  const charCount = countChars(text);
  const textRatio = Math.min((charCount / 500) * 100, 100);

  // ─ Responsive breakpoints (JS-based — works with inline styles) ─
  const W = useWindowWidth();
  const isMobile = W < 768;
  const isTablet = W < 1024;
  const P = isMobile ? 14 : 20; // base padding

  return (
    <>
      {showSplash && (
        <SplashScreen onDone={onSplashDone} />
      )}
      <div style={{
        position: "relative", minHeight: "100vh", display: "flex", flexDirection: "column",
        background: `linear-gradient(160deg, ${C.BG} 0%, ${C.BG2} 100%)`,
        fontFamily: "'Montserrat','Inter',system-ui,sans-serif",
        transition: "opacity 0.6s ease",
        opacity: showSplash ? 0 : 1,
      }}>
        <style>{`
        ::-webkit-scrollbar-thumb{background:${C.BORDER};}
        ::-webkit-scrollbar-thumb:hover{background:${C.ACCENT};}

        input[type=range]::-webkit-slider-runnable-track{background:${C.CARD2};}
        input[type=range]::-webkit-slider-thumb{background:${C.ACCENT};border-color:${C.BG};}
        input[type=range]::-moz-range-thumb{background:${C.ACCENT};border-color:${C.BG};}

        @keyframes shimmerCTA{0%{transform:translateX(-100%);}60%,100%{transform:translateX(200%);}}

        .btn-teal{background:linear-gradient(135deg,#009d96,${C.ACCENT} 60%,#00e0d8);}
        .btn-teal:disabled{background:${C.CARD2}!important;color:${C.TEXT3}!important;}
        .ai-float-btn:hover{box-shadow:0 4px 16px rgba(0,203,194,0.45)!important;}
      `}</style>



        <ParticlesBg />
        <ToastContainer toasts={toasts} onRemove={removeToast} />
        {showSynthModal && <SynthesisModal voice={voiceName} dialect={dialect} style={style} />}
        {audioUrl && <audio ref={audioRef} src={audioUrl} />}



        {/* ══ HEADER ══ */}
        <header style={{
          position: "sticky", top: 0, zIndex: 30,
          height: isMobile ? 56 : 64,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: isMobile ? "0 14px" : "0 20px",
          background: "rgba(14,21,32,0.90)", backdropFilter: "blur(24px)",
          borderBottom: `1px solid ${C.BORDER}`,
          gap: 12,
        }}>
          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
            <div style={{ position: "relative", flexShrink: 0 }}>
              <img
                src="/logo.png"
                alt="Sado AI logo"
                style={{
                  width: 42, height: 42,
                  borderRadius: 12,
                  objectFit: "cover",
                  display: "block",
                  boxShadow: `0 0 20px rgba(0,203,194,0.32)`,
                }}
              />
              <span style={{
                position: "absolute", top: -3, right: -3, width: 10, height: 10,
                borderRadius: "50%", background: C.GREEN, border: `2px solid ${C.BG}`
              }} className="pulse-dot" />
            </div>
            <div>
              <h1 style={{ fontSize: 16, fontWeight: 800, color: C.TEXT1, letterSpacing: "-0.03em", lineHeight: 1.1 }}>
                Sado <span style={{ color: C.ACCENT }}>AI</span>
              </h1>
              <p style={{ fontSize: 10, color: C.TEXT3, lineHeight: 1, marginTop: 2, fontWeight: 500 }}>O'zbekona shevalar</p>
            </div>
          </div>

          {/* ── Center ticker — bir marta chapdan o'ngga ── */}
          <div style={{
            flex: 1, overflow: "hidden",
            display: "flex", alignItems: "center",
            maxWidth: isMobile ? 180 : 420,
            margin: "0 auto",
            maskImage: "linear-gradient(90deg, transparent 0%, black 10%, black 90%, transparent 100%)",
            WebkitMaskImage: "linear-gradient(90deg, transparent 0%, black 10%, black 90%, transparent 100%)",
          }}>
            <style>{`
              @keyframes headerTickerOnce {
                0%   { transform: translateX(-110%); opacity: 0; }
                2%   { opacity: 1; }
                4%   { transform: translateX(0%); opacity: 1; }
                95%  { transform: translateX(0%); opacity: 1; }
                100% { transform: translateX(0%); opacity: 0; }
              }
              @keyframes headerTickerMarquee {
                0%   { transform: translateX(120%); }
                100% { transform: translateX(-120%); }
              }
              .header-ticker-text {
                animation: headerTickerOnce 90s ease-out 0.8s both;
                white-space: nowrap;
                display: flex;
                align-items: center;
                gap: 10px;
                width: 100%;
                justify-content: center;
              }
              .header-ticker-text-mobile {
                animation: headerTickerMarquee 15s linear infinite;
                white-space: nowrap;
                display: flex;
                align-items: center;
                gap: 8px;
              }
            `}</style>
            <div className={isMobile ? "header-ticker-text-mobile" : "header-ticker-text"}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f472b6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                <circle cx="12" cy="12" r="4" />
                <circle cx="17.5" cy="6.5" r="1" fill="#f472b6" stroke="none" />
              </svg>
              <a
                href="https://instagram.com/ziyodxonlutfiddinov"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: isMobile ? 10 : 12, fontWeight: 700, color: C.TEXT2,
                  textDecoration: "none", letterSpacing: "0.01em",
                }}
              >
                Ijtimoiy tarmoqlarda bizni belgilang!
              </a>
              <svg width="13" height="13" viewBox="0 0 24 24" fill={C.ACCENT} style={{ flexShrink: 0 }}>
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L8.17 13.617l-2.96-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.978.942z" />
              </svg>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={() => setShowHistory(true)}
              style={{
                display: "flex", alignItems: "center", gap: isMobile ? 0 : 8,
                padding: isMobile ? "9px 12px" : "10px 18px",
                borderRadius: 10, cursor: "pointer",
                background: C.CARD, border: `1px solid ${C.BORDER}`, color: C.TEXT2,
                fontSize: 13, fontWeight: 600, position: "relative", transition: "all 0.15s"
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = C.ACCENT; (e.currentTarget as HTMLElement).style.color = C.ACCENT; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = C.BORDER; (e.currentTarget as HTMLElement).style.color = C.TEXT2; }}>
              <Clock size={15} />
              {!isMobile && <span>Tarix</span>}
              {history.length > 0 && (
                <span style={{
                  position: "absolute", top: -7, right: -7, width: 18, height: 18,
                  borderRadius: "50%", background: C.ACCENT, color: C.BG,
                  fontSize: 9, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center"
                }}>
                  {history.length}
                </span>
              )}
            </button>
          </div>
        </header>

        {/* ══ MAIN ══ */}
        <main style={{
          flex: 1, display: "grid",
          gridTemplateColumns: isTablet ? "1fr" : "1fr 400px",
          maxWidth: 1300, width: "100%", margin: "0 auto",
          position: "relative", zIndex: 1,
        }}>

          {/* ═ LEFT ═ */}
          <section style={{
            padding: P,
            display: "flex", flexDirection: "column", gap: isMobile ? 12 : 16,
            overflowY: isTablet ? "visible" : "auto",
            maxHeight: isTablet ? "none" : "calc(100vh - 64px)",
            borderRight: isTablet ? "none" : `1px solid ${C.BORDER}`,
            borderBottom: isTablet ? `1px solid ${C.BORDER}` : "none",
          }}>

            {/* ── Matn Kiritish ── */}
            <div style={{ background: C.CARD, border: `1px solid ${C.BORDER}`, borderRadius: 16, padding: P }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 16 }}>✏️</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: C.TEXT1 }}>Matn Kiritish</span>
                </div>
                <span style={{
                  fontSize: 11, fontWeight: 700, fontFamily: "monospace",
                  color: charCount > 450 ? "#ff5c5c" : charCount > 350 ? "#f59e0b" : C.TEXT2
                }}>
                  {charCount}<span style={{ color: C.TEXT3 }}>/500</span>
                </span>
              </div>

              {/* Textarea — relative wrapper for floating AI button */}
              <div style={{ position: "relative" }}>
                <textarea
                  value={text}
                  onChange={e => {
                    const val = e.target.value;
                    const cc = val.trim().length === 0 ? 0 : val.trim().replace(/\s+/g, " ").length;
                    if (cc > 500) {
                      addToast("⚠️ Uzr! Faqat 500 ta belgi kiritishingiz mumkin.", "error");
                      return;
                    }
                    setText(val);
                    if (cc > 50 && !aiToastShown.current) {
                      aiToastShown.current = true;
                      addToast("✨ Imlo xatolarni to'g'irlash uchun mendan foydalaning!", "info");
                    }
                  }}
                  rows={isMobile ? 4 : 6}
                  placeholder="O'zbekcha matnni shu yerga yozing..."
                  style={{
                    width: "100%", padding: isMobile ? "12px 14px" : "14px 16px", borderRadius: 10,
                    background: C.SURFACE, border: `1px solid ${C.BORDER}`,
                    color: C.TEXT1, fontSize: 14, fontWeight: 500, lineHeight: 1.7,
                    resize: "none", outline: "none", fontFamily: "inherit",
                    transition: "border-color 0.15s, box-shadow 0.15s"
                  }}
                  onFocus={e => { e.target.style.borderColor = C.ACCENT; e.target.style.boxShadow = `0 0 0 3px rgba(0,203,194,0.08)`; }}
                  onBlur={e => { e.target.style.borderColor = C.BORDER; e.target.style.boxShadow = "none"; }}
                />
                {/* Floating AI enhance button */}
                {charCount > 50 && (
                  <button
                    onClick={handleEnhance}
                    disabled={isEnhancing || isGenerating}
                    className="ai-float-btn fadeUp"
                    title="AI bilan imlo va grammatikani tekshirish"
                    style={{
                      position: "absolute", bottom: 10, right: 10,
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "7px 13px", borderRadius: 20,
                      cursor: isEnhancing ? "wait" : "pointer",
                      background: isEnhancing
                        ? "rgba(0,203,194,0.07)"
                        : "linear-gradient(135deg,rgba(0,148,143,0.92),rgba(0,203,194,0.92))",
                      backdropFilter: "blur(16px)",
                      border: `1px solid ${isEnhancing ? "rgba(0,203,194,0.2)" : "rgba(0,203,194,0.5)"}`,
                      color: isEnhancing ? "rgba(0,203,194,0.45)" : "#021c1a",
                      fontSize: 11, fontWeight: 800,
                      boxShadow: isEnhancing ? "none" : "0 2px 14px rgba(0,203,194,0.32)",
                      zIndex: 5,
                    }}
                  >
                    {isEnhancing
                      ? <RefreshCw size={11} style={{ animation: "spinAnim 1s linear infinite" }} />
                      : <Sparkles size={11} />}
                    <span>{isEnhancing ? "Tekshirilmoqda..." : "Imlo tekshir"}</span>
                  </button>
                )}
              </div>

              {/* Progress bar */}
              <div style={{ height: 3, background: C.SURFACE, borderRadius: 4, marginTop: 10, overflow: "hidden" }}>
                <div style={{
                  height: "100%", borderRadius: 4, transition: "width 0.3s",
                  width: `${textRatio}%`,
                  background: textRatio > 90 ? "#ef4444" : textRatio > 70 ? "#f59e0b" : C.ACCENT
                }} />
              </div>
            </div>

            {/* ── Ovoz Personajlari — 5-ustunli GRID ── */}
            <div style={{ background: C.CARD, border: `1px solid ${C.BORDER}`, borderRadius: 16, padding: P }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                <span style={{ fontSize: 16 }}>🎤</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: C.TEXT1 }}>Ovoz Personaji</span>
                <span style={{
                  marginLeft: "auto", fontSize: 11, fontWeight: 700,
                  padding: "3px 10px", borderRadius: 20, background: C.ADIM, color: C.ACCENT
                }}>
                  {activeVoice?.sticker} {voiceName}
                </span>
              </div>
              <div style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(5,1fr)",
                gap: isMobile ? 8 : 10,
              }}>
                {VOICES.map(v => {
                  const sel = voiceName === v.name;
                  return (
                    <div key={v.name}>
                      <button onClick={() => setVoiceName(v.name)}
                        className="voice-card"
                        style={{
                          width: "100%",
                          padding: isMobile ? "12px 6px" : "16px 8px",
                          borderRadius: 14, position: "relative",
                          background: sel ? "rgba(0,203,194,0.09)" : C.SURFACE,
                          border: sel ? `2px solid ${C.ACCENT}` : `2px solid ${C.BORDER}`,
                          boxShadow: sel ? `0 0 24px rgba(0,203,194,0.2)` : "none",
                          display: "flex", flexDirection: "column", alignItems: "center", gap: isMobile ? 6 : 8
                        }}>
                        {v.recommended && (
                          <span style={{
                            position: "absolute", top: -8, left: 8,
                            fontSize: 8, fontWeight: 800, padding: "2px 6px", borderRadius: 20,
                            background: C.ACCENT, color: C.BG, letterSpacing: "0.05em"
                          }}>TOP</span>
                        )}
                        {sel && (
                          <span style={{
                            position: "absolute", top: 7, right: 7, width: 18, height: 18,
                            borderRadius: "50%", background: C.ACCENT,
                            display: "flex", alignItems: "center", justifyContent: "center"
                          }}>
                            <Check size={10} color={C.BG} strokeWidth={3} />
                          </span>
                        )}
                        <span style={{
                          fontSize: isMobile ? 30 : 38, lineHeight: 1,
                          filter: sel ? `drop-shadow(0 0 10px ${v.glow})` : `none`,
                          transition: "filter 0.2s"
                        }}>{v.sticker}</span>
                        <div style={{ textAlign: "center" }}>
                          <p style={{ fontSize: 12, fontWeight: 700, color: sel ? C.ACCENT : C.TEXT1, lineHeight: 1.2 }}>{v.name}</p>
                          <span style={{
                            fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 20,
                            marginTop: 4, display: "inline-block",
                            background: sel ? C.ADIM : C.CARD2, color: sel ? C.ACCENT : C.TEXT3
                          }}>
                            {v.gender}
                          </span>
                        </div>
                      </button>
                    </div>
                  );
                })}
              </div>
              <div style={{
                marginTop: isMobile ? 8 : 12, padding: isMobile ? "8px 12px" : "10px 14px", borderRadius: 10,
                background: C.SURFACE, border: `1px solid ${C.BORDER}`,
                display: "flex", alignItems: "center", gap: isMobile ? 8 : 10
              }}>
                <span style={{ fontSize: isMobile ? 18 : 22 }}>{activeVoice?.sticker}</span>
                <div>
                  <p style={{ fontSize: isMobile ? 11 : 12, fontWeight: 700, color: activeVoice?.color }}>{activeVoice?.name} — {activeVoice?.gender} ovozi</p>
                  <p style={{ fontSize: 11, color: C.TEXT2, marginTop: 2 }}>{activeVoice?.desc}</p>
                </div>
              </div>
            </div>

            {/* ── Viloyat Shevasi ── */}
            <div style={{ background: C.CARD, border: `1px solid ${C.BORDER}`, borderRadius: 16, padding: P }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <MapPin size={15} color={C.ACCENT} />
                <span style={{ fontSize: 14, fontWeight: 700, color: C.TEXT1 }}>Viloyat Shevasi</span>
              </div>
              <p style={{ fontSize: 11, color: C.TEXT3, marginBottom: 14, lineHeight: 1.5, fontWeight: 500 }}>
                Matnni tanlangan viloyat shevasida sintez qilish uchun tanlang
              </p>
              <div style={{
                display: isMobile ? "grid" : "flex",
                gridTemplateColumns: isMobile ? "repeat(3,1fr)" : undefined,
                flexWrap: isMobile ? undefined : "wrap",
                gap: 7,
              }}>
                {DIALECTS.map(d => {
                  const sel = dialect === d.id;
                  return (
                    <button key={d.id} onClick={() => setDialect(d.id)}
                      className="dialect-chip"
                      style={{
                        padding: isMobile ? "8px 10px" : "9px 14px", borderRadius: 10,
                        fontSize: isMobile ? 11 : 12,
                        background: sel ? C.ADIM : C.SURFACE,
                        border: `1px solid ${sel ? C.ACCENT : C.BORDER}`,
                        color: sel ? C.ACCENT : C.TEXT2,
                        fontWeight: sel ? 700 : 500,
                        boxShadow: sel ? `0 0 14px rgba(0,203,194,0.14)` : `none`,
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 4, transition: "all 0.15s"
                      }}>
                      {sel && <Check size={11} color={C.ACCENT} strokeWidth={3} />}
                      {d.name}
                    </button>
                  );
                })}
              </div>
              <div className="fadeUp" style={{
                marginTop: 12, padding: "13px 16px", borderRadius: 12,
                background: C.SURFACE, border: `1px solid ${dialect !== "standard" ? C.ACCENT : C.BORDER}`,
                display: "flex", alignItems: "flex-start", gap: 10,
                boxShadow: dialect !== "standard" ? `0 0 16px rgba(0,203,194,0.1)` : "none"
              }}>
                <Info size={14} color={dialect !== "standard" ? C.ACCENT : C.TEXT3} style={{ flexShrink: 0, marginTop: 1 }} />
                <div>
                  <p style={{ fontSize: 12, fontWeight: 700, color: dialect !== "standard" ? C.ACCENT : C.TEXT1, marginBottom: 3 }}>
                    {activeDial?.full}
                  </p>
                  <p style={{ fontSize: 11, color: C.TEXT2, lineHeight: 1.55 }}>{activeDial?.desc}</p>
                </div>
              </div>
            </div>

            {/* ── Nutq Sozlamalari ── */}
            <div style={{
              background: C.CARD, border: `1px solid ${C.BORDER}`, borderRadius: 16, padding: P,
              display: "flex", flexDirection: "column", gap: isMobile ? 14 : 20
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 16 }}>⚙️</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: C.TEXT1 }}>Nutq Uslubi</span>
              </div>

              <div>
                <label style={{
                  display: "block", fontSize: 10, fontWeight: 700, textTransform: "uppercase",
                  letterSpacing: "0.1em", color: C.TEXT3, marginBottom: 10
                }}>Nutq Uslubi</label>
                <div style={{
                  display: "grid",
                  gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(5,1fr)",
                  gap: 8,
                }}>
                  {EMOTIONS.map(em => {
                    const act = style === em.id;
                    return (
                      <button key={em.id} onClick={() => setStyle(em.id)} className="emo-btn"
                        style={{
                          display: "flex", alignItems: "center", gap: 6,
                          padding: isMobile ? "10px 12px" : "11px 18px",
                          borderRadius: 10, cursor: "pointer", minHeight: 44,
                          justifyContent: isMobile ? "center" : "flex-start",
                          background: act ? C.ADIM : C.SURFACE,
                          border: `1px solid ${act ? C.ACCENT : C.BORDER}`,
                          color: act ? C.ACCENT : C.TEXT2,
                          fontSize: 13, fontWeight: act ? 700 : 500,
                          boxShadow: act ? `0 0 14px rgba(0,203,194,0.14)` : "none",
                          transition: "all 0.15s"
                        }}>
                        <span style={{ fontSize: 18 }}>{em.icon}</span>
                        <span>{em.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* ── CTA ── */}
            <button onClick={handleSynthesize} disabled={isGenerating || isEnhancing}
              className="btn-teal"
              style={{
                width: "100%", borderRadius: 16, letterSpacing: "-0.02em",
                fontSize: "clamp(14px, 2.5vw, 17px)",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
                padding: "clamp(16px,3vw,22px) 24px", position: "relative", overflow: "hidden"
              }}>
              {/* Shimmer */}
              {!isGenerating && !isEnhancing && (
                <span style={{
                  position: "absolute", top: 0, bottom: 0, width: "50%",
                  background: "linear-gradient(105deg,transparent,rgba(255,255,255,0.14),transparent)",
                  animation: "shimmerCTA 2.6s ease-in-out infinite", pointerEvents: "none"
                }} />
              )}
              {isGenerating
                ? <RefreshCw size={22} style={{ animation: "spinAnim 1s linear infinite", color: "rgba(2,26,24,0.7)" }} />
                : <Volume2 size={22} />}
              <span style={{ fontWeight: 900 }}>
                {isGenerating ? "Sintez qilinmoqda..." : "Matnni Ovozga Aylantirish"}
              </span>
            </button>

            <div style={{ height: 8 }} />
          </section>

          {/* ═ RIGHT: Player ═ */}
          <section style={{
            display: "flex", flexDirection: "column",
            overflowY: isTablet ? "visible" : "auto",
            maxHeight: isTablet ? "none" : "calc(100vh - 64px)",
            background: `rgba(22,32,46,0.5)`,
          }}>
            <div style={{ padding: P, display: "flex", flexDirection: "column", gap: 14, flex: 1 }}>

              {/* Player card */}
              <div style={{
                background: C.CARD, border: `1px solid ${C.BORDER}`,
                borderRadius: 16, padding: P, position: "relative", overflow: "hidden"
              }}>
                <div style={{
                  position: "absolute", top: -30, right: -30, width: 130, height: 130,
                  borderRadius: "50%", background: "rgba(0,203,194,0.06)", pointerEvents: "none"
                }} />

                {!audioUrl ? (
                  <div style={{
                    display: "flex", flexDirection: "column", alignItems: "center",
                    justifyContent: "center", padding: "32px 0", textAlign: "center", gap: 14
                  }}>
                    <div style={{
                      width: 64, height: 64, borderRadius: 16,
                      background: C.SURFACE, border: `1px solid ${C.BORDER}`,
                      display: "flex", alignItems: "center", justifyContent: "center"
                    }}>
                      <Headphones size={28} color={C.TEXT3} />
                    </div>
                    <div>
                      <p style={{ fontSize: 13, fontWeight: 600, color: C.TEXT2 }}>Kutish rejimi</p>
                      <p style={{ fontSize: 11, color: C.TEXT3, marginTop: 4, lineHeight: 1.55, maxWidth: 190 }}>
                        Matn kiriting va sintez qiling — audio bu yerda ijro etiladi
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="fadeUp" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    {/* Sintez snapshoti — har doim sintez paytidagi holatni ko'rsatadi */}
                    {(() => {
                      const snap = synthSnapshot;
                      const snapVoice = VOICES.find(v => v.name === (snap?.voiceName || voiceName));
                      const snapDial = DIALECTS.find(d => d.id === (snap?.dialect || dialect));
                      const snapEmo = EMOTIONS.find(e => e.id === (snap?.style || style));
                      const snapSpeed = snap?.speed ?? speed;
                      const snapDialId = snap?.dialect || dialect;
                      return (
                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                              <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.GREEN }} className="pulse-dot" />
                              <span style={{
                                fontSize: 9, fontWeight: 800, textTransform: "uppercase",
                                letterSpacing: "0.1em", color: C.ACCENT
                              }}>Ijro Rejimi</span>
                            </div>
                            <p style={{ fontSize: isMobile ? 15 : 18, fontWeight: 800, color: C.TEXT1, letterSpacing: "-0.03em" }}>
                              {snapVoice?.sticker} {snap?.voiceName || voiceName}
                              <span style={{ fontWeight: 400, fontSize: isMobile ? 12 : 14, color: C.TEXT3 }}> ovozi</span>
                            </p>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5, flexWrap: "wrap" }}>
                              <span style={{ fontSize: 10, color: C.TEXT2 }}>
                                {snapEmo?.icon} {snapEmo?.label}
                              </span>
                              <span style={{ color: C.BORDER }}>·</span>
                              <span style={{ fontSize: 10, color: C.TEXT2 }}>{snapSpeed.toFixed(1)}×</span>
                              {snapDialId !== "standard" && (
                                <span style={{
                                  fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
                                  background: C.ADIM, color: C.ACCENT
                                }}>
                                  {snapDial?.name || snapDialId}
                                </span>
                              )}
                            </div>
                          </div>
                          <div style={{
                            width: 44, height: 44, borderRadius: 12,
                            background: C.SURFACE, border: `1px solid ${C.BORDER}`,
                            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0
                          }}>
                            <Disc size={20} color={C.ACCENT}
                              style={{ animation: isPlaying ? "spinAnim 2s linear infinite" : "none" }} />
                          </div>
                        </div>
                      );
                    })()}

                    {(synthSnapshot?.synthesizedText || synthesizedText) && (
                      <div className="fadeUp" style={{
                        padding: "12px 14px", borderRadius: 10,
                        background: C.SURFACE, border: `1px solid ${C.BORDER}`
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                          <MapPin size={11} color={C.ACCENT} />
                          <span style={{
                            fontSize: 9, fontWeight: 800, textTransform: "uppercase",
                            letterSpacing: "0.1em", color: C.ACCENT
                          }}>Sheva Matni</span>
                        </div>
                        <p style={{ fontSize: 12, color: C.TEXT2, lineHeight: 1.6, userSelect: "all" }}>
                          {synthSnapshot?.synthesizedText || synthesizedText}
                        </p>
                      </div>
                    )}

                    {/* Waveform */}
                    <div onClick={handleWaveClick}
                      style={{
                        display: "flex", alignItems: "flex-end", gap: 2, height: 48,
                        padding: "6px 10px", borderRadius: 10, cursor: "pointer",
                        background: C.SURFACE, border: `1px solid ${C.BORDER}`
                      }}>
                      {waveformBars.map((bh, i) => {
                        const prog = duration > 0 ? currentTime / duration : 0;
                        const played = (i / waveformBars.length) < prog;
                        return <div key={i} style={{
                          flex: 1, borderRadius: 2,
                          height: `${Math.floor(bh * 34) + 4}px`,
                          background: played ? C.ACCENT : C.BORDER,
                          boxShadow: played ? `0 0 5px rgba(0,203,194,0.4)` : "none",
                          transition: "background 0.05s"
                        }} />;
                      })}
                    </div>

                    {/* Controls */}
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <button onClick={togglePlay}
                        style={{
                          width: isMobile ? 46 : 52, height: isMobile ? 46 : 52, borderRadius: "50%", flexShrink: 0,
                          cursor: "pointer", border: "none",
                          background: `linear-gradient(135deg,#009d96,${C.ACCENT})`,
                          boxShadow: `0 4px 18px rgba(0,203,194,0.42)`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          transition: "all 0.15s"
                        }}>
                        {isPlaying
                          ? <Pause size={20} fill={C.BG} color={C.BG} />
                          : <Play size={20} fill={C.BG} color={C.BG} style={{ marginLeft: 2 }} />}
                      </button>
                      <div style={{ flex: 1 }}>
                        <div style={{
                          display: "flex", justifyContent: "space-between", marginBottom: 6,
                          fontFamily: "monospace", fontSize: 10, color: C.TEXT2
                        }}>
                          <span>{fmt(currentTime)}</span><span>{fmt(duration)}</span>
                        </div>
                        <div style={{ height: 4, borderRadius: 4, background: C.CARD2, overflow: "hidden" }}>
                          <div style={{
                            height: "100%", borderRadius: 4, transition: "width 0.1s",
                            width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%`,
                            background: C.ACCENT
                          }} />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Spectrogram */}
              <div style={{ background: C.CARD, border: `1px solid ${C.BORDER}`, borderRadius: 16, padding: isMobile ? 12 : 16 }}>
                <p style={{
                  fontSize: 9, fontWeight: 700, textTransform: "uppercase",
                  letterSpacing: "0.12em", color: C.TEXT3, marginBottom: 10
                }}>Spektral Analizator</p>
                <div style={{ borderRadius: 10, overflow: "hidden", position: "relative", background: C.SURFACE }}>
                  <canvas ref={canvasRef} width={360} height={72}
                    style={{ width: "100%", height: 72, display: "block" }} />
                  {!isPlaying && (
                    <div style={{
                      position: "absolute", inset: 0, display: "flex",
                      alignItems: "center", justifyContent: "center"
                    }}>
                      <span style={{
                        fontSize: 9, fontFamily: "monospace", textTransform: "uppercase",
                        letterSpacing: "0.1em", color: C.BORDER
                      }}>Audio ijroda faollanadi</span>
                    </div>
                  )}
                </div>
              </div>

              {/* MP3 Download */}
              {mp3Url && (
                <div className="fadeUp" style={{
                  borderRadius: 16, overflow: "hidden",
                  border: `1px solid rgba(0,203,194,0.24)`,
                  background: `linear-gradient(135deg,rgba(0,203,194,0.08),rgba(0,203,194,0.04))`
                }}>
                  <div style={{
                    padding: isMobile ? "14px" : "16px 20px",
                    display: "flex",
                    flexDirection: isMobile ? "column" : "row",
                    alignItems: isMobile ? "stretch" : "center",
                    justifyContent: "space-between", gap: 12
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                        background: "rgba(0,203,194,0.15)", border: `1px solid rgba(0,203,194,0.3)`,
                        display: "flex", alignItems: "center", justifyContent: "center"
                      }}>
                        <Download size={14} color={C.ACCENT} />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <p style={{
                          fontSize: isMobile ? 11 : 12, fontWeight: 800, color: C.ACCENT,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
                        }}>
                          SADO AI · {(synthSnapshot?.dialect || dialect) === "standard" ? "Adabiy" : DIALECTS.find(d => d.id === (synthSnapshot?.dialect || dialect))?.name} · {synthSnapshot?.voiceName || voiceName}
                        </p>
                        <p style={{ fontSize: 10, color: C.TEXT3, marginTop: 2, fontFamily: "monospace" }}>
                          MP3 · SADO AI
                        </p>
                      </div>
                    </div>
                    <a
                      href={mp3Url}
                      download={`SadoAi_${(synthSnapshot?.dialect || dialect) === "standard" ? "Adabiy" : DIALECTS.find(d => d.id === (synthSnapshot?.dialect || dialect))?.name || "Standard"}_${synthSnapshot?.voiceName || voiceName}.mp3`}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                        padding: isMobile ? "12px" : "12px 20px",
                        borderRadius: 10,
                        background: `linear-gradient(135deg,#009d96,${C.ACCENT})`,
                        color: "#031a19", fontSize: 13, fontWeight: 900, textDecoration: "none",
                        boxShadow: `0 4px 18px rgba(0,203,194,0.35)`,
                        letterSpacing: "-0.01em",
                      }}>
                      <Download size={15} /> MP3 Yuklab Olish
                    </a>
                  </div>
                </div>
              )}
            </div>
            <div style={{
              padding: isMobile ? "12px 14px 16px" : "14px 24px 18px",
              borderTop: `1px solid ${C.BORDER}`,
              display: "flex", alignItems: "center",
              justifyContent: "space-between", flexWrap: "wrap", gap: 10,
            }}>
              <p style={{ fontSize: 9, color: C.TEXT3, fontWeight: 500 }}>
                © 2026 SADO AI · Barcha huquqlar himoyalangan
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {/* Instagram */}
                <a
                  href="https://instagram.com/ziyodxonlutfiddinov"
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Instagram"
                  style={{
                    width: 32, height: 32, borderRadius: 9,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: "rgba(225,48,108,0.08)",
                    border: "1px solid rgba(225,48,108,0.2)",
                    color: "#e1306c", textDecoration: "none",
                    transition: "all 0.18s",
                  }}
                  onMouseEnter={e => {
                    const el = e.currentTarget as HTMLElement;
                    el.style.background = "rgba(225,48,108,0.18)";
                    el.style.borderColor = "rgba(225,48,108,0.5)";
                    el.style.transform = "translateY(-2px)";
                    el.style.boxShadow = "0 4px 14px rgba(225,48,108,0.25)";
                  }}
                  onMouseLeave={e => {
                    const el = e.currentTarget as HTMLElement;
                    el.style.background = "rgba(225,48,108,0.08)";
                    el.style.borderColor = "rgba(225,48,108,0.2)";
                    el.style.transform = "none";
                    el.style.boxShadow = "none";
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#e1306c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                    <circle cx="12" cy="12" r="4" />
                    <circle cx="17.5" cy="6.5" r="1" fill="#e1306c" stroke="none" />
                  </svg>
                </a>
                {/* Telegram */}
                <a
                  href="https://t.me/Ziyodxonlutfiddinov"
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Telegram"
                  style={{
                    width: 32, height: 32, borderRadius: 9,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: "rgba(0,136,204,0.08)",
                    border: "1px solid rgba(0,136,204,0.2)",
                    color: "#0088cc", textDecoration: "none",
                    transition: "all 0.18s",
                  }}
                  onMouseEnter={e => {
                    const el = e.currentTarget as HTMLElement;
                    el.style.background = "rgba(0,136,204,0.18)";
                    el.style.borderColor = "rgba(0,136,204,0.5)";
                    el.style.transform = "translateY(-2px)";
                    el.style.boxShadow = "0 4px 14px rgba(0,136,204,0.25)";
                  }}
                  onMouseLeave={e => {
                    const el = e.currentTarget as HTMLElement;
                    el.style.background = "rgba(0,136,204,0.08)";
                    el.style.borderColor = "rgba(0,136,204,0.2)";
                    el.style.transform = "none";
                    el.style.boxShadow = "none";
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="#0088cc">
                    <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L8.17 13.617l-2.96-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.978.942z" />
                  </svg>
                </a>
              </div>
            </div>

          </section>
        </main>

        {/* ══ HISTORY PLAYER DIALOG ══ */}
        {historyPlayItem && (
          <HistoryPlayerDialog
            item={historyPlayItem}
            onClose={() => setHistoryPlayItem(null)}
            onLoadToMain={loadHistoryToMain}
            onDownload={(item, e) => downloadMp3(item, e)}
          />
        )}

        {/* ══ HISTORY MODAL ══ */}
        {showHistory && (
          <div className="modal-overlay" style={{
            position: "fixed", inset: 0, zIndex: 50,
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: isMobile ? 12 : 16,
            background: "rgba(0,0,0,0.78)", backdropFilter: "blur(20px)"
          }}
            onClick={e => { if (e.target === e.currentTarget) setShowHistory(false); }}>
            <div className="scaleIn modal-card" style={{
              width: "100%", maxWidth: isMobile ? "100%" : 640,
              maxHeight: isMobile ? "85vh" : "82vh",
              borderRadius: 20,
              display: "flex", flexDirection: "column",
              background: C.CARD, border: `1px solid ${C.BORDER}`,
              boxShadow: `0 24px 80px rgba(0,0,0,0.7)`, overflow: "hidden"
            }}>

              <div style={{ height: 2, background: `linear-gradient(90deg,transparent,${C.ACCENT},transparent)` }} />

              {/* Header */}
              <div style={{
                padding: isMobile ? "12px 14px" : "18px 20px",
                borderBottom: `1px solid ${C.BORDER}`, flexShrink: 0
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 8 : 12 }}>
                    {!isMobile && (
                      <div style={{
                        width: 40, height: 40, borderRadius: 10, background: C.ADIM,
                        border: `1px solid rgba(0,203,194,0.2)`,
                        display: "flex", alignItems: "center", justifyContent: "center"
                      }}>
                        <Clock size={18} color={C.ACCENT} />
                      </div>
                    )}
                    <div>
                      <h2 style={{ fontSize: isMobile ? 14 : 15, fontWeight: 800, color: C.TEXT1 }}>
                        {isMobile && <Clock size={13} color={C.ACCENT} style={{ marginRight: 6, verticalAlign: "-2px" }} />}
                        Sintez Tarixi
                      </h2>
                      <p style={{ fontSize: 10, color: C.TEXT3, marginTop: 2 }}>{history.length} ta yozuv</p>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: isMobile ? 6 : 8 }}>
                    {history.length > 0 && (
                      <button
                        onClick={() => setConfirmDelete({ id: "ALL", text: "Barcha " + history.length + " ta yozuv o'chiriladi!" })}
                        style={{
                          display: "flex", alignItems: "center", gap: 4,
                          padding: isMobile ? "7px 10px" : "9px 14px",
                          borderRadius: 9, cursor: "pointer", background: C.REDDIM,
                          border: `1px solid rgba(255,92,92,0.2)`, color: C.RED,
                          fontSize: isMobile ? 11 : 12, fontWeight: 600
                        }}>
                        <Trash2 size={12} />{!isMobile && <span>Tozalash</span>}
                        {isMobile && <span>🗑</span>}
                      </button>
                    )}
                    <button onClick={() => setShowHistory(false)}
                      style={{
                        width: isMobile ? 34 : 40, height: isMobile ? 34 : 40, borderRadius: isMobile ? 8 : 10, cursor: "pointer",
                        background: C.SURFACE, border: `1px solid ${C.BORDER}`,
                        color: C.TEXT3, display: "flex", alignItems: "center", justifyContent: "center",
                        transition: "all 0.15s"
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = C.REDDIM; (e.currentTarget as HTMLElement).style.color = C.RED; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = C.SURFACE; (e.currentTarget as HTMLElement).style.color = C.TEXT3; }}>
                      <X size={14} />
                    </button>
                  </div>
                </div>
              </div>

              <div style={{ flex: 1, overflowY: "auto", padding: isMobile ? 8 : 16, display: "flex", flexDirection: "column", gap: isMobile ? 6 : 8 }}>
                {history.length === 0 ? (
                  <div style={{
                    display: "flex", flexDirection: "column", alignItems: "center",
                    justifyContent: "center", padding: isMobile ? "32px 0" : "48px 0", gap: 14, textAlign: "center"
                  }}>
                    <div style={{
                      width: isMobile ? 48 : 64, height: isMobile ? 48 : 64, borderRadius: 16, background: C.SURFACE,
                      border: `1px dashed ${C.BORDER}`, display: "flex", alignItems: "center", justifyContent: "center"
                    }}>
                      <Clock size={isMobile ? 22 : 28} color={C.TEXT3} />
                    </div>
                    <div>
                      <p style={{ fontSize: isMobile ? 13 : 14, fontWeight: 600, color: C.TEXT2 }}>Hali hech narsa sintez qilinmagan</p>
                      <p style={{ fontSize: 11, color: C.TEXT3, marginTop: 4 }}>Sintez qilingan ovozlar bu yerda saqlanadi</p>
                    </div>
                  </div>
                ) : history.map(item => {
                  const v = VOICES.find(v => v.name === item.voiceName);
                  return (
                    <div key={item.id} onClick={() => loadHistoryItem(item)}
                      style={{
                        display: "flex", flexDirection: isMobile ? "column" : "row",
                        alignItems: isMobile ? "stretch" : "center",
                        gap: isMobile ? 8 : 12,
                        padding: isMobile ? "10px" : "14px 16px",
                        borderRadius: 12, cursor: "pointer", background: C.SURFACE,
                        border: `1px solid ${C.BORDER}`, transition: "all 0.15s"
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = C.CARD2; (e.currentTarget as HTMLElement).style.borderColor = "rgba(0,203,194,0.22)"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = C.SURFACE; (e.currentTarget as HTMLElement).style.borderColor = C.BORDER; }}>
                      {/* Top row: emoji + text */}
                      <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 8 : 12, flex: 1, minWidth: 0 }}>
                        <div style={{
                          width: isMobile ? 34 : 44, height: isMobile ? 34 : 44, borderRadius: 10, flexShrink: 0,
                          background: C.CARD, border: `1px solid ${C.BORDER}`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: isMobile ? 16 : 22
                        }}>
                          {v?.sticker || "🎙️"}
                        </div>
                        <div style={{ flex: 1, overflow: "hidden" }}>
                          <p style={{
                            fontSize: isMobile ? 12 : 13, fontWeight: 600, color: C.TEXT1,
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
                          }}>{item.text}</p>
                          <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 3, flexWrap: "wrap" }}>
                            <span style={{ fontSize: isMobile ? 10 : 11, fontWeight: 700, color: v?.color || C.ACCENT }}>{item.voiceName}</span>
                            <span style={{ color: C.BORDER, fontSize: 8 }}>·</span>
                            <span style={{ fontSize: 10, color: C.TEXT3 }}>{item.timestamp}</span>
                            {item.dialect && item.dialect !== "standard" && (
                              <span style={{
                                fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 20,
                                background: C.ADIM, color: C.ACCENT
                              }}>{item.dialect}</span>
                            )}
                          </div>
                        </div>
                      </div>
                      {/* Action buttons */}
                      <div style={{
                        display: "flex", gap: isMobile ? 6 : 6,
                        justifyContent: isMobile ? "flex-end" : "flex-start",
                        flexShrink: 0
                      }}>
                        <div style={{
                          width: isMobile ? 32 : 36, height: isMobile ? 32 : 36, borderRadius: 8, background: C.ADIM,
                          border: `1px solid rgba(0,203,194,0.2)`,
                          display: "flex", alignItems: "center", justifyContent: "center"
                        }}>
                          <Play size={12} fill={C.ACCENT} color={C.ACCENT} style={{ marginLeft: 1 }} />
                        </div>
                        <button onClick={e => downloadMp3(item, e)} title="MP3 yuklab olish"
                          style={{
                            width: isMobile ? 32 : 36, height: isMobile ? 32 : 36, borderRadius: 8, cursor: "pointer",
                            background: C.CARD, border: `1px solid ${C.BORDER}`,
                            color: C.TEXT2, display: "flex", alignItems: "center", justifyContent: "center",
                            transition: "all 0.15s"
                          }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = C.ADIM; (e.currentTarget as HTMLElement).style.color = C.ACCENT; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = C.CARD; (e.currentTarget as HTMLElement).style.color = C.TEXT2; }}>
                          <Download size={12} />
                        </button>
                        <button onClick={e => deleteItem(item.id, item.text, e)} title="O'chirish"
                          style={{
                            width: isMobile ? 32 : 36, height: isMobile ? 32 : 36, borderRadius: 8, cursor: "pointer",
                            background: C.CARD, border: `1px solid ${C.BORDER}`,
                            color: C.TEXT3, display: "flex", alignItems: "center", justifyContent: "center",
                            transition: "all 0.15s"
                          }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = C.REDDIM; (e.currentTarget as HTMLElement).style.color = C.RED; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = C.CARD; (e.currentTarget as HTMLElement).style.color = C.TEXT3; }}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ height: 2, background: `linear-gradient(90deg,transparent,rgba(0,203,194,0.22),transparent)`, flexShrink: 0 }} />
            </div>
          </div>
        )}

        {/* ─── O'chirish tasdiqlash modali ─── */}
        {confirmDelete && (
          <div className="modal-overlay" style={{
            position: "fixed", inset: 0, zIndex: 200,
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: isMobile ? 16 : 24,
            background: "rgba(6,12,22,0.82)", backdropFilter: "blur(20px)",
          }} onClick={() => setConfirmDelete(null)}>
            <div className="scaleIn modal-card" onClick={e => e.stopPropagation()} style={{
              width: "100%",
              maxWidth: isMobile ? 340 : 380,
              background: C.CARD, border: `1px solid ${C.BORDER}`,
              borderRadius: 20,
              overflow: "hidden",
              boxShadow: `0 24px 60px rgba(0,0,0,0.6)`,
            }}>
              <div style={{ height: 3, background: `linear-gradient(90deg,transparent,${C.RED},transparent)` }} />
              <div style={{ padding: "28px 24px 24px" }}>
                {/* Icon */}
                <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
                  <div style={{
                    width: 56, height: 56, borderRadius: 16,
                    background: C.REDDIM, border: `1.5px solid rgba(255,92,92,0.3)`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <Trash2 size={24} color={C.RED} />
                  </div>
                </div>
                <h3 style={{
                  fontSize: 17, fontWeight: 800, color: C.TEXT1, textAlign: "center",
                  letterSpacing: "-0.03em", marginBottom: 8
                }}>
                  {confirmDelete.id === "ALL"
                    ? "Barchasini o'chirmoqchimisiz?"
                    : "Haqiqatdan ham o'chirmoqchimisiz?"}
                </h3>
                <p style={{
                  fontSize: 12, color: C.TEXT3, textAlign: "center", lineHeight: 1.6, marginBottom: 20,
                  display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                  overflow: "hidden", textOverflow: "ellipsis"
                }}>
                  {confirmDelete.id === "ALL"
                    ? confirmDelete.text
                    : `“${confirmDelete.text}”`}
                </p>
                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={() => setConfirmDelete(null)} style={{
                    flex: 1, padding: "13px", borderRadius: 12, cursor: "pointer",
                    background: C.SURFACE, border: `1px solid ${C.BORDER}`,
                    color: C.TEXT2, fontSize: 13, fontWeight: 700, transition: "all 0.15s",
                  }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = C.CARD2; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = C.SURFACE; }}>
                    Bekor qilish
                  </button>
                  <button onClick={() => doDeleteItem(confirmDelete.id)} style={{
                    flex: 1, padding: "13px", borderRadius: 12, cursor: "pointer",
                    background: `linear-gradient(135deg,#c0392b,${C.RED})`,
                    border: `1px solid rgba(255,92,92,0.4)`,
                    color: "#fff", fontSize: 13, fontWeight: 800,
                    boxShadow: `0 4px 14px rgba(255,92,92,0.3)`,
                    transition: "all 0.15s",
                  }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)"; (e.currentTarget as HTMLElement).style.boxShadow = `0 6px 20px rgba(255,92,92,0.4)`; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = "none"; (e.currentTarget as HTMLElement).style.boxShadow = `0 4px 14px rgba(255,92,92,0.3)`; }}>
                    Ha, o'chirish
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
