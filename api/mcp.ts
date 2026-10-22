import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenAI } from "@google/genai";

// ═══════════════════════════════════════════════════════════════════════════════
// SADO AI — MCP Server (Model Context Protocol)
// ═══════════════════════════════════════════════════════════════════════════════
// Bu endpoint MCP clientlari (Claude, Cursor, VS Code, Windsurf) uchun
// SADO AI ning TTS va imlo tahrirlash funksiyalarini ochib beradi.
//
// Protokol: MCP Streamable HTTP (stateless rejim)
// URL: https://sizning-domen.vercel.app/api/mcp
//
// MUHIM: TTS va Spell Check endi to'g'ridan-to'g'ri Gemini API bilan ishlaydi
// (nested HTTP fetch qilmaydi) — bu Vercel timeout muammosini hal qiladi.
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Server Ma'lumotlari ──────────────────────────────────────────────────────

const SERVER_INFO = {
  name: "sado-ai",
  version: "1.0.0",
};

const PROTOCOL_VERSION = "2025-03-26";

// ─── Multi-Key Pool (MCP ichida mustaqil) ─────────────────────────────────────

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
    return new GoogleGenAI({
      apiKey: key,
      httpOptions: { headers: { "User-Agent": "aistudio-build" } },
    });
  } catch {
    return null;
  }
});

const exhaustedKeys = new Set<number>();

function markKeyExhausted(index: number): void {
  exhaustedKeys.add(index);
  setTimeout(() => exhaustedKeys.delete(index), 60 * 60 * 1000);
}

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
        continue;
      }
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
  Shaxnoza: "Zephyr",
  Nigora: "Kore",
  Umar: "Puck",
  Mustafo: "Charon",
  Ali: "Fenrir",
};

// ─── Dialect Translation ──────────────────────────────────────────────────────

const DIALECT_PROMPTS: Record<string, string> = {
  toshkent:
    `Matnni Toshkent shahri shevasida yozing.
UMUMIY XUSUSIYAT: Adabiy tilga eng yaqin sheva, lekin shahar xalqona ohangi va tez-tez qisqargan shakllar bilan ajralib turadi.
FONETIK/MORFOLOGIK QOIDALAR:
- "aka, uka" → "oka"
- "-yapti", "nadi" → "-yotti" yoki "-votti": ketyapti → ketvotti
- "men" → "man", "sen" → "san"
- so'z oxiridagi "-di" ko'pincha "-votti" ga o'tadi
- so'z oxirida "-daman", "yapman" ko'pincha "vomman" ga o'tadi
Nutq ravon, samimiy, zamonaviy va biroz shoshqaloq ohangda bo'lsin.`,

  andijon:
    `Matnni Andijon viloyati shevasida yozing.
UMUMIY XUSUSIYAT: Farg'ona vodiysi qarluq lahjasiga kiradi. Muloyim, iliq va hurmatga boy nutq uslubi.
FONETIK/MORFOLOGIK QOIDALAR:
- "men", "sen" doim "men", "sen" bo'ladi
- "pman" → "yappan": "Boryapman" → "boryappan"
- "moqdaman" → "yappan": "Bormoqdaman" → "Boryappan"
- "bo'ldi" → "bo'pti"
- "bormayman" → "bormiman"
- "juda" → "vapshe"
Nutq iliq, hurmatga to'la va shirinsuxan bo'lsin.`,

  fargona:
    `Matnni Farg'ona viloyati shevasida yozing. Vodiy xalqiga xos yumshoq, muloyim va hurmatli ohangni saqlang. 'sen', 'men' o'rniga 'man', 'san' ishlatilsin.`,

  namangan:
    `Matnni Namangan viloyati shevasida yozing. Vodiyning shimoliy sheva vakili, tez va ritmik talaffuz.
- "-yapti" → "-oti"/"-vati": borayapti → borvati
- "netvotisan" — nima qilyapsan
- "battar" — juda
Matn samimiy, vodiyga xos tez va ohangdor ritmda bo'lsin.`,

  samarqand:
    `Matnni Samarqand viloyati shevasida yozing. Tojik ta'siridagi shahar shevasi.
- "men ham" → "maniyam"
- "boryapsizmi" → "boraftasiz"
Nutq mayin, madaniyatli ohangda yozilsin.`,

  buxoro:
    `Matnni Buxoro viloyati shevasida yozing. Fors ta'siri kuchli.
- "nima" → "chi gap"
- "xo'p" → "xo'b"
- "jonim" — erkalash
- "picha" — biroz
Nutq sokin, muloyim va buxorona nafosat bilan yozilsin.`,

  xorazm:
    `Matnni Xorazm viloyati shevasida yozing. O'g'uz lahjasi.
- "kel-" → "gal-": keldi → galdi
- "bor-" → "bar-": bordi → bardi
- "keling" → "galing"
- "shu" → "shul"
Nutq sof xorazmcha eshitilsin.`,

  qashqadaryo:
    `Matnni Qashqadaryo viloyati shevasida yozing. Qipchoq lahjasi.
- "-yapti"/"-ibdi" → "-atir(di)": bormoqda → baratir
- "aytibdi" → "atibdi"
- "kelasizmi" → "kemasiz"
Nutq sodda, qat'iy, dadil ohangda bo'lsin.`,

  surxondaryo:
    `Matnni Surxondaryo viloyati shevasida yozing. Janubiy sheva.
- "nima" → "nimala"
- "qayerga" → "qayoqqa"
- "-yapti" → "-ati"/"-yati"
Nutq samimiy, dadil va tabiiy bo'lsin.`,

  jizzax:
    `Matnni Jizzax viloyati shevasida yozing. Markaziy hudud shevasi.
- "-yapti" → "-atti"/"-otti": ketyapti → ketatti
- "men/sen" → "man/san"
Nutq sodda, ravon va samimiy bo'lsin.`,

  sirdaryo:
    `Matnni Sirdaryo viloyati shevasida yozing. Toshkent va Jizzax o'rtasi.
- "-yapti" → "-otti"/"-votti"
- "men/sen" → "man/san"
Nutq sodda, xalqona va samimiy bo'lsin.`,

  navoiy:
    `Matnni Navoiy viloyati shevasida yozing. Buxoro-Samarqand ta'siri.
- "men ham" → "maniyam"
- "picha" — biroz
Nutq ravon, tabiiy va samimiy bo'lsin.`,
};

async function translateToDialect(
  text: string,
  dialect: string,
  aiClient: GoogleGenAI
): Promise<string> {
  if (!dialect || dialect === "standard") return text;

  const instruction = DIALECT_PROMPTS[dialect.toLowerCase()];
  if (!instruction) return text;

  const promptText =
    `Siz professional o'zbek tili tarjimonisiz. Quyidagi o'zbekcha matnni ${instruction} o'girib bering.\n` +
    `ASL MATN: "${text}"\n` +
    `KO'RSATMA: Asl matnning ma'nosini 100% saqlang, hech qanday qo'shimcha so'z, tushuntirish, izoh yozmang! Faqat va faqat shevadagi tarjimani qaytaring.`;

  const modelsToTry = ["gemini-3.5-flash", "gemini-3.1-flash-lite"];

  for (const modelName of modelsToTry) {
    try {
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
      if (isQuotaError(err)) throw err;
      console.warn(`Translation failed for model ${modelName}:`, err);
    }
  }

  return text;
}

// ─── Style + Dialect Prompt Builder ───────────────────────────────────────────

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
    dialectInstruction = "in the Tashkent urban dialect of Uzbek — brisk, confident city cadence";
  } else if (normDialect === "andijon") {
    dialectInstruction = "in the Andijon dialect of the Fergana Valley — soft, rounded vowels; warm rising intonation";
  } else if (normDialect === "fargona") {
    dialectInstruction = "in the Farg'ona dialect — extremely soft and unhurried articulation";
  } else if (normDialect === "namangan") {
    dialectInstruction = "in the Namangan dialect — quick pitch shifts, moderate-fast pace";
  } else if (normDialect === "samarqand") {
    dialectInstruction = "in the Samarqand dialect — Tajik-Persian influenced, measured pace";
  } else if (normDialect === "buxoro") {
    dialectInstruction = "in the Buxoro dialect — Persian-influenced soft articulation, slow deliberate pace";
  } else if (normDialect === "xorazm") {
    dialectInstruction = "in the Xorazm dialect — distinct Oghuz-type accent, staccato clipped rhythm";
  } else if (normDialect === "qashqadaryo") {
    dialectInstruction = "in the Qashqadaryo dialect — Kipchak-type accent, harder clearer consonants";
  } else if (normDialect === "surxondaryo") {
    dialectInstruction = "in the Surxondaryo dialect — deep resonant quality, grounded intonation";
  } else if (normDialect === "jizzax") {
    dialectInstruction = "in the Jizzax dialect — transitional accent, plain unadorned rhythm";
  } else if (normDialect === "sirdaryo") {
    dialectInstruction = "in the Sirdaryo dialect — transitional accent, natural conversational Uzbek";
  } else if (normDialect === "navoiy") {
    dialectInstruction = "in the Navoiy dialect — blend of Buxoro-Samarqand softness";
  }

  return `${styleInstruction} ${dialectInstruction}: ${text}`;
}

// ─── Tool Ta'riflari (JSON Schema formatida) ─────────────────────────────────

const TOOLS = [
  {
    name: "uzbek_tts",
    description:
      "O'zbek tilidagi matnni tabiiy ovozga aylantiradi (Text-to-Speech). " +
      "5 xil ovoz (Shaxnoza, Nigora — ayol; Umar, Mustafo, Ali — erkak) va " +
      "12+ viloyat shevalari mavjud. Natijada yuklab olish URL qaytariladi.",
    inputSchema: {
      type: "object" as const,
      properties: {
        text: {
          type: "string",
          description: "O'zbekcha matn (max 500 belgi)",
          minLength: 1,
          maxLength: 500,
        },
        voiceName: {
          type: "string",
          enum: ["Shaxnoza", "Nigora", "Umar", "Mustafo", "Ali"],
          default: "Shaxnoza",
          description: "Ovoz nomi.",
        },
        style: {
          type: "string",
          enum: ["natural", "news", "cheerful", "sad", "angry", "whisper", "storytelling"],
          default: "natural",
          description: "Ovoz uslubi.",
        },
        dialect: {
          type: "string",
          enum: [
            "standard", "toshkent", "andijon", "fargona", "namangan",
            "samarqand", "buxoro", "xorazm", "qashqadaryo",
            "surxondaryo", "jizzax", "sirdaryo", "navoiy",
          ],
          default: "standard",
          description: "Viloyat shevasi.",
        },
        speed: {
          type: "number",
          minimum: 0.5,
          maximum: 2.0,
          default: 1.0,
          description: "Ovoz tezligi (0.5-2.0).",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "uzbek_spell_check",
    description:
      "O'zbek tilidagi matnni imlo va grammatika jihatdan tekshiradi va to'g'rilaydi.",
    inputSchema: {
      type: "object" as const,
      properties: {
        text: {
          type: "string",
          description: "O'zbekcha matn (max 500 belgi)",
          minLength: 1,
          maxLength: 500,
        },
      },
      required: ["text"],
    },
  },
];

// ─── Yordamchi Funksiyalar ────────────────────────────────────────────────────

function getBaseUrl(req: VercelRequest): string {
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const host =
    (req.headers["x-forwarded-host"] as string) ||
    (req.headers["host"] as string) ||
    "localhost:3000";
  return `${proto}://${host}`;
}

function jsonRpcResult(id: string | number, result: any) {
  return { jsonrpc: "2.0" as const, id, result };
}

function jsonRpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: any
) {
  return {
    jsonrpc: "2.0" as const,
    id,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  };
}

// ─── Tool Bajarish Funksiyalari (TO'G'RIDAN-TO'G'RI Gemini API) ──────────────

/**
 * O'zbek TTS — Matnni ovozga aylantirish
 * MUHIM: Bu funksiya Gemini API ni to'g'ridan-to'g'ri chaqiradi,
 * /api/tts ga fetch QILMAYDI. Bu Vercel timeout muammosini hal qiladi.
 */
async function executeUzbekTts(
  args: Record<string, any>,
  baseUrl: string
): Promise<{ content: any[]; isError?: boolean }> {
  const {
    text,
    voiceName = "Shaxnoza",
    style = "natural",
    dialect = "standard",
    speed = 1.0,
  } = args;

  if (!text || typeof text !== "string") {
    return {
      content: [{ type: "text", text: "❌ Xatolik: 'text' maydoni majburiy." }],
      isError: true,
    };
  }

  if (text.length > 500) {
    return {
      content: [{ type: "text", text: "❌ Xatolik: Matn 500 belgidan oshmasligi kerak." }],
      isError: true,
    };
  }

  if (!hasAvailableClients()) {
    return {
      content: [{ type: "text", text: "❌ Tizim hozirda band. Biroz kutib qayta urinib ko'ring." }],
      isError: true,
    };
  }

  const resolvedVoice = VOICE_MAP[voiceName] || "Zephyr";

  try {
    // Gemini API ni to'g'ridan-to'g'ri chaqirish (nested fetch yo'q!)
    const result = await callWithKeyRotation(async (client) => {
      // 1. Dialekt tarjimasi
      let textToSynthesize = text;
      let translatedText: string | null = null;

      if (dialect && dialect !== "standard") {
        textToSynthesize = await translateToDialect(text, dialect, client);
        translatedText = textToSynthesize;
      }

      // 2. TTS prompt yaratish
      const promptWithEmotion = getPromptForStyleAndDialect(
        textToSynthesize,
        style,
        dialect
      );

      // 3. Gemini TTS API chaqirish
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

    // Audio ma'lumotni olish
    const audioPart = result.response.candidates?.[0]?.content?.parts?.[0];
    const base64Audio = (audioPart as any)?.inlineData?.data;

    if (!base64Audio) {
      return {
        content: [{ type: "text", text: "❌ API audio ma'lumot qaytarmadi. Qayta urinib ko'ring." }],
        isError: true,
      };
    }

    // Audio natijasini shakllantirish
    const sizeKB = Math.round((base64Audio.length * 3) / 4 / 1024);
    const content: any[] = [];

    // Audio'ni embedded resource sifatida qaytarish
    content.push({
      type: "resource",
      resource: {
        uri: `data:audio/wav;base64,${base64Audio}`,
        mimeType: "audio/wav",
        blob: base64Audio,
      },
    });

    // Metadata matnini yaratish
    let metaText = `✅ Ovoz muvaffaqiyatli yaratildi!\n\n`;
    metaText += `📝 Asl matn: ${text}\n`;
    if (result.translatedText && result.translatedText !== text) {
      metaText += `🗣️ Sheva matni: ${result.translatedText}\n`;
    }
    metaText += `🎤 Ovoz: ${voiceName}\n`;
    metaText += `🎭 Uslub: ${style}\n`;
    metaText += `🌍 Sheva: ${dialect}\n`;
    metaText += `⚡ Tezlik: ${speed}x\n`;
    metaText += `\n📦 Audio format: WAV (24kHz, 16-bit, mono)\n`;
    metaText += `📊 Audio hajmi: ~${sizeKB} KB`;
    content.push({ type: "text", text: metaText });

    return { content };
  } catch (error: any) {
    if (error.message === "ALL_KEYS_EXHAUSTED") {
      return {
        content: [{ type: "text", text: "❌ Barcha API kalitlar limitiga yetdi. 24 soatdan keyin qayta urining." }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: `❌ TTS xatolik: ${error.message}` }],
      isError: true,
    };
  }
}

/**
 * O'zbek Imlo Tahrirlash
 * MUHIM: Bu ham to'g'ridan-to'g'ri Gemini API chaqiradi.
 */
async function executeSpellCheck(
  args: Record<string, any>
): Promise<{ content: any[]; isError?: boolean }> {
  const { text } = args;

  if (!text || typeof text !== "string") {
    return {
      content: [{ type: "text", text: "❌ Xatolik: 'text' maydoni majburiy." }],
      isError: true,
    };
  }

  if (text.length > 500) {
    return {
      content: [{ type: "text", text: "❌ Xatolik: Matn 500 belgidan oshmasligi kerak." }],
      isError: true,
    };
  }

  if (!hasAvailableClients()) {
    return {
      content: [{ type: "text", text: "❌ Tizim hozirda band. Biroz kutib qayta urinib ko'ring." }],
      isError: true,
    };
  }

  const systemInstruction =
    "Siz O'zbek tili bo'yicha mukammal imlo va grammatika mutaxassisiz. " +
    "Sizga taqdim etilgan o'zbekcha matnni tekshiring, imlo xatolarini to'g'rilang, tinish belgilarini joyiga qo'ying va grammatik qo'shimchalarni muvofiqlashtiring. " +
    "Ayniqsa 'o' va 'g' harflari uchun to'g'ri o'zbekcha tutuq belgilarini qo'llang. " +
    "FAQAT tuzatilgan matnni qaytaring. Hech qanday izoh yozmang.";

  try {
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

    let resultText = `✅ Imlo tahrirlash muvaffaqiyatli!\n\n`;
    resultText += `📝 Asl matn:\n${text}\n\n`;
    resultText += `✏️ To'g'rilangan matn:\n${enhancedText}`;

    if (text.trim() === enhancedText.trim()) {
      resultText += `\n\nℹ️ Matn allaqachon to'g'ri.`;
    }

    return { content: [{ type: "text", text: resultText }] };
  } catch (error: any) {
    if (error.message === "ALL_KEYS_EXHAUSTED") {
      return {
        content: [{ type: "text", text: "❌ Barcha API kalitlar limitiga yetdi." }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: `❌ Imlo xatolik: ${error.message}` }],
      isError: true,
    };
  }
}

/**
 * Tool nomiga qarab tegishli funksiyani chaqirish
 */
async function executeTool(
  toolName: string,
  args: Record<string, any>,
  baseUrl: string
): Promise<{ content: any[]; isError?: boolean }> {
  switch (toolName) {
    case "uzbek_tts":
      return executeUzbekTts(args, baseUrl);
    case "uzbek_spell_check":
      return executeSpellCheck(args);
    default:
      return {
        content: [{ type: "text", text: `❌ Noma'lum tool: "${toolName}"` }],
        isError: true,
      };
  }
}

// ─── JSON-RPC Xabar Qayta Ishlash ────────────────────────────────────────────

function processMessage(message: any): any {
  if (!message || message.jsonrpc !== "2.0") {
    if (message?.id !== undefined && message?.id !== null) {
      return jsonRpcError(message.id, -32600, "Invalid JSON-RPC 2.0 request");
    }
    return null;
  }

  const { id, method, params } = message;

  if (id === undefined || id === null) {
    return null;
  }

  switch (method) {
    case "initialize":
      return jsonRpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      });

    case "tools/list":
      return jsonRpcResult(id, { tools: TOOLS });

    case "tools/call":
      return { __async: true, id, params };

    case "ping":
      return jsonRpcResult(id, {});

    case "resources/list":
      return jsonRpcResult(id, { resources: [] });

    case "prompts/list":
      return jsonRpcResult(id, { prompts: [] });

    default:
      return jsonRpcError(id, -32601, `Method not found: ${method}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Vercel Serverless Function — Asosiy Handler
// ═══════════════════════════════════════════════════════════════════════════════

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept, Authorization, Mcp-Session-Id"
  );
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method === "GET") {
    return res.status(200).json({
      name: SERVER_INFO.name,
      version: SERVER_INFO.version,
      protocolVersion: PROTOCOL_VERSION,
      description: "SADO AI — O'zbek tili uchun TTS va imlo tahrirlash MCP serveri",
      tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
    });
  }

  if (req.method === "DELETE") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const contentType = (req.headers["content-type"] as string) || "";
  if (!contentType.includes("application/json")) {
    return res.status(415).json(
      jsonRpcError(null, -32700, "Content-Type must be application/json")
    );
  }

  const body = req.body;

  if (!body) {
    return res.status(400).json(jsonRpcError(null, -32700, "Empty request body"));
  }

  const baseUrl = getBaseUrl(req);
  const isBatch = Array.isArray(body);
  const messages = isBatch ? body : [body];

  if (messages.length === 0) {
    return res.status(400).json(jsonRpcError(null, -32600, "Empty batch request"));
  }

  const responses: any[] = [];

  for (const message of messages) {
    const result = processMessage(message);

    if (result === null) continue;

    if (result.__async) {
      try {
        const toolName = result.params?.name;
        const toolArgs = result.params?.arguments || {};

        if (!toolName || typeof toolName !== "string") {
          responses.push(jsonRpcError(result.id, -32602, "Tool name is required"));
          continue;
        }

        const toolResult = await executeTool(toolName, toolArgs, baseUrl);
        responses.push(jsonRpcResult(result.id, toolResult));
      } catch (error: any) {
        responses.push(
          jsonRpcError(result.id, -32000, error.message || "Internal tool execution error")
        );
      }
    } else {
      responses.push(result);
    }
  }

  if (responses.length === 0) {
    return res.status(202).end();
  }

  res.setHeader("Content-Type", "application/json");

  if (isBatch) {
    return res.status(200).json(responses);
  } else {
    return res.status(200).json(responses[0]);
  }
}
