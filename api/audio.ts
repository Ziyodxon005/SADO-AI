import type { VercelRequest, VercelResponse } from "@vercel/node";

// ═══════════════════════════════════════════════════════════════════════════════
// SADO AI — Audio Download Endpoint
// ═══════════════════════════════════════════════════════════════════════════════
// Vaqtincha saqlangan audio fayllarni yuklab olish uchun endpoint.
// MCP orqali yaratilgan audio fayllarni foydalanuvchiga link sifatida berish
// imkonini yaratadi.
//
// GET /api/audio?id=<audio_id>  — Audio faylni WAV formatda yuklab olish
// POST /api/audio               — Audio faylni saqlash va ID qaytarish
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Vaqtincha Audio Xotira ──────────────────────────────────────────────────
// Vercel serverless function'larda global o'zgaruvchilar bir nechta so'rovlar
// davomida saqlanishi mumkin (lekin kafolatlanmagan). Shuning uchun bu "best effort"
// cache hisoblanadi.

interface AudioEntry {
  data: Buffer;
  createdAt: number;
  metadata?: {
    text?: string;
    voiceName?: string;
    dialect?: string;
    style?: string;
  };
}

// Global audio cache — 10 daqiqa TTL
const audioCache = new Map<string, AudioEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 daqiqa
const MAX_CACHE_SIZE = 100; // Maksimal 100 ta audio

/**
 * Eskirgan audio fayllarni tozalash
 */
function cleanupExpiredEntries(): void {
  const now = Date.now();
  for (const [id, entry] of audioCache.entries()) {
    if (now - entry.createdAt > CACHE_TTL_MS) {
      audioCache.delete(id);
    }
  }
}

/**
 * Oddiy unique ID yaratish (crypto kerak emas)
 */
function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${random}`;
}

/**
 * Audio faylni cache'ga saqlash
 */
export function storeAudio(
  base64Data: string,
  metadata?: AudioEntry["metadata"]
): string {
  // Avval eskirganlarni tozalash
  cleanupExpiredEntries();

  // Cache to'lib ketganmi tekshirish
  if (audioCache.size >= MAX_CACHE_SIZE) {
    // Eng eskisini o'chirish
    const oldestKey = audioCache.keys().next().value;
    if (oldestKey) audioCache.delete(oldestKey);
  }

  const id = generateId();
  const buffer = Buffer.from(base64Data, "base64");

  audioCache.set(id, {
    data: buffer,
    createdAt: Date.now(),
    metadata,
  });

  return id;
}

/**
 * Cache'dan audio olish
 */
export function getAudio(id: string): AudioEntry | null {
  cleanupExpiredEntries();
  return audioCache.get(id) || null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Vercel Serverless Function Handler
// ═══════════════════════════════════════════════════════════════════════════════

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  // ── POST — Audio saqlash ──────────────────────────────────────────────────
  if (req.method === "POST") {
    const { audioBase64, metadata } = req.body || {};

    if (!audioBase64 || typeof audioBase64 !== "string") {
      return res
        .status(400)
        .json({ error: "audioBase64 maydoni majburiy." });
    }

    const id = storeAudio(audioBase64, metadata);

    // URL ni yaratish
    const proto = (req.headers["x-forwarded-proto"] as string) || "https";
    const host =
      (req.headers["x-forwarded-host"] as string) ||
      (req.headers["host"] as string) ||
      "localhost:3000";
    const downloadUrl = `${proto}://${host}/api/audio?id=${id}`;

    return res.status(200).json({
      success: true,
      id,
      downloadUrl,
      expiresIn: "10 daqiqa",
    });
  }

  // ── GET — Audio yuklab olish ──────────────────────────────────────────────
  if (req.method === "GET") {
    const id = req.query.id as string;

    if (!id) {
      return res.status(400).json({
        error: "Audio ID kerak. Foydalanish: /api/audio?id=<audio_id>",
      });
    }

    const entry = getAudio(id);

    if (!entry) {
      return res.status(404).json({
        error:
          "Audio topilmadi yoki muddati tugagan. Audio fayllar 10 daqiqa davomida saqlanadi.",
      });
    }

    // WAV faylni to'g'ridan-to'g'ri qaytarish
    res.setHeader("Content-Type", "audio/wav");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="sado-ai-audio-${id}.wav"`
    );
    res.setHeader("Content-Length", entry.data.length.toString());
    res.setHeader("Cache-Control", "no-store");

    return res.status(200).send(entry.data);
  }

  return res.status(405).json({ error: "Method not allowed" });
}
