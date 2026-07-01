import express from "express";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

// Load environment variables
dotenv.config();

const PORT = 3000;

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

if (API_KEYS.length === 0) {
  console.warn("DIQQAT: Hech qanday API kalit topilmadi. TTS va matn tahrirlash ishlamasligi mumkin.");
} else {
  console.log(`[KeyPool] ${API_KEYS.length} ta API kalit yuklandi.`);
}

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

// Voice mapping: Uzbek user configurations to system prebuilt voice targets
const VOICE_MAP: Record<string, string> = {
  Shaxnoza: "Zephyr",
  Nigora: "Kore",
  Umar: "Puck",
  Mustafo: "Charon",
  Ali: "Fenrir",
};

async function translateToDialect(
  text: string,
  dialect: string,
  aiClient: GoogleGenAI
): Promise<string> {
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

  const instruction = dialectPrompts[dialect.toLowerCase()];
  if (!instruction) return text;

  const promptText =
    `Siz professional o'zbek tili tarjimonisiz. Quyidagi o'zbekcha matnni ${instruction} o'girib bering.\n` +
    `ASL MATN: "${text}"\n` +
    `KO'RSATMA: Asl matnning ma'nosini 100% saqlang, hech qanday qo'shimcha so'z, tushuntirish, izoh yozmang! Faqat va faqat shevadagi tarjimani qaytaring.`;

  const modelsToTry = ["gemini-3.5-flash", "gemini-3.1-flash-lite"];

  for (const modelName of modelsToTry) {
    try {
      console.log(`Dialektga o'girish urinishi (${dialect}) - Model: ${modelName}`);
      const response = await aiClient.models.generateContent({
        model: modelName,
        contents: promptText,
        config: { temperature: 0.2 },
      });
      const translated = response.text?.trim();
      if (translated && translated.length > 0) {
        let cleaned = translated;
        if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
          cleaned = cleaned.substring(1, cleaned.length - 1);
        }
        return cleaned;
      }
    } catch (err: any) {
      // Quota xatoligi bo'lsa, key rotation uchun yuqoriga uzatamiz
      if (isQuotaError(err)) {
        throw err;
      }
      console.warn(`Translation failed for model ${modelName}:`, err);
    }
  }

  console.warn(`[Translate] OGOHLANTIRISH: "${dialect}" shevaga tarjima barcha modellarda muvaffaqiyatsiz bo'ldi. Standart matn qaytarilmoqda.`);
  return text; // fallback to original text
}

function getPromptForStyleAndDialect(text: string, style: string, dialect: string): string {
  let styleInstruction = "Say naturally";
  const normStyle = style.toLowerCase();

  if (normStyle.includes("cheerful") || normStyle.includes("xushchaqchaq")) {
    styleInstruction = "Say cheerfully, happily, and enthusiastically with bright emotion";
  } else if (normStyle.includes("calm") || normStyle.includes("sokin")) {
    styleInstruction = "Say calmly, softly, gently, and warmly with calm pacing";
  } else if (normStyle.includes("serious") || normStyle.includes("rasmiy") || normStyle.includes("jiddiy")) {
    styleInstruction = "Say seriously, formally, professionally, and clearly";
  } else if (normStyle.includes("dramatic") || normStyle.includes("hayajonli") || normStyle.includes("dramatik")) {
    styleInstruction = "Say excitingly, with high drama, passion, and intense emotion";
  }

  let dialectInstruction = "in standard Uzbek language";
  const normDialect = dialect.toLowerCase();
  if (normDialect === "toshkent") {
    dialectInstruction = "in Tashkent dialect of Uzbek language (using Tashkent accent, votti-botti tone, and melodic city cadence)";
  } else if (normDialect === "andijon") {
    dialectInstruction = "in Andijon dialect of Uzbek language (highly polite, melodic, warm Fergana valley tone and accent)";
  } else if (normDialect === "fargona") {
    dialectInstruction = "in Farg'ona dialect of Uzbek language (extremely soft, polite, classic Fergana valley tone and accent)";
  } else if (normDialect === "namangan") {
    dialectInstruction = "in Namangan dialect of Uzbek language (with characteristic Namangan pitch shifts and melodic valley accent)";
  } else if (normDialect === "samarqand") {
    dialectInstruction = "in Samarqand dialect of Uzbek language (with Samarqand city cadence, incorporating beautiful Tajik-influenced vowels)";
  } else if (normDialect === "buxoro") {
    dialectInstruction = "in Buxoro dialect of Uzbek language (with Bukhara accent, soft pacing, and elegant classical intonation)";
  } else if (normDialect === "xorazm") {
    dialectInstruction = "in Xorazm dialect of Uzbek language (with distinct Khorezmian Oghuz accent, using native g-sounds and o-vowels)";
  } else if (normDialect === "qashqadaryo") {
    dialectInstruction = "in Qashqadaryo dialect of Uzbek language (with direct, robust, and friendly southern Kipchak accent)";
  } else if (normDialect === "surxondaryo") {
    dialectInstruction = "in Surxondaryo dialect of Uzbek language (with Southern Surkhandarya robust, deep, melodic rural accent)";
  } else if (normDialect === "jizzax") {
    dialectInstruction = "in Jizzax dialect of Uzbek language (with Jizzakh regional accent and cadence)";
  } else if (normDialect === "sirdaryo") {
    dialectInstruction = "in Sirdaryo dialect of Uzbek language (with friendly, simple, conversational Syrdarya accent)";
  } else if (normDialect === "navoiy") {
    dialectInstruction = "in Navoiy dialect of Uzbek language (with Navoiy regional accent)";
  }

  return `${styleInstruction} ${dialectInstruction}: ${text}`;
}

// ─── Express App Factory ──────────────────────────────────────────────────────
export function createApp() {
  const app = express();

  app.use(express.json({ limit: "10mb" }));

  // ─── API Route: Speech Synthesis ─────────────────────────────────────────
  app.post("/api/tts", async (req: any, res: any) => {
    try {
      const { text, voiceName, style, speed, dialect } = req.body;

      if (!text || typeof text !== "string") {
        return res.status(400).json({ error: "Matn kiritish majburiy." });
      }

      if (text.length > 1200) {
        return res.status(400).json({ error: "Matn uzunligi 1200 belgidan oshmasligi kerak." });
      }

      if (!hasAvailableClients()) {
        return res.status(503).json({
          error: "Tizim hozirda band. Yuklanma keragidan ortiq — iltimos, biroz kutib qayta urinib ko'ring.",
        });
      }

      const resolvedVoice = VOICE_MAP[voiceName] || "Zephyr";

      console.log(
        `TTS so'rovi qabul qilindi: Voice: ${voiceName} (${resolvedVoice}), Style: ${style}, Dialect: ${dialect || "standard"}`
      );

      // Key rotation bilan barcha API chaqiruvlarni bajarish
      const result = await callWithKeyRotation(async (client) => {
        // Dialekt tarjimasi
        let textToSynthesize = text;
        let translatedText: string | null = null;

        if (dialect && dialect !== "standard") {
          console.log(`Dialekt bo'yicha tarjima qilinmoqda: ${dialect}`);
          textToSynthesize = await translateToDialect(text, dialect, client);
          translatedText = textToSynthesize;
          if (translatedText === text) {
            console.warn(`[TTS] OGOHLANTIRISH: Tarjima o'zgarmadi! Sheva: ${dialect}. Model tarjima qilmagan bo'lishi mumkin.`);
          } else {
            console.log(`[TTS] Dialektga muvaffaqiyatli o'girildi: ${translatedText}`);
          }
        }

        const promptWithEmotion = getPromptForStyleAndDialect(
          textToSynthesize,
          style || "natural",
          dialect || "standard"
        );

        const response = await client.models.generateContent({
          model: "gemini-3.1-flash-tts-preview",
          contents: [{ parts: [{ text: promptWithEmotion }] }],
          config: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: resolvedVoice },
              },
            },
          },
        });

        return { response, textToSynthesize, translatedText };
      });

      const audioPart = result.response.candidates?.[0]?.content?.parts?.[0];
      const base64Audio = audioPart?.inlineData?.data;

      if (!base64Audio) {
        console.error("TTS API audioga oid ma'lumot qaytarmadi:", JSON.stringify(result.response));
        return res.status(500).json({
          error: "Ovoz sintez qilishda xatolik yuz berdi. API audio ma'lumot qaytarmadi.",
        });
      }

      res.json({
        success: true,
        audioBase64: base64Audio,
        metadata: {
          text,
          synthesizedText: result.textToSynthesize,
          translatedText: result.translatedText,
          dialect: dialect || "standard",
          voiceName,
          resolvedVoice,
          style,
          speed,
          sampleRate: 24000,
          channels: 1,
          bitDepth: 16,
        },
      });
    } catch (error: any) {
      if (error.message === "ALL_KEYS_EXHAUSTED") {
        console.warn("[KeyPool] Barcha API kalitlar limitiga yetdi.");
        return res.status(503).json({
          error: "Uzr! bizda barcha limitlar sarflab bo'lindi. 24 soatdan keyin qayta urining.",
        });
      }
      console.error("TTS API xatoligi:", error);
      res.status(500).json({
        error: error.message || "Sintez jarayonida ichki xatolik yuz berdi.",
      });
    }
  });

  // ─── API Route: Intelligent Text Orthography Enhancer ─────────────────────
  app.post("/api/enhance-text", async (req, res) => {
    try {
      const { text } = req.body;

      if (!text || typeof text !== "string") {
        return res.status(400).json({ error: "Matn kiritish majburiy." });
      }

      if (text.length > 1200) {
        return res.status(400).json({ error: "Matn uzunligi 1200 belgidan oshmasligi kerak." });
      }

      if (!hasAvailableClients()) {
        return res.status(503).json({
          error: "Tizim hozirda band. Yuklanma keragidan ortiq — iltimos, biroz kutib qayta urinib ko'ring.",
        });
      }

      console.log(`Imlo tahriri so'rovi: ${text.substring(0, 50)}...`);

      const systemInstruction =
        "Siz O'zbek tili bo'yicha mukammal imlo va grammatika mutaxassisiz. " +
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

      res.json({ success: true, enhancedText });
    } catch (error: any) {
      if (error.message === "ALL_KEYS_EXHAUSTED") {
        console.warn("[KeyPool] Barcha API kalitlar limitiga yetdi.");
        return res.status(503).json({
          error: "Uzr! bizda barcha limitlar sarflab bo'lindi. 24 soatdan keyin qayta urining.",
        });
      }
      console.error("Enhance Text API xatoligi:", error);
      res.status(500).json({
        error: error.message || "Matnni tahrirlashda ichki xatolik yuz berdi.",
      });
    }
  });

  // ─── Serve static assets or mount Vite middleware ─────────────────────────
  // (faqat lokal dev uchun — Vercel da bu kerak emas)
  return app;
}

// Lokal ishga tushirish — Vite middleware + listen
async function startServer() {
  const app = createApp();

  if (process.env.NODE_ENV !== "production") {
    // Dynamic import — faqat dev da
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req: any, res: any) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`O'zbek Ovoz serveri ishga tushdi: http://localhost:${PORT}`);
    console.log(`[KeyPool] Faol kalitlar soni: ${AI_CLIENTS.filter(c => c !== null).length} ta`);
  });
}

// Lokal ishga tushirish (Vercel da bu chaqirilmaydi)
if (process.env.VERCEL !== "1") {
  startServer();
}
