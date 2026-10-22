import type { VercelRequest, VercelResponse } from "@vercel/node";

// ═══════════════════════════════════════════════════════════════════════════════
// SADO AI — MCP Server (Model Context Protocol)
// ═══════════════════════════════════════════════════════════════════════════════
// Bu endpoint MCP clientlari (Claude, Cursor, VS Code, Windsurf) uchun
// SADO AI ning TTS va imlo tahrirlash funksiyalarini ochib beradi.
//
// Protokol: MCP Streamable HTTP (stateless rejim)
// URL: https://sizning-domen.vercel.app/api/mcp
//
// Hech qanday qo'shimcha dependency talab qilinmaydi — sof JSON-RPC 2.0.
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Server Ma'lumotlari ──────────────────────────────────────────────────────

const SERVER_INFO = {
  name: "sado-ai",
  version: "1.0.0",
};

const PROTOCOL_VERSION = "2025-03-26";

// ─── Tool Ta'riflari (JSON Schema formatida) ─────────────────────────────────

const TOOLS = [
  {
    name: "uzbek_tts",
    description:
      "O'zbek tilidagi matnni tabiiy ovozga aylantiradi (Text-to-Speech). " +
      "5 xil ovoz (Shaxnoza, Nigora — ayol; Umar, Mustafo, Ali — erkak) va " +
      "12+ viloyat shevalari (toshkent, andijon, fargona, namangan, samarqand, " +
      "buxoro, xorazm, qashqadaryo, surxondaryo, jizzax, sirdaryo, navoiy) " +
      "mavjud. Natija base64 kodlangan WAV audio formatida qaytariladi.",
    inputSchema: {
      type: "object" as const,
      properties: {
        text: {
          type: "string",
          description:
            "Ovozga aylantiriladigan o'zbek tilidagi matn. Maksimum 500 belgi.",
          minLength: 1,
          maxLength: 500,
        },
        voiceName: {
          type: "string",
          enum: ["Shaxnoza", "Nigora", "Umar", "Mustafo", "Ali"],
          default: "Shaxnoza",
          description:
            "Ovoz nomi. Shaxnoza va Nigora — ayol ovozlari. Umar, Mustafo va Ali — erkak ovozlari.",
        },
        style: {
          type: "string",
          enum: [
            "natural",
            "news",
            "cheerful",
            "sad",
            "angry",
            "whisper",
            "storytelling",
          ],
          default: "natural",
          description:
            "Ovoz uslubi: natural (tabiiy), news (yangiliklar), cheerful (quvnoq), " +
            "sad (g'amgin), angry (jahldor), whisper (shivirlab), storytelling (hikoya).",
        },
        dialect: {
          type: "string",
          enum: [
            "standard",
            "toshkent",
            "andijon",
            "fargona",
            "namangan",
            "samarqand",
            "buxoro",
            "xorazm",
            "qashqadaryo",
            "surxondaryo",
            "jizzax",
            "sirdaryo",
            "navoiy",
          ],
          default: "standard",
          description:
            "Viloyat shevasi. 'standard' — adabiy til. Boshqa variantlar: " +
            "toshkent, andijon, fargona, namangan, samarqand, buxoro, xorazm, " +
            "qashqadaryo, surxondaryo, jizzax, sirdaryo, navoiy.",
        },
        speed: {
          type: "number",
          minimum: 0.5,
          maximum: 2.0,
          default: 1.0,
          description:
            "Ovoz tezligi. 0.5 (sekin) dan 2.0 (tez) gacha. Default: 1.0.",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "uzbek_spell_check",
    description:
      "O'zbek tilidagi matnni imlo va grammatika jihatdan tekshiradi va to'g'rilaydi. " +
      "Tinish belgilari, oʻ va gʻ harflari, grammatik qo'shimchalarni tuzatadi. " +
      "Gemini AI asosida ishlaydi.",
    inputSchema: {
      type: "object" as const,
      properties: {
        text: {
          type: "string",
          description:
            "Imlo tahrirlash uchun o'zbek tilidagi matn. Maksimum 500 belgi.",
          minLength: 1,
          maxLength: 500,
        },
      },
      required: ["text"],
    },
  },
];

// ─── Yordamchi Funksiyalar ────────────────────────────────────────────────────

/**
 * Vercel request dan deployment URL ni aniqlash.
 * MCP endpoint o'z-o'ziga (TTS, enhance-text) so'rov yuborishi uchun kerak.
 */
function getBaseUrl(req: VercelRequest): string {
  // Vercel avtomatik yuboradigan headerlar
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const host =
    (req.headers["x-forwarded-host"] as string) ||
    (req.headers["host"] as string) ||
    "localhost:3000";
  return `${proto}://${host}`;
}

/**
 * JSON-RPC 2.0 muvaffaqiyatli javob yaratish
 */
function jsonRpcResult(id: string | number, result: any) {
  return { jsonrpc: "2.0" as const, id, result };
}

/**
 * JSON-RPC 2.0 xatolik javob yaratish
 */
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

// ─── Tool Bajarish Funksiyalari ───────────────────────────────────────────────

/**
 * O'zbek TTS — Matnni ovozga aylantirish
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

  // Validatsiya
  if (!text || typeof text !== "string") {
    return {
      content: [{ type: "text", text: "❌ Xatolik: 'text' maydoni majburiy." }],
      isError: true,
    };
  }

  if (text.length > 500) {
    return {
      content: [
        {
          type: "text",
          text: "❌ Xatolik: Matn uzunligi 500 belgidan oshmasligi kerak.",
        },
      ],
      isError: true,
    };
  }

  try {
    const response = await fetch(`${baseUrl}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voiceName, style, dialect, speed }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMsg =
        (errorData as any)?.error ||
        `TTS API xatolik qaytardi (HTTP ${response.status})`;
      return {
        content: [{ type: "text", text: `❌ ${errorMsg}` }],
        isError: true,
      };
    }

    const data = (await response.json()) as {
      success: boolean;
      audioBase64?: string;
      metadata?: {
        text: string;
        synthesizedText: string;
        translatedText: string | null;
        dialect: string;
        voiceName: string;
        resolvedVoice: string;
        style: string;
        speed: number;
      };
    };

    if (!data.success || !data.audioBase64) {
      return {
        content: [
          { type: "text", text: "❌ TTS API audio ma'lumot qaytarmadi." },
        ],
        isError: true,
      };
    }

    // Natijani shakllantirish
    const content: any[] = [];

    // Audio ni embedded resource sifatida qaytarish
    content.push({
      type: "resource",
      resource: {
        uri: `data:audio/wav;base64,${data.audioBase64}`,
        mimeType: "audio/wav",
        blob: data.audioBase64,
      },
    });

    // Metadata matnini yaratish
    const meta = data.metadata;
    let metaText = `✅ Ovoz muvaffaqiyatli yaratildi!\n\n`;
    metaText += `📝 Asl matn: ${meta?.text || text}\n`;
    if (meta?.translatedText && meta.translatedText !== meta.text) {
      metaText += `🗣️ Sheva matni: ${meta.translatedText}\n`;
    }
    metaText += `🎤 Ovoz: ${meta?.voiceName || voiceName}\n`;
    metaText += `🎭 Uslub: ${meta?.style || style}\n`;
    metaText += `🌍 Sheva: ${meta?.dialect || dialect}\n`;
    metaText += `⚡ Tezlik: ${meta?.speed ?? speed}x\n`;
    metaText += `\n📦 Audio format: WAV (24kHz, 16-bit, mono)\n`;
    metaText += `📊 Audio hajmi: ~${Math.round((data.audioBase64.length * 3) / 4 / 1024)} KB`;

    content.push({ type: "text", text: metaText });

    return { content };
  } catch (error: any) {
    return {
      content: [
        {
          type: "text",
          text: `❌ TTS serverga ulanishda xatolik: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * O'zbek Imlo Tahrirlash
 */
async function executeSpellCheck(
  args: Record<string, any>,
  baseUrl: string
): Promise<{ content: any[]; isError?: boolean }> {
  const { text } = args;

  // Validatsiya
  if (!text || typeof text !== "string") {
    return {
      content: [{ type: "text", text: "❌ Xatolik: 'text' maydoni majburiy." }],
      isError: true,
    };
  }

  if (text.length > 500) {
    return {
      content: [
        {
          type: "text",
          text: "❌ Xatolik: Matn uzunligi 500 belgidan oshmasligi kerak.",
        },
      ],
      isError: true,
    };
  }

  try {
    const response = await fetch(`${baseUrl}/api/enhance-text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMsg =
        (errorData as any)?.error ||
        `Imlo API xatolik qaytardi (HTTP ${response.status})`;
      return {
        content: [{ type: "text", text: `❌ ${errorMsg}` }],
        isError: true,
      };
    }

    const data = (await response.json()) as {
      success: boolean;
      enhancedText?: string;
    };

    if (!data.success || !data.enhancedText) {
      return {
        content: [
          { type: "text", text: "❌ Imlo API natija qaytarmadi." },
        ],
        isError: true,
      };
    }

    // Natijani shakllantirish
    let resultText = `✅ Imlo tahrirlash muvaffaqiyatli!\n\n`;
    resultText += `📝 Asl matn:\n${text}\n\n`;
    resultText += `✏️ To'g'rilangan matn:\n${data.enhancedText}`;

    if (text.trim() === data.enhancedText.trim()) {
      resultText += `\n\nℹ️ Matn allaqachon to'g'ri — hech qanday o'zgarish kiritilmadi.`;
    }

    return { content: [{ type: "text", text: resultText }] };
  } catch (error: any) {
    return {
      content: [
        {
          type: "text",
          text: `❌ Imlo serverga ulanishda xatolik: ${error.message}`,
        },
      ],
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
      return executeSpellCheck(args, baseUrl);
    default:
      return {
        content: [
          { type: "text", text: `❌ Noma'lum tool: "${toolName}"` },
        ],
        isError: true,
      };
  }
}

// ─── JSON-RPC Xabar Qayta Ishlash ────────────────────────────────────────────

/**
 * Bitta JSON-RPC xabarni qayta ishlash.
 * Sinxron metodlar natijani to'g'ridan-to'g'ri qaytaradi.
 * Asinxron metodlar (tools/call) uchun maxsus marker qaytariladi.
 */
function processMessage(message: any): any {
  // JSON-RPC 2.0 tekshiruvi
  if (!message || message.jsonrpc !== "2.0") {
    if (message?.id !== undefined && message?.id !== null) {
      return jsonRpcError(message.id, -32600, "Invalid JSON-RPC 2.0 request");
    }
    return null; // Noto'g'ri notification — e'tiborsiz qoldiriladi
  }

  const { id, method, params } = message;

  // Notification (id yo'q) — javob kerak emas
  if (id === undefined || id === null) {
    return null;
  }

  // Metodlarni qayta ishlash
  switch (method) {
    // ── Initialize ──────────────────────────────────────────────
    case "initialize":
      return jsonRpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: false },
        },
        serverInfo: SERVER_INFO,
      });

    // ── Tools/List ──────────────────────────────────────────────
    case "tools/list":
      return jsonRpcResult(id, { tools: TOOLS });

    // ── Tools/Call ──────────────────────────────────────────────
    case "tools/call":
      // Asinxron — maxsus marker qaytaramiz, handler da await qilinadi
      return { __async: true, id, params };

    // ── Ping ────────────────────────────────────────────────────
    case "ping":
      return jsonRpcResult(id, {});

    // ── Resources/List (bo'sh) ──────────────────────────────────
    case "resources/list":
      return jsonRpcResult(id, { resources: [] });

    // ── Prompts/List (bo'sh) ────────────────────────────────────
    case "prompts/list":
      return jsonRpcResult(id, { prompts: [] });

    // ── Noma'lum metod ──────────────────────────────────────────
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
  // ── CORS Headerlar ──────────────────────────────────────────────────────────
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, DELETE, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept, Authorization, Mcp-Session-Id"
  );
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

  // ── OPTIONS (CORS preflight) ────────────────────────────────────────────────
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  // ── GET — Server holati / SSE endpointi ─────────────────────────────────────
  // Stateless rejimda SSE qo'llab-quvvatlanmaydi.
  // Ba'zi clientlar GET orqali serverning mavjudligini tekshiradi.
  if (req.method === "GET") {
    return res.status(200).json({
      name: SERVER_INFO.name,
      version: SERVER_INFO.version,
      protocolVersion: PROTOCOL_VERSION,
      description:
        "SADO AI — O'zbek tili uchun matn-to-ovoz (TTS) va imlo tahrirlash MCP serveri",
      tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
    });
  }

  // ── DELETE — Sessiya tugatish (stateless — shunchaki qabul qilamiz) ─────────
  if (req.method === "DELETE") {
    return res.status(200).end();
  }

  // ── POST — JSON-RPC xabarlarni qayta ishlash ───────────────────────────────
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Content-Type tekshiruvi
  const contentType = (req.headers["content-type"] as string) || "";
  if (!contentType.includes("application/json")) {
    return res.status(415).json(
      jsonRpcError(null, -32700, "Content-Type must be application/json")
    );
  }

  const body = req.body;

  // Bo'sh body tekshiruvi
  if (!body) {
    return res
      .status(400)
      .json(jsonRpcError(null, -32700, "Empty request body"));
  }

  const baseUrl = getBaseUrl(req);

  // Batch yoki single message tekshiruvi
  const isBatch = Array.isArray(body);
  const messages = isBatch ? body : [body];

  if (messages.length === 0) {
    return res
      .status(400)
      .json(jsonRpcError(null, -32600, "Empty batch request"));
  }

  // Har bir xabarni qayta ishlash
  const responses: any[] = [];

  for (const message of messages) {
    const result = processMessage(message);

    // null — notification, javob kerak emas
    if (result === null) {
      continue;
    }

    // Asinxron tool chaqiruv
    if (result.__async) {
      try {
        const toolName = result.params?.name;
        const toolArgs = result.params?.arguments || {};

        if (!toolName || typeof toolName !== "string") {
          responses.push(
            jsonRpcError(result.id, -32602, "Tool name is required")
          );
          continue;
        }

        // Tool ni bajarish
        const toolResult = await executeTool(toolName, toolArgs, baseUrl);
        responses.push(jsonRpcResult(result.id, toolResult));
      } catch (error: any) {
        responses.push(
          jsonRpcError(
            result.id,
            -32000,
            error.message || "Internal tool execution error"
          )
        );
      }
    } else {
      // Sinxron natija
      responses.push(result);
    }
  }

  // Agar hamma xabar notification bo'lsa — 202 Accepted
  if (responses.length === 0) {
    return res.status(202).end();
  }

  // Javobni qaytarish
  res.setHeader("Content-Type", "application/json");

  if (isBatch) {
    return res.status(200).json(responses);
  } else {
    return res.status(200).json(responses[0]);
  }
}
