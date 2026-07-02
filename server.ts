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
  - so'z oxiridagi "-di" ko'pincha "-votti" ga o'tadi tez nutqda, "hisoblanadi" -> "hisoblanvotti"
  - so'z oxirida "-daman", "yapman" ko'pincha "vomman" ga o'tada tez nuqtda, "bormoqdaman" -> "borvomman"
  - so'z oxirgi asosiy qo'shimchasidan oldin "a" harfi bo'lsa ko'pincha "i" harfiga o'zgaradi agar ma'no yo'qolmasa, "ishlayman" -> "ishliman", "bormayman" -> "bormiman"
  
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
  - "men", "sen" -> "man", "san" so'zlari doim "men", "sen" bo'ladi!, "Man" -> "men", "san" -> "sen" 
  - "-gan" → "-gan/-kan" saqlanadi, lekin unlilar cho'ziladi (vodiyga xos) ba'zan ma'noga ta'sir qilmasa "yappan" misol uchun "qilyapman" -> "qilyappan"
  -  "pman" → so'z agar "man" qo'shimchasidan olsin "p" harfi bo'lgan hamma so'zga "yappan" ishlatiladi. "Boryapman" -> "boryappan"
  -  "yappan" -> so'z "moqdaman" qo'shimchasi bo'lsa "yappan"ga o'zgartir. "Bormoqdaman" -> "Boryappan"
  -  "yapti" -> so'z "moqda" yoki "nadi" qo'shimchasi bo'lsa "yapti" ga o'zgartir. "Bormoqda" -> "Boryapti", "qilinadi" -> "qilinyapti:
  -  "miman" -> so'z agar "man" qo'shimchasi oldida "y" harfi bo'lgan hamma so'zga "miman" ishlatiladi. "bormayman" -> "bormiman", "qilmayman" -> "qimiman", "yurmayman" -> "yurmiman".
  - "sizmi" - agar "mi" qo'shimchasi oldidan "z" bo'lsa "z" harfi tushib qoladi "simi", "yuribsizmi" -> "yuribsimi", "qilyapsizmi" -> "qilyapsimi", "boryapsizmi" -> "boryapsimi"
  -  "psiz" -> agar so'zda asosiy qo'chimcha oldidan "lib" so'zi bo'lsa "p" ga o'zgaradi qolgan qo'shimchalar o'z o'rnida bo'ladi. "kelibsiz"-> "kepsiz", "berilibsiz" -> "beripsiz", "sinrilibsiz" -> "sindiripsiz"
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
  
  LEKSIKA VA IBORALAR:
  - aka, opajon, uka, brat — murojaatlar
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

    samarqand: `Matnni Samarqand viloyati shevasida yozing.
 
UMUMIY XUSUSIYAT:
Qarluq-tojik ta'siridagi shahar shevasi. Samarqand nutqiga xos qadimiy
uslub va tojik tili ta'siri, ayniqsa fe'l shakllari va olmoshlarda
kuchli seziladi.
 
FONETIK/MORFOLOGIK QOIDALAR:
- "men" → "man", "meniki" → "maniki", "men ham" → "maniyam"
- davomiy fe'l shakli tojikcha andozada: "boryapsizmi" → "boraftasiz"
- "keldimi" so'rog'i o'rniga "kelganmi" tez-tez ishlatiladi
- "-b qo'ydi" konstruksiyasi ko'p uchraydi
- "-b" ravishdosh shakli tojikcha "rafta" andozasida ham qo'llanadi: "borib" → "rafta"
 
LEKSIKA VA IBORALAR:
- maniyam — men ham
- kelganmi — keldimi
- boraftasiz — boryapsizmi
- rafta — borib
- gap yo'q — muammo yo'q, rozilik
- "-cha" kichraytiruvchi qo'shimcha ko'p ishlatiladi
 
NAMUNALAR:
Adabiy: "Men ham boraman, gap yo'q."
Samarqandcha: "Maniyam boraman, gap yo'q-e."
 
Adabiy: "Qayerga borayapsiz?"
Samarqandcha: "Qayoqqa boraftasiz hoziroq?"
 
Adabiy: "U keldimi?"
Samarqandcha: "U kelganmi?"
 
Nutq mayin, madaniyatli, biroz qadimiy ohangda, shahar zodagonligi
hissi bilan yozilsin.`,
    buxoro: `Matnni Buxoro viloyati shevasida yozing.
 
UMUMIY XUSUSIYAT:
Samarqand shevasiga yaqin, ammo tojik-fors ta'siri yanada kuchliroq
seziladigan qadimiy shahar shevasi. Sokin, nafis va bosiq ohang xos.
 
FONETIK/MORFOLOGIK QOIDALAR:
- unlilar tor va yumshoq talaffuz qilinadi (yozma matnda so'z tanlovi orqali aks ettiring)
- "-man" tugallovchi qo'shimchasi ko'p qo'llanadi: ketaman, boraman
- "nima" so'zi o'rniga "chi gap" iborasi ko'p ishlatiladi (ayniqsa savol-murojaatlarda)
- fors-tojikcha so'zlar tabiiy aralashadi (kamdan-kam, ortiqcha emas)
 
LEKSIKA VA IBORALAR:
- "e" undovi — hayrat, ta'kid
- "xo'b" — yaxshi, xo'p (tojikcha ta'sirda)
- "jonim" — erkalash murojaati
- "picha" — biroz, ozgina
- "chi gap" — nima gap, nima bo'ldi
 
NAMUNALAR:
Adabiy: "Nima bo'ldi, tinchlikmi?"
Buxorocha: "Chi gap, tinchlikmi jonim?"
 
Adabiy: "Biroz kuting, hozir kelaman."
Buxorocha: "Picha sabr qiling, hozir kelaman, jonim."
 
Adabiy: "Yaxshi bo'ldi, rahmat."
Buxorocha: "Xo'b bo'ldi-e, rahmat sizga."
 
So'zlashuv tabiiy, sokin, muloyim va o'ziga xos buxorona nafosat bilan
yozilsin — shoshilmasdan, bosiqlik bilan.`,

    xorazm:
      `Matnni Xorazm viloyati shevasida yozing.
 
UMUMIY XUSUSIYAT:
O'g'uz lahjasi guruhiga kiradi (turkman-ozarbayjon tillariga yaqin
xususiyatlar). O'zbek tilining boshqa shevalaridan eng ko'p farq
qiluvchi sheva hisoblanadi.
 
FONETIK/MORFOLOGIK QOIDALAR:
- "kel-" → "gal-": keldi → galdi, kelyapti → galyapti, kelipsan(mi) → keldingmi
- "bor-" → "bar-": bordi → bardi, boraman → baraman
- so'z boshida q → g, k → g tendensiyasi kuchli
- "-yotibdi" → "-ip(ti)": yotibdi → yotipti, o'tiribdi → o'tiripti
- "keling" → "galing", "keting"/"boring" → "giding"
- "sen" → "san", talaffuz cho'ziqroq
- "shu" → "shul"
- "nima qilyapsan" → "na qilipsan"
 
LEKSIKA VA IBORALAR:
- galing — keling
- giding — keting/boring (kontekstga qarab)
- na qilipsan — nima qilyapsan
- shul — shu
- kelipsan(mi) — keldingmi
- yotipti — yotibdi
 
NAMUNALAR:
Adabiy: "Sen qayerga borayapsan?"
Xorazmcha: "San qayoqqa baratirsan?"
 
Adabiy: "U uyga keldi va o'tirdi."
Xorazmcha: "U öyge galip, o'tiripti."
 
Adabiy: "Nima qilyapsan hozir?"
Xorazmcha: "Hozir na qilipsan?"
 
Adabiy: "Keling, bu yerda o'tiring."
Xorazmcha: "Galing, shul yerda giding-o'tiring."
 
Nutq sof xorazmcha eshitilsin — bu qoidalarni matn davomida izchil
qo'llang, faqat bir-ikki so'zga cheklanib qolmang.`,

    qashqadaryo:
      `Matnni Qashqadaryo viloyati shevasida yozing.
 
UMUMIY XUSUSIYAT:
Qipchoq lahjasiga kiradi (qozoq-qoraqalpoq tillariga yaqin xususiyatlar
bilan). Fe'l shakllari va talaffuzda o'ziga xos qattiqlik xos.
 
FONETIK/MORFOLOGIK QOIDALAR:
- "-yapti"/"-ibdi" → "-atir(di)": bormoqda → baratir, keladi → kelatir
- "-gan edi" → "-atkan": borgan edi → baratkan
- "aytibdi" → "atibdi"
- "kelasizmi" → "kemasiz" (qisqargan so'roq shakli)
- unlilar qipchoqcha qattiqroq talaffuz qilinadi (a, o aniq ajraladi)
 
LEKSIKA VA IBORALAR:
- atibdi — aytibdi
- baratirmiz — boryapmiz
- kemasiz — kelasizmi
- "asti" — juda, kuchaytiruvchi
 
NAMUNALAR:
Adabiy: "Biz hozir borayapmiz."
Qashqadaryocha: "Biz hozir baratirmiz."
 
Adabiy: "U shunday deb aytibdi."
Qashqadaryocha: "U shunaqa deb atibdi."
 
Adabiy: "Siz ham kelasizmi?"
Qashqadaryocha: "Siz ham kemasiz?"
 
Nutq sodda, qat'iy, dadil va xalqona ohangda bo'lsin — qipchoqcha
fe'l shakllarini izchil saqlang.`,
    surxondaryo: `Matnni Surxondaryo viloyati shevasida yozing.
 
UMUMIY XUSUSIYAT:
Janubiy o'zbek shevalari guruhiga kiradi, qipchoq va qarluq unsurlari
aralash holda uchraydi. Dadil, keskin va tabiiy talaffuz xos.
 
FONETIK/MORFOLOGIK QOIDALAR:
- "-yapti" → "-ati"/"-yati": qilyapti → qilati
- "nima" → "nimala"
- "qayerga" → "qayoqqa"
- olmoshlarda "sen" → "san" izchil saqlanadi
- so'z oxiridagi "-di" ba'zan qisqaradi tez nutqda: keldi → keli
 
LEKSIKA VA IBORALAR:
- nimala — nima
- qayoqqa — qayerga
- da — gap oxirida ta'kid uchun tez-tez qo'shiladi
- xo'p-da — rozilik
- "netti" — nima qildi
 
NAMUNALAR:
Adabiy: "Nima qildi u, aytsang-chi?"
Surxondaryocha: "U netti o'zi, ayt-da!"
 
Adabiy: "Qayerga ketyapsan?"
Surxondaryocha: "Qayoqqa ketatisan?"
 
Adabiy: "Bu nima o'zi?"
Surxondaryocha: "Bu nimala o'zi?"
 
Nutq samimiy, dadil, tabiiy va janubga xos keskinroq ohangda bo'lsin.`,
    jizzax:
      `Matnni Jizzax viloyati shevasida yozing.
 
UMUMIY XUSUSIYAT:
Markaziy hudud shevasi — qipchoq va Toshkent-Sirdaryo shevalari
o'rtasidagi o'tish zonasi. Sodda va sof xalqona talaffuz xos.
 
FONETIK/MORFOLOGIK QOIDALAR:
- "-yapti" → "-atti"/"-otti": ketyapti → ketatti
- qipchoqcha "-atir" shakli qisman uchraydi, lekin Qashqadaryodagidek qat'iy emas
- "men/sen" → "man/san" so'zlashuvda
 
LEKSIKA VA IBORALAR:
- akasi, ukasi — sodda murojaat shakllari
- xo'p — rozilik, qisqa va sodda
- "netatti" — nima qilyapti
 
NAMUNALAR:
Adabiy: "U nima qilyapti hozir?"
Jizzaxcha: "U hozir netatti o'zi?"
 
Adabiy: "Xo'p, boraylik unda."
Jizzaxcha: "Xo'p-da, boraylik unda."
 
Nutq sodda, ravon, samimiy va tabiiy jizzaxcha ohangda, ortiqcha
bezaksiz yozilsin.`,

    sirdaryo: `Matnni Sirdaryo viloyati shevasida yozing.
 
UMUMIY XUSUSIYAT:
Toshkent va Jizzax shevalari orasidagi tabiiy o'tish zonasi. Sodda,
kundalik so'zlashuv uslubi ustunlik qiladi, ortiqcha sheva belgilari
kam, lekin xalqona ohang saqlanadi.
 
FONETIK/MORFOLOGIK QOIDALAR:
- "men/sen" → "man/san"
- "-yapti" → "-otti"/"-votti" (Toshkentga yaqin variant)
- so'zlashuvda tabiiy qisqarishlar uchraydi, lekin haddan tashqari emas
 
LEKSIKA VA IBORALAR:
- aka, uka — murojaatlar
- xo'p bo'ladi — rozilik
- "shunaqa-da" — tasdiq, ta'kid
 
NAMUNALAR:
Adabiy: "Bugun ishga bordim, charchadim."
Sirdaryocha: "Bugun ishga bordim-da, aka, charchab kettim."
 
Adabiy: "Xo'p, unda ertaga ko'rishamiz."
Sirdaryocha: "Xo'p bo'ladi, ertaga ko'rishamiz unda."
 
Nutq sodda, xalqona, samimiy va kundalik so'zlashuv uslubida, ortiqcha
murakkab sheva shakllarisiz yozilsin.`,
    navoiy: `Matnni Navoiy viloyati shevasida yozing.
 
UMUMIY XUSUSIYAT:
Markaziy-g'arbiy hudud shevasi — Buxoro va Samarqand shevalari ta'siri
hamda cho'l hududlariga xos xalqona talaffuz uyg'unlashadi.
 
FONETIK/MORFOLOGIK QOIDALAR:
- "men" → "man"; Buxoro-Samarqand ta'sirida ba'zan "maniyam" shakli ham uchraydi
- "-yapti" → "-vati"/"-otti" aralash holda, qat'iy bitta shakl yo'q
- so'zlashuvda unlilar biroz tor talaffuz qilinadi (Buxoro ta'siri)
 
LEKSIKA VA IBORALAR:
- jonim, akajon — erkalash murojaatlari (Buxoro ta'sirida)
- xo'p — rozilik
- "picha" — biroz (Buxorodan o'zlashgan)
 
NAMUNALAR:
Adabiy: "Biroz kutib turing, hozir boraman."
Navoiycha: "Picha kutib turing, hozir boraman jonim."
 
Adabiy: "Sen ham kelasanmi?"
Navoiycha: "San ham kelasanmi, a?"
 
Nutq ravon, tabiiy va samimiy, Buxoro-Samarqand nafosati bilan cho'l
hududlariga xos soddalik uyg'unlashgan holda yozilsin.`,
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
    dialectInstruction = "in the Tashkent urban dialect of Uzbek — brisk, confident city cadence; moderate-fast pace; warm conversational rising-falling intonation; friendly informal tone. Pronounce word endings with the characteristic Tashkent softening: '-yapti/-nadi' endings drift toward a drawn-out 'votti/yotti' sound (e.g. ketvotti, boshlanvotti), '-daman/-yapman' endings soften into 'vomman' (e.g. borvomman), and 'aka/uka' are pronounced as the rounded 'oka'; overall a fast, slightly clipped, melodic city rhythm";
  } else if (normDialect === "andijon") {
    dialectInstruction = "in the Andijon dialect of the Fergana Valley — soft, rounded vowels; slow-to-moderate pace with gentle pauses; warm rising intonation on polite address forms; highly polite, affectionate, deferential tone. Pronounce verb endings with valley softening: '-yapman' endings round into 'yappan' (e.g. boryappan), negative '-mayman' endings soften into 'miman' (e.g. bormiman), and 'bo'ldi' is pronounced as the softened 'bo'pti'; frequent gentle diminutive '-jon' suffix on names and address terms adds warmth to the melodic line";
  } else if (normDialect === "fargona") {
    dialectInstruction = "in the Farg'ona dialect of the Fergana Valley — extremely soft and unhurried articulation; slow pace with elongated, rounded vowels; smooth, gently undulating intonation without sharp pitch jumps; polite, courteous, warm tone. Pronoun forms 'men/sen' are pronounced as 'man/san'; word endings blend softly (e.g. borvati rather than a crisp borayapti); relaxed stress placement throughout, avoiding hard consonant emphasis";
  } else if (normDialect === "namangan") {
    dialectInstruction = "in the Namangan dialect of the Fergana Valley — distinctive quick pitch shifts within phrases; moderate-fast pace, livelier and more clipped rhythm than neighboring valley dialects; energetic rising intonation on emphasis words and question particles ('-mi' pronounced with strong stress); warm but brisker, more animated tone. Word-final vowels are often dropped in fast speech, and '-yapti' endings shift toward 'vati/oti' (e.g. borvati)";
  } else if (normDialect === "samarqand") {
    dialectInstruction = "in the Samarqand dialect — Tajik-Persian-influenced vowel rounding and softened consonants; moderate, measured pace; gently flowing, cultured intonation with subtle pitch dips at clause ends; refined, courteous, slightly formal urban tone. Distinctive Samarqand pronunciation markers: 'men ham' merges into 'maniyam', continuous-tense verb endings stretch into a Persian-influenced 'boraftasiz' pattern, and the past-participle sound softens toward 'rafta'; unhurried, cultured delivery throughout";
  } else if (normDialect === "buxoro") {
    dialectInstruction = "in the Buxoro dialect — Persian-influenced soft articulation, even more restrained and nasal-toned than Samarqand; slow, deliberate pace; calm, even intonation with minimal pitch variation; composed, elegant, classical tone. Distinctive Buxoro pronunciation markers: the greeting/question phrase 'chi gap' is used in place of 'nima gap' with a soft, drawn-out delivery, 'yaxshi/xo'p' rounds toward 'xo'b', and word-final '-man' endings are pronounced fully and evenly (ketaman, boraman) rather than clipped; unhurried, dignified delivery";
  } else if (normDialect === "xorazm") {
    dialectInstruction = "in the Xorazm (Khorezmian) dialect — distinct Oghuz-type accent, the most phonetically different Uzbek dialect; back-vowel coloring and a systematic k→g, q→g softening at the start of key verb roots; staccato, clipped rhythm with short punchy syllables; unique earlier word stress; direct, grounded tone. Distinctive Xorazm pronunciation markers: 'kel-' is pronounced as 'gal-' (galdi, galyapti), 'bor-' is pronounced as 'bar-' (bardi, baraman), '-yotibdi' endings clip to '-ipti' (yotipti, o'tiripti), and 'keling' is pronounced 'galing'";
  } else if (normDialect === "qashqadaryo") {
    dialectInstruction = "in the Qashqadaryo dialect — Kipchak-type accent with harder, clearer consonants; steady, moderate pace; firm, level intonation with little melodic rise; direct, plain-spoken, no-nonsense tone. Distinctive Qashqadaryo pronunciation markers: continuous/reported verb endings shift to a drawn-out '-atir' sound (baratirmiz instead of borayapmiz, atibdi instead of aytibdi), and the question form 'kelasizmi' contracts to the clipped 'kemasiz'; strong, even stress on verb endings throughout";
  } else if (normDialect === "surxondaryo") {
    dialectInstruction = "in the Surxondaryo dialect — deep, resonant chest voice quality; moderate-slow pace; robust, grounded intonation with confident downward phrase endings; warm but assertive rural southern tone. Distinctive Surxondaryo pronunciation markers: 'nima' is pronounced as the elongated 'nimala', 'qayerga' is pronounced as 'qayoqqa', and '-yapti' endings shorten toward '-ati/-yati'; strong, clear stress with a grounded, confident delivery";
  } else if (normDialect === "jizzax") {
    dialectInstruction = "in the Jizzax dialect — transitional accent between Tashkent and steppe Kipchak speech; moderate pace, plain and unadorned rhythm; even, understated intonation without strong pitch swings; simple, sincere, matter-of-fact tone. Pronoun forms 'men/sen' pronounced as 'man/san'; '-yapti' endings shift mildly toward '-atti/-otti' (ketatti), without the harder Qashqadaryo-style '-atir' contraction";
  } else if (normDialect === "sirdaryo") {
    dialectInstruction = "in the Sirdaryo dialect — transitional accent between Tashkent and Jizzax speech; moderate pace, close to conversational standard Uzbek; light, natural intonation with mild rural warmth; simple, friendly, everyday tone. '-yapti' endings soften mildly toward the Tashkent-adjacent 'otti/votti' without heavy contraction; overall plain, approachable delivery with minimal dialectal markers";
  } else if (normDialect === "navoiy") {
    dialectInstruction = "in the Navoiy dialect — blend of Buxoro-Samarqand softness with plainer steppe-region articulation; moderate pace; gently flowing intonation, less formal than Buxoro but softer than Jizzax; warm, unpretentious tone. Occasional Samarqand-style 'maniyam' (men ham) merging and Buxoro-influenced 'picha' (biroz) pronunciation appear naturally; overall soft, unhurried delivery without strong regional sharpness";
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
