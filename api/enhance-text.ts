import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenAI } from "@google/genai";

// ─── Multi-Key Pool ───────────────────────────────────────────────────────────
// GEMINI_API_KEY_1 ... GEMINI_API_KEY_8 kalitlarini qo'llab-quvvatlaydi.
// Eski GEMINI_API_KEY ham ishlaydi (backward compatibility).

const rawKeys = [
  process.env.GEMINI_API_KEY_1,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  process.env.GEMINI_API_KEY_4,
  process.env.GEMINI_API_KEY_5,
  process.env.GEMINI_API_KEY_6,
  process.env.GEMINI_API_KEY_7,
  process.env.GEMINI_API_KEY_8,
  process.env.GEMINI_API_KEY, // eski format qo'llab-quvvatlash
].filter(Boolean) as string[];

// Dublikatlarni olib tashlash
const API_KEYS = [...new Set(rawKeys)];

// Har bir kalit uchun GoogleGenAI client yaratish
const AI_CLIENTS: (GoogleGenAI | null)[] = API_KEYS.map((key, idx) => {
  try {
    const client = new GoogleGenAI({
      apiKey: key,
      httpOptions: { headers: { "User-Agent": "aistudio-build" } },
    });
    console.log(`[KeyPool] Kalit ${idx + 1} muvaffaqiyatli ulandi.`);
    return client;
  } catch (error) {
    console.error(`[KeyPool] Kalit ${idx + 1} ulanishda xatolik:`, error);
    return null;
  }
});

// Limitga yetgan kalitlarni kuzatish (1 soatdan keyin avtomatik qayta faollanadi)
const exhaustedKeys = new Set<number>();

function markKeyExhausted(index: number): void {
  exhaustedKeys.add(index);
  console.warn(
    `[KeyPool] Kalit ${index + 1} limitiga yetdi. 1 soatdan keyin qayta faollanadi.`
  );
  // 1 soatdan keyin avtomatik qayta faollashtirish
  setTimeout(() => {
    exhaustedKeys.delete(index);
    console.log(`[KeyPool] Kalit ${index + 1} qayta faollashtirildi.`);
  }, 60 * 60 * 1000);
}

// Xatolik quota bilan bog'liqmi tekshirish
function isQuotaError(error: any): boolean {
  const msg = String(error?.message || error || "").toLowerCase();
  return (
    msg.includes("quota") ||
    msg.includes("resource_exhausted") ||
    msg.includes("rate limit") ||
    msg.includes("too many requests") ||
    msg.includes("429") ||
    error?.status === 429 ||
    error?.code === 429
  );
}

// Bir kalit limitga yetsa avtomatik keyingisiga o'tadi
async function callWithKeyRotation<T>(
  fn: (client: GoogleGenAI) => Promise<T>
): Promise<T> {
  for (let i = 0; i < AI_CLIENTS.length; i++) {
    if (exhaustedKeys.has(i) || !AI_CLIENTS[i]) continue;

    try {
      return await fn(AI_CLIENTS[i]!);
    } catch (error: any) {
      if (isQuotaError(error)) {
        markKeyExhausted(i);
        const remaining = AI_CLIENTS.filter((c, idx) => c && !exhaustedKeys.has(idx)).length;
        if (remaining > 0) {
          console.warn(`[KeyPool] Kalit ${i + 1} dan keyingisiga o'tilmoqda... (${remaining} ta qoldi)`);
        }
        continue;
      }
      throw error;
    }
  }

  // Barcha kalitlar limitga yetgan
  throw new Error("ALL_KEYS_EXHAUSTED");
}

function hasAvailableClients(): boolean {
  return AI_CLIENTS.some((c, i) => c !== null && !exhaustedKeys.has(i));
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { text } = req.body;

    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Matn kiritish majburiy." });
    }

    if (text.length > 500) {
      return res.status(400).json({ error: "Matn uzunligi 500 belgidan oshmasligi kerak." });
    }

    if (!hasAvailableClients()) {
      return res.status(503).json({
        error: "Tizim hozirda band. Yuklanma keragidan ortiq — iltimos, biroz kutib qayta urinib ko'ring.",
      });
    }

    console.log(`Imlo tahriri so'rovi: ${text.substring(0, 50)}...`);

    const systemInstruction =
      "Siz O'zbek tili bo'yicha mukammal imlo va grammatika mutaxassisiz." +
      "Sizga taqdim etilgan o'zbekcha matnni tekshiring, imlo xatolarini to'g'rilang, tinish belgilarini joyiga qo'ying va grammatik qo'shimchalarni muvofiqlashtiring. " +
      "Ayniqsa 'o' va 'g' harflari uchun to'g'ri o'zbekcha tutuq belgilarini (misol uchun: o' va g' yoki oʻ va gʻ) to'g'ri formatsiyada qo'llang. " +
      "FAQAT tuzatilgan va mukammallashtirilgan o'zbekcha matnni qaytaring. Hech qanday qo'shimcha tushuntirish, izoh, so'zboshi yoki gap yozmang. Faqat va faqat yakuniy matn bo'lsin.";

    const enhancedText = await callWithKeyRotation(async (client) => {
      const response = await client.models.generateContent({
        model: "gemini-2.5-flash",
        contents: text,
        config: {
          systemInstruction,
          temperature: 0.1,
        },
      });
      return response.text?.trim() || text;
    });

    return res.status(200).json({ success: true, enhancedText });
  } catch (error: any) {
    if (error.message === "ALL_KEYS_EXHAUSTED") {
      console.warn("[KeyPool] Barcha API kalitlar limitiga yetdi.");
      return res.status(503).json({
        error: "Uzr! bizda barcha limitlar sarflab bo'lindi. 24 soatdan keyin qayta urining.",
      });
    }
    console.error("Enhance Text API xatoligi:", error);
    return res.status(500).json({
      error: error.message || "Matnni tahrirlashda ichki xatolik yuz berdi.",
    });
  }
}
