import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenAI } from "@google/genai";

// ─── Key Pool (shared logic) ──────────────────────────────────────────────────
const rawKeys = [
  process.env.GEMINI_API_KEY_1, process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3, process.env.GEMINI_API_KEY_4,
  process.env.GEMINI_API_KEY_5, process.env.GEMINI_API_KEY_6,
  process.env.GEMINI_API_KEY_7, process.env.GEMINI_API_KEY_8,
  process.env.GEMINI_API_KEY,
].filter(Boolean) as string[];

const API_KEYS = [...new Set(rawKeys)];
const AI_CLIENTS: (GoogleGenAI | null)[] = API_KEYS.map((key) => {
  try { return new GoogleGenAI({ apiKey: key }); } catch { return null; }
});
const exhaustedKeys = new Set<number>();

function markKeyExhausted(i: number) {
  exhaustedKeys.add(i);
  setTimeout(() => exhaustedKeys.delete(i), 60 * 60 * 1000);
}
function isQuotaError(e: any): boolean {
  const m = String(e?.message || e || "").toLowerCase();
  return m.includes("quota") || m.includes("resource_exhausted") ||
    m.includes("rate limit") || m.includes("429") || e?.status === 429;
}
async function callWithKeyRotation<T>(fn: (c: GoogleGenAI) => Promise<T>): Promise<T> {
  for (let i = 0; i < AI_CLIENTS.length; i++) {
    if (exhaustedKeys.has(i) || !AI_CLIENTS[i]) continue;
    try { return await fn(AI_CLIENTS[i]!); }
    catch (e: any) { if (isQuotaError(e)) { markKeyExhausted(i); continue; } throw e; }
  }
  throw new Error("ALL_KEYS_EXHAUSTED");
}
function hasAvailableClients(): boolean {
  return AI_CLIENTS.some((c, i) => c !== null && !exhaustedKeys.has(i));
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { text } = req.body;
    if (!text || typeof text !== "string") return res.status(400).json({ error: "Matn kiritish majburiy." });
    if (text.length > 1200) return res.status(400).json({ error: "Matn 1200 belgidan oshmasligi kerak." });
    if (!hasAvailableClients()) return res.status(503).json({ error: "Tizim band. Biroz kutib qayta urining." });

    const systemInstruction =
      "Siz O'zbek tili bo'yicha mukammal imlo va grammatika mutaxassisiz. " +
      "Sizga taqdim etilgan o'zbekcha matnni tekshiring, imlo xatolarini to'g'rilang, tinish belgilarini joyiga qo'ying va grammatik qo'shimchalarni muvofiqlashtiring. " +
      "Ayniqsa 'o' va 'g' harflari uchun to'g'ri o'zbekcha tutuq belgilarini (misol uchun: o' va g' yoki oʻ va gʻ) to'g'ri formatsiyada qo'llang. " +
      "FAQAT tuzatilgan va mukammallashtirilgan o'zbekcha matnni qaytaring. Hech qanday qo'shimcha tushuntirish, izoh, so'zboshi yoki gap yozmang. Faqat va faqat yakuniy matn bo'lsin.";

    const enhancedText = await callWithKeyRotation(async (client) => {
      const response = await client.models.generateContent({
        model: "gemini-2.5-flash",
        contents: text,
        config: { systemInstruction, temperature: 0.1 },
      });
      return response.text?.trim() || text;
    });

    return res.status(200).json({ success: true, enhancedText });
  } catch (error: any) {
    if (error.message === "ALL_KEYS_EXHAUSTED") {
      return res.status(503).json({ error: "Barcha limitlar sarflab bo'lindi. 1 soatdan keyin qayta urining." });
    }
    console.error("Enhance xatoligi:", error);
    return res.status(500).json({ error: error.message || "Matnni tahrirlashda xatolik yuz berdi." });
  }
}
