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
    toshkent:
      `Matnni Toshkent shahri shevasida yozing.
 
UMUMIY XUSUSIYAT:
Adabiy tilga eng yaqin sheva, lekin shahar xalqona ohangi va tez-tez
qisqargan shakllar bilan ajralib turadi. "Iolash" (o'zlashgan lahja)
guruhiga kiradi.
 
FONETIK/MORFOLOGIK QOIDALAR:
- "aka, uka" → "oka"
- "-yapti", "nadi" → "-yotti" yoki "-votti" (ba'zan): ketyapti → ketvotti, "boshlanadi" -> "boshlanvotti"
- "men" → "man", "sen" → "san" (so'zlashuvda)
- "bo'ldi" → "bo'ldi"
- "-moqchi" ko'pincha qisqaradi: bormoqchiman → bormoqchiman (o'zgarmaydi, lekin tez talaffuz qilinadi)
- sonlar ham ba'zan qisqaradi: "o'n ikki","12" -> "o'nakki", "to'rt","4" -> "to'r"
- so'z oxiridagi "-di" ko'pincha "-votti" ga o'tadi tez nutqda 
- so'z oxirida "-daman", "yapman" ko'pincha "vomman" ga o'tada tez nuqtda, "bormoqdaman" -> "borvomman"
- so'z "yapman" bo'lsa "vomman" ga o'zgartir. "qilyapman" -> "qivomman", "ishlayapti" -> "ishlavomman"

LEKSIKA VA IBORALAR:
- oka, uka — murojaat so'zlari, deyarli har gapda
- "voy" — hayrat, e'tiroz
- "xo'p" — rozilik
- "netay" — nima qilay
- "shunaqa" — shunday
 
NAMUNALAR:
Adabiy: "Sen nima qilyapsan hozir?"
Toshkentcha: "San hozir nima qivossan?"
 
Adabiy: "U keldi va ketdi."
Toshkentcha: "U keldi-yu ketvotti."
 
Adabiy: "Bugun ishga bormoqchiman."
Toshkentcha: "Bugun ishga bormochiman, oka."
 
Nutq ravon, samimiy, zamonaviy va biroz shoshqaloq ohangda bo'lsin.
Faqat 2-3 ta so'zga cheklanib qolmang, qoidalarni matn davomida izchil qo'llang.`,

    andijon:
      `Matnni Andijon viloyati shevasida yozing.
 
UMUMIY XUSUSIYAT:
Farg'ona vodiysi qarluq lahjasiga kiradi. Nihoyatda muloyim, iliq va
hurmatga boy biroz qo'pol nutq uslubi bilan ajralib turadi.
 
FONETIK/MORFOLOGIK QOIDALAR:
- "-gan" → "-gan/-kan" saqlanadi, lekin unlilar cho'ziladi (vodiyga xos) ba'zan ma'noga ta'sir qilmasa "yappan" misol uchun "qilyapman" -> "qilyappan"
-  "pman" → so'z agar "man" qo'shimchasidan olsin "p" harfi bo'lgan hamma so'zga "yappan" ishlatiladi. "Boryapman" -> "boryappan"
-  "yappan" -> so'z "moqdaman" qo'shimchasi bo'lsa "yappan"ga o'zgartir. "Bormoqdaman" -> "Boryappan"
- "yapti" -> so'z "moqda" yoki "nadi" qo'shimchasi bo'lsa "yapti" ga o'zgartir. "Bormoqda" -> "Boryapti", "qilinadi" -> "qilinyapti"
- "yapti" -> so'z "nadi" bilan tugasa ham "yapti" ga o'zgartir. "hisoblanadi" -> "hisoblanyapti"
-  "miman" -> so'z agar "man" qo'shimchasi oldida "y" harfi bo'lgan hamma so'zga "miman" ishlatiladi. "bormayman" -> "bormiman", "qilmayman" -> "qimiman", "yurmayman" -> "yurmiman".
- "sizmi" - agar "mi" qo'shimchasi oldidan "z" bo'lsa "z" harfi tushib qoladi "simi", "yuribsizmi" -> "yuribsimi", "qilyapsizmi" -> "qilyapsimi", "boryapsizmi" -> "boryapsimi"
- "bo'pti" — "bo'ldi", "mayli"  o'rnida doim bo'ldi o'rnida "bo'pti" ishlatilsin
- kichraytirish-erkalash qo'shimchasi "-jon" deyarli har so'zga qo'shiladi
- "ha" o'rniga "ha-da" tasdiq sifatida ishlatiladi
- "aka" o'rnida ba'zan "brat"
- "juda" → "vapshe"
- "ozgina" → "picha"
- "yo'q" → "yo'g'ee"
- "u yoq", "u yer", joymanosida ba'zan → "ashaq", "mashaq", misol uchun "o'sha yerdan bu yerga" → "ashaqdan mashaqa"
- "rahmat" →  ma'noga qarab hurmat ifodasi o'rnida "joniz sog' bo'lsin"  ba'zan ko'pincha shunchaki "rahmat"
- "ho'p" → ma'noaga qarab rozilik ifodasi o'rnida "davay" ba'zan shunchaki "bo'ldi"
- "ko'p" → "ancha" 
- "nadi" so'zi umuman bo'lmasin uni "yapti" ga almashtir
 
LEKSIKA VA IBORALAR:
- akam, opajon, ukam, brat — murojaatlar
- bopti — bo'ldi, mayli
- vay-bo' — hayrat ifodasi
- vapshe — rosa, ancha (rosa yaxshi — juda yaxshi)
- joniz sog' bo'sin — rahmat, hurmat ifodasi
- davay — ho'p, rozilik ifodasi
- bo'ldida — ba'zan rozilik ifodasi
- ancha — ko'p, ko'plik ifodasi
- juda kop o'rniga "vapshe" kabi mahalliy kuchaytiruvchilar
 
NAMUNALAR:
Adabiy: "Juda yaxshi ish qilibsan, rahmat."
Andijoncha: "Voy-boo', vapshe yaxshi qipsan, rahmat sizga brat."
 
Adabiy: "Xo'p, keling, boramiz."
Andijoncha: "Davay, bopti, yuring boreli opajon."

so'zlar ba'zan qisqarada ma'noni yo'qotmasdan
Adabiy: "bo'ldi", "kelibdi", "qilibsan"
Andijoncha: "bo'pti", "kepti", "qipsan"

Adabiy: "ko'pdan beri", "ko'p", "ko'p qildim"
Andijoncha: "anchadan beri", "ancha", "ancha qildim"

Adabiy: "hisoblanadi", "yig'ilmoqda", "borilmoqda", "qilinadi", "qilinmoqda"
Andijoncha: "hisoblanyapti", "yig'ilyapti", "borilyapti", "qilinyapti", "qilinyapti"
 
Nutq iliq, hurmatga to'la va shirinsuxan bo'lsin — go'yo suhbatdosh bilan
mehr bilan gaplashayotgandek.`,

    fargona:
      "Matnni Farg'ona viloyati shevasida yozing. Vodiy xalqiga xos yumshoq, muloyim va hurmatli ohangni saqlang. Tabiiy farg'onacha talaffuz va iboralardan foydalaning. Nutq ravon, samimiy va yoqimli eshitilsin. so'zlarda 'sen', 'men' so'zlari o'rniga 'man', 'san' ishlatilsin",

    namangan:
      `Matnni Namangan viloyati shevasida yozing.
 
UMUMIY XUSUSIYAT:
Vodiyning shimoliy sheva vakili, o'ziga xos tez va ritmik talaffuzi bilan
ajralib turadi, ba'zan qipchoq lahjasi unsurlari ham uchraydi.
 
FONETIK/MORFOLOGIK QOIDALAR:
- "-yapti" → "-oti"/"-vati": borayapti → borvati
- so'z oxiridagi unlilar ba'zan tushib qoladi tez nutqda
- "-mi" so'roq qo'shimchasi kuchli urg'u bilan aytiladi
 
LEKSIKA VA IBORALAR:
- "ie", "a-e" — undovlar
- akaxon, ukaxon — Andijondagiga o'xshash, lekin "-xon" varianti bilan
- "netvotisan" — nima qilyapsan
- juda — "battar" so'zi kuchaytiruvchi sifatida ham ishlatiladi
 
NAMUNALAR:
Adabiy: "Sen nima qilyapsan?"
Namangancha: "Sen netvotisan hozi?"
 
Adabiy: "Juda charchadim bugun."
Namangancha: "Battar charchadim-a bugun."
 
Matn samimiy, muloyim, lekin vodiyga xos tez va ohangdor ritmda bo'lsin.`,

    samarqand:
      "Matnni Samarqand viloyati shevasida yozing. Samarqand nutqiga xos qadimiy uslub va tojik tili ta'siri sezilib tursin. 'Maniyam', 'kelganmi', 'boraftasiz', 'rafta', 'gap yo'q' kabi va boshqa tabiiy sheva elementlaridan o'rinli foydalaning. Nutq mayin va madaniyatli bo'lsin.",

    buxoro:
      "Matnni Buxoro viloyati shevasida yozing. Buxoroga xos qadimiy, nafis va fors-tojik ta'siri seziladigan xalqona uslubni saqlang. Misol uchun 'nima' -> 'chi gap'. So'zlashuv tabiiy, sokin, muloyim va o'ziga xos buxorona ohangda bo'lsin.",

    xorazm:
      "Matnni Xorazm viloyati shevasida yozing. O'g'uz lahjasining o'ziga xos talaffuzi va grammatik shakllaridan foydalaning. 'Galing', 'giding', 'na qilipsan', 'shul', 'kelipsan', 'yotibdi','na qilipsan' kabi va boshqa xorazmcha iboralar tabiiy qo'llansin. Nutq sof xorazmcha eshitilsin.",

    qashqadaryo:
      "Matnni Qashqadaryo viloyati shevasida yozing. Qipchoq lahjasiga xos fe'l shakllari va talaffuzni saqlang. 'Atibdi', 'baratirmiz', 'kemasiz' kabi va boshqa tabiiy sheva birliklaridan o'rinli foydalaning. Nutq sodda, qat'iy va xalqona bo'lsin.",

    surxondaryo:
      "Matnni Surxondaryo viloyati shevasida yozing. Janubiy hududlarga xos tabiiy talaffuz, xalqona iboralar va o'ziga xos ohangni aks ettiring.  'nimala', 'qayoqqa' kabi va boshqa tabiiy sheva birliklaridan o'rinli foydalaning.Nutq samimiy, dadil va tabiiy surxondaryocha bo'lsin.",

    jizzax:
      "Matnni Jizzax viloyati shevasida yozing. Markaziy hududlarga xos xalqona talaffuz va qipchoq unsurlari uyg'unligini saqlang. Nutq sodda, ravon, samimiy va tabiiy jizzaxcha ohangda bo'lsin.",

    sirdaryo:
      "Matnni Sirdaryo viloyati shevasida yozing. Toshkent va Jizzax shevalari orasidagi tabiiy o'tishlarni aks ettiring. Nutq sodda, xalqona, samimiy va kundalik so'zlashuv uslubida bo'lsin.",

    navoiy:
      "Matnni Navoiy viloyati shevasida yozing. Markaziy-g'arbiy hududlarga xos talaffuz, Buxoro va Samarqand shevalari ta'siri hamda cho'l hududlariga xos xalqona ohangni saqlang. Nutq ravon, tabiiy va samimiy bo'lsin."
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
