import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenAI } from "@google/genai";

// ─── Key Pool ─────────────────────────────────────────────────────────────────
const rawKeys = [
  process.env.GEMINI_API_KEY_1,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  process.env.GEMINI_API_KEY_4,
  process.env.GEMINI_API_KEY_5,
  process.env.GEMINI_API_KEY_6,
  process.env.GEMINI_API_KEY_7,
  process.env.GEMINI_API_KEY_8,
  process.env.GEMINI_API_KEY,
].filter(Boolean) as string[];

const API_KEYS = [...new Set(rawKeys)];

const AI_CLIENTS: (GoogleGenAI | null)[] = API_KEYS.map((key) => {
  try {
    return new GoogleGenAI({ apiKey: key });
  } catch { return null; }
});

const exhaustedKeys = new Set<number>();

function markKeyExhausted(index: number): void {
  exhaustedKeys.add(index);
  setTimeout(() => exhaustedKeys.delete(index), 60 * 60 * 1000);
}

function isQuotaError(error: any): boolean {
  const msg = String(error?.message || error || "").toLowerCase();
  return msg.includes("quota") || msg.includes("resource_exhausted") ||
    msg.includes("rate limit") || msg.includes("too many requests") ||
    msg.includes("429") || error?.status === 429 || error?.code === 429;
}

async function callWithKeyRotation<T>(fn: (client: GoogleGenAI) => Promise<T>): Promise<T> {
  for (let i = 0; i < AI_CLIENTS.length; i++) {
    if (exhaustedKeys.has(i) || !AI_CLIENTS[i]) continue;
    try {
      return await fn(AI_CLIENTS[i]!);
    } catch (error: any) {
      if (isQuotaError(error)) { markKeyExhausted(i); continue; }
      throw error;
    }
  }
  throw new Error("ALL_KEYS_EXHAUSTED");
}

function hasAvailableClients(): boolean {
  return AI_CLIENTS.some((c, i) => c !== null && !exhaustedKeys.has(i));
}

// ─── Voice Map ────────────────────────────────────────────────────────────────
const VOICE_MAP: Record<string, string> = {
  Shaxnoza: "Zephyr", Nigora: "Kore", Umar: "Puck", Mustafo: "Charon", Ali: "Fenrir",
};

// ─── Dialect Prompts ──────────────────────────────────────────────────────────
async function translateToDialect(text: string, dialect: string, aiClient: GoogleGenAI): Promise<string> {
  if (!dialect || dialect === "standard") return text;

  const dialectPrompts: Record<string, string> = {
    toshkent: `Matnni Toshkent shahri shevasida yozing.

UMUMIY XUSUSIYAT:
Adabiy tilga eng yaqin sheva, lekin shahar xalqona ohangi va tez-tez
qisqargan shakllar bilan ajralib turadi.

FONETIK/MORFOLOGIK QOIDALAR:
- "-lar/-ler" → "-la/-le": "bolalar" → "bolala", "kelishlar" → "kelishle"
- "-gan" → "-gen/-gan" (kontekstga qarab), lekin ba'zan "-vor" ishlatiladi
- "ketyapman" → "ketvotman", "borayotgan" → "borvotgan"
- "-yor" → "-vot": "nima qilyapsiz?" → "nima qilvotiz?"
- "juda" → "judayam" yoki "zo'r" (kontekstga qarab)
- "yo'q" → "yo'g'e"
- "bu" → "bu", "shu" → "shu", "u" → "o"
- hurmat shakli: "-siz" saqlanadi

LEKSIKA VA IBORALAR:
- "bor" → "bo", "bormi?" → "bomi?"
- "kerak" → "kerak-da" (ta'kidlash uchun)
- "biroz" → "bir oz", "ozgina" → "ozginayu"

Nutq ravon, samimiy, zamonaviy va biroz shoshqaloq ohangda bo'lsin.
Faqat 2-3 ta so'zga cheklanib qolmang, qoidalarni matn davomida izchil qo'llang.`,

    andijon: `Matnni Andijon viloyati shevasida yozing.

UMUMIY XUSUSIYAT:
Farg'ona vodiysi qarluq lahjasiga kiradi. Nihoyatda muloyim, iliq va
hurmatga boy biroz qo'pol nutq uslubi bilan ajralib turadi.

FONETIK/MORFOLOGIK QOIDALAR:
- "-gan" → "-gan/-kan" saqlanadi, lekin unlilar cho'ziladi
- "pman" → so'z agar "man" qo'shimchasidan olsin "p" harfi bo'lgan hamma so'zga "yappan" ishlatiladi. "Boryapman" -> "boryappan"
- "yappan" -> so'z "moqdaman" qo'shimchasi bo'lsa "yappan"ga o'zgartir. "Bormoqdaman" -> "Boryappan"
- "yapti" -> so'z "moqda" yoki "nadi" qo'shimchasi bo'lsa "yapti" ga o'zgartir. "Bormoqda" -> "Boryapti"
- "yapti" -> so'z "nadi" bilan tugasa ham "yapti" ga o'zgartir. "hisoblanadi" -> "hisoblanyapti"
- "miman" -> "bormayman" -> "bormiman", "qilmayman" -> "qimiman"
- "sizmi" - "yuribsizmi" -> "yuribsimi", "qilyapsizmi" -> "qilyapsimi"
- "bo'pti" — "bo'ldi", "mayli" o'rnida doim "bo'pti"
- kichraytirish-erkalash qo'shimchasi "-jon" deyarli har so'zga qo'shiladi
- "ha" o'rniga "ha-da"
- "juda" → "vapshe"
- "ozgina" → "picha"
- "yo'q" → "yo'g'ee"
- "ko'p" → "ancha"
- "nadi" so'zi umuman bo'lmasin uni "yapti" ga almashtir

LEKSIKA VA IBORALAR:
- akam, opajon, ukam, brat — murojaatlar
- davay, bo'pti, bo'ldi-da — rozilik
- joniz sog' bo'lsin — rahmat o'rnida

Nutq iliq, hurmatga to'la va shirinsuxan bo'lsin.`,

    samarqand: `Matnni Samarqand shevasida yozing.

UMUMIY XUSUSIYAT:
Samarqand shevasi tojik tili ta'sirida shakllanib, o'ziga xos ohangga ega.

FONETIK/MORFOLOGIK QOIDALAR:
- "a" unli cho'zilishi: "bola" → "bo'la", "qara" → "qora"
- "men" → "man", "sen" → "san"
- "-dik" → "-tik": "ko'rdik" → "ko'rtik"
- "ketyapman" → "ketayotirman"
- "-mi?" → "-a?": "bormi?" → "bora?"
- "buni" → "buna", "shuni" → "shuna"

LEKSIKA:
- "qanday" → "qanaqa"
- "juda" → "judayam"
- "katta" → "kattakon"

Samarqand ohangi — ohista, salmoqli, tojikona ta'sir sezilsin.`,

    xorazm: `Matnni Xorazm viloyati shevasida yozing.

UMUMIY XUSUSIYAT:
O'g'uz lahjasiga kiradi. Turkman tiliga yaqin ohang bilan ajralib turadi.

FONETIK/MORFOLOGIK QOIDALAR:
- "men" → "men" (saqlanadi), lekin "sen" → "sin"
- "-lar" → "-ler/-lar" (unli uyg'unligiga rioya)
- "-ga" → "-ge/-ga": "uyga" → "uyge"
- "ketyapman" → "ketip baratirman"
- "qilmoqdaman" → "qilip otiripman"
- "yo'q" → "yoq"
- "-mi?" → "-mi/-mu" (unli muvofiq)
- "bor" → "bar"
- "ko'p" → "kop"

LEKSIKA:
- "yaxshi" → "yagshi"
- "kerak" → "gerek"
- "qanday" → "nagay"
- "nima" → "name"

Xorazm nutqi — vazmin, bosiq, o'g'uz ohangida bo'lsin.`,

    buxoro: `Matnni Buxoro shevasida yozing.

UMUMIY XUSUSIYAT:
Buxoro shevasi forsiy-tojikiy ta'sir ostida shakllanib, ohangdor nutqqa ega.

FONETIK/MORFOLOGIK QOIDALAR:
- Unlilar cho'ziladi va ohang tojikona
- "a" → ba'zan "o" ga yaqinlashadi
- "men" → "man", "sen" → "san"
- "-dik" → "-tik"
- "ketyapman" → "ketayotirman"
- "nima" → "namma"
- "buni" → "buna"

LEKSIKA:
- "yaxshi" → "yahshi"
- "rahmat" → "tashaqqur"
- "qanday" → "qanaqa"
- "keling" → "keling-e"

Buxoro nutqi — muloyim, ohangdor, forsiy ta'sir sezilsin.`,

    qashqadaryo: `Matnni Qashqadaryo shevasida yozing.

UMUMIY XUSUSIYAT:
Janubiy sheva — qo'pol, kuchli va samimiy ohang bilan ajralib turadi.

FONETIK/MORFOLOGIK QOIDALAR:
- "men" → "man", "sen" → "san"
- "ketyapman" → "ketyapman" (saqlanadi)
- "nima" → "nama"
- "yo'q" → "yo'q" saqlanadi, lekin "bo'ldi" → "bo'di"
- "-gan" → "-gon"

LEKSIKA:
- "yaxshi" → "yahshi"
- "juda" → "judayam"
- "qanday" → "qandoq"

Qashqadaryo nutqi — samimiy, kuchli, janub ohangida bo'lsin.`,

    fargona: `Matnni Farg'ona viloyati shevasida yozing.

UMUMIY XUSUSIYAT:
Andijon shevasiga yaqin, lekin biroz yumshoqroq va nazokat bilan ajralib turadi.

FONETIK/MORFOLOGIK QOIDALAR:
- Andijon shevasidagi ko'p qoidalar amal qiladi
- "-yappan" ishlatiladi lekin biroz yumshoqroq
- "bo'pti" — rozillik
- "-jon" qo'shimchasi tez-tez ishlatiladi
- "ha-da" — tasdiqlash

LEKSIKA:
- Andijonchaga yaqin lekin biroz adabiyroq

Farg'ona nutqi — nazokat, iliqlik va samimiyat bilan bo'lsin.`,
  };

  const prompt = dialectPrompts[dialect];
  if (!prompt) return text;

  try {
    const response = await aiClient.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `${prompt}\n\nQuyidagi matnni shu shevada qayta yozing, FAQAT sheva matnini qaytaring:\n${text}`,
      config: { temperature: 0.3 },
    });
    const result = response.text?.trim();
    if (result && result.length > 5) return result;
    return text;
  } catch {
    return text;
  }
}

// ─── Style + Dialect Prompt Builder ───────────────────────────────────────────
function getPromptForStyleAndDialect(style: string, dialect: string, text: string): string {
  const styleMap: Record<string, string> = {
    natural: "Tabiiy, kundalik suhbat ohangida o'qi.",
    news: "Professional axborot boshlovchisi uslubida, rasmiy va aniq o'qi.",
    story: "Ertak aytuvchi uslubida, ifodali va hayajonli o'qi.",
    emotional: "Hissiyotli, dramatik va ta'sirli ohangda o'qi.",
    funny: "Hazilkash, quvnoq va kulgili ohangda o'qi.",
  };
  const styleInstruction = styleMap[style] || styleMap.natural;
  const dialectInstruction = dialect && dialect !== "standard"
    ? `Matnni ${dialect} shevasida talaffuz qil`
    : "Matnni adabiy o'zbek tilida o'qi";
  return `${styleInstruction} ${dialectInstruction}: ${text}`;
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
    const { text, voiceName, style, speed, dialect } = req.body;

    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Matn kiritish majburiy." });
    }
    if (text.length > 1200) {
      return res.status(400).json({ error: "Matn uzunligi 1200 belgidan oshmasligi kerak." });
    }
    if (!hasAvailableClients()) {
      return res.status(503).json({ error: "Tizim hozirda band. Iltimos, biroz kutib qayta urinib ko'ring." });
    }

    const resolvedVoice = VOICE_MAP[voiceName] || "Zephyr";
    const resolvedSpeed = typeof speed === "number" ? Math.max(0.5, Math.min(2.0, speed)) : 1.0;

    // Dialektga tarjima
    let processedText = text;
    let synthesizedText: string | null = null;
    if (dialect && dialect !== "standard") {
      const translatedText = await callWithKeyRotation(async (client) => {
        return translateToDialect(text, dialect, client);
      });
      if (translatedText !== text) {
        processedText = translatedText;
        synthesizedText = translatedText;
      }
    }

    const prompt = getPromptForStyleAndDialect(style, dialect, processedText);

    const audioResult = await callWithKeyRotation(async (client) => {
      const response = await client.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: resolvedVoice } },
          },
        } as any,
      });

      const data = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
      if (!data?.data) throw new Error("Audio ma'lumot qaytarilmadi.");
      return data.data;
    });

    return res.status(200).json({
      success: true,
      audioBase64: audioResult,
      mimeType: "audio/L16;rate=24000",
      synthesizedText,
    });
  } catch (error: any) {
    if (error.message === "ALL_KEYS_EXHAUSTED") {
      return res.status(503).json({ error: "Barcha limitlar sarflab bo'lindi. 1 soatdan keyin qayta urining." });
    }
    console.error("TTS API xatoligi:", error);
    return res.status(500).json({ error: error.message || "Sintez jarayonida xatolik yuz berdi." });
  }
}
