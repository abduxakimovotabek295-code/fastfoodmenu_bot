/**
 * bot.js
 * Node.js single-file Telegram bot with 10 features:
 * 1) JSON user database
 * 2) Multiple admins
 * 3) /users command (stats)
 * 4) /help menu
 * 5) Admin reply by @@ID or @username
 * 6) Broadcast with media (photo, video, document)
 * 7) Inline buttons (example retained, but main menu is now Reply Keyboard)
 * 8) Forward tracking
 * 9) Scheduled announcements
 * 10) Anti-spam & simple FAQ auto-reply
 *
 * Required packages:
 * npm i node-telegram-bot-api
 *
 * Run:
 * node bot.js
 */

const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const path = require("path");

// === CONFIGURE === //
const TOKEN = "8155964283:AAFgwyG6r35FFKcr_B1i3x8RTB57JFKyk5k"; // <-- o'zgartiring
const ADMINS = [7397994103 /*, boshqa admin id lar qo'shish */]; // <-- admin id larini qo'shing
const USERS_FILE = path.join(__dirname, "users.json");
const SCHEDULE_FILE = path.join(__dirname, "schedules.json");
const SPAM_WINDOW_MS = 60 * 1000; // 1 daqiqa oynasi
const SPAM_LIMIT = 6; // shu oynada ruxsat etilgan xabarlar soni
// ================== //

const bot = new TelegramBot(TOKEN, { polling: true });

// In-memory caches (saqlash bilan birga)
let users = loadJSON(USERS_FILE, {});
let schedules = loadJSON(SCHEDULE_FILE, []);

// Anti-spam map: id -> [timestamps]
const messageTimes = new Map();

// --- YANGI REPLY KEYBOARD TUGMALARI (Rasmga mos) ---
const REPLY_KEYBOARD = [
  ["Bosphorus Menu", "Baklava Sovg'a"],
  ["Lokaciya / Kontaktlar", "Bizga Baho Bering"],
  ["Instagram", "Stol Bron Qiling"],
];

// Simple FAQ (kalit so'z -> javob)
const FAQ = [
  {
    keys: ["narx", "price"],
    resp: "📌 Kurs narxi: 100 000 so'm (1 oy). Batafsil so'rang yoki /contact bilan bog'laning.",
  },
  {
    keys: ["qachon", "vaqt", "when"],
    resp: "🕒 Darslar dushanbadan jumagacha, soat 18:00 da boshlanadi.",
  },
  {
    keys: ["manzil", "address"],
    resp: "📍 Manzil: Namangan shahri, Boborahim Mashrab ko'chasi, 12-uy.",
  },
];

// Helper: load JSON safe
function loadJSON(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2));
      return fallback;
    }
    const data = fs.readFileSync(filePath, "utf8");
    return JSON.parse(data || JSON.stringify(fallback));
  } catch (err) {
    console.error("JSON load error:", err);
    return fallback;
  }
}

function saveJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("JSON save error:", err);
  }
}

// Add or update user in DB
function addUser(msg) {
  const chatId = String(msg.chat.id);
  const username = msg.from.username || null;
  const first_name = msg.from.first_name || "";
  const last_name = msg.from.last_name || "";
  const now = new Date().toISOString();

  if (!users[chatId]) {
    users[chatId] = {
      id: chatId,
      username,
      first_name,
      last_name,
      first_seen: now,
      last_seen: now,
      messages: 0,
      forwarded_from: [],
    };
    console.log("✅ Foydalanuvchi qo'shildi:", chatId, username);
  } else {
    users[chatId].username = username;
    users[chatId].last_seen = now;
  }
  saveJSON(USERS_FILE, users);
}

// Anti-spam check: returns true if allowed, false if spam
function checkSpam(chatId) {
  const id = String(chatId);
  const now = Date.now();
  if (!messageTimes.has(id)) messageTimes.set(id, []);
  const arr = messageTimes.get(id);

  // remove old timestamps
  while (arr.length && now - arr[0] > SPAM_WINDOW_MS) arr.shift();

  arr.push(now);
  messageTimes.set(id, arr);

  if (arr.length > SPAM_LIMIT) return false;
  return true;
}

// Check if sender is admin
function isAdmin(id) {
  return ADMINS.includes(Number(id));
}

// Build /help text
function getHelpText(isAdminUser = false) {
  let text = `🤖 Bot yordamchi menyusi\n\nFoydali buyruqlar:\n`;
  text += `/help - yordam menyusi\n`;
  text += `/start - botni ishga tushirish (asosiy menyuni ko'rsatadi)\n`;
  text += `/menu - asosiy menyuni (tugmalarni) ko'rsatish\n`;
  text += `/contact - admin bilan bog'lanish\n\n`;
  if (isAdminUser) {
    text += `Admin buyruqlari:\n`;
    text += `/users - foydalanuvchilar statistikasi\n`;
    text += `Siz admin sifatida: @@ID yoki @username yordamida javob yuborishingiz mumkin.\n`;
    text += `E'lon yuborish uchun faqat matn yuboring yoki media yuboring (rasm/video/pdf).\n`;
    text += `!schedule YYYY-MM-DD HH:MM matn - rejalashtirish uchun\n`;
  }
  return text;
}

// Send broadcast (supports text or media)
async function broadcastFromAdmin(adminChatId, message) {
  // message may be a message object with media
  // If message contains photo/video/document etc., forward to users
  const entries = Object.values(users);
  for (const u of entries) {
    try {
      if (message.photo || message.video || message.document || message.audio) {
        // forward full message to keep media
        await bot.forwardMessage(u.id, adminChatId, message.message_id);
      } else {
        // text broadcast
        await bot.sendMessage(u.id, `📢 *E'lon:*\n${message.text || ""}`, {
          parse_mode: "Markdown",
        });
      }
    } catch (err) {
      // ignore errors for blocked users, but optionally log
      // console.error("Broadcast error to", u.id, err.message);
    }
  }
  bot.sendMessage(adminChatId, "📡 E'lon barcha foydalanuvchilarga yuborildi!");
}

// Schedule runner: check every 30s
setInterval(async () => {
  const now = new Date();
  const due = schedules.filter((s) => new Date(s.when) <= now && !s.sent);
  for (const s of due) {
    // send to all users
    for (const uid of Object.keys(users)) {
      try {
        if (s.type === "text") {
          await bot.sendMessage(
            uid,
            `📢 *Rejalashtirilgan e'lon:*\n${s.text}`,
            { parse_mode: "Markdown" }
          );
        } else if (s.type === "forward" && s.from && s.message_id) {
          await bot.forwardMessage(uid, s.from, s.message_id);
        }
      } catch (err) {
        // ignore send errors
      }
    }
    s.sent = true;
    s.sent_at = new Date().toISOString();
    saveJSON(SCHEDULE_FILE, schedules);
    console.log("📅 Rejalashtirilgan e'lon yuborildi:", s.id);
  }
}, 30 * 1000);

// Generate small unique id for schedules
function genId() {
  return Math.random().toString(36).slice(2, 9);
}

// --- YANGI JAVOB KLAVIATURASINI YUBORISH FUNKSIYASI ---
function sendReplyKeyboard(chatId, text = "Asosiy menyuni tanlang:") {
  const opts = {
    reply_markup: {
      keyboard: REPLY_KEYBOARD,
      resize_keyboard: true, // Tugmalarni kichraytirish
      one_time_keyboard: false, // Doimiy ko'rinishda qoldirish
    },
  };
  bot.sendMessage(chatId, text, opts);
}

// Inline keyboard example handler (eski funksiya nomi, endi Reply Keyboard asosiy menyu bo'ldi)
// Bu endi ichki inline tugmalar misoli uchun qoldi, asosiy menyu emas.
function sendExampleInline(chatId) {
  const opts = {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "Ro'yxatdan o'tish (Inline)",
            callback_data: "action_register",
          },
        ],
        [{ text: "Bog'lanish (Link)", url: "https://t.me/telegram_id" }], // Admin ID o'rniga namuna
      ],
    },
  };
  bot.sendMessage(chatId, "Quyidagi inline tugmalardan foydalaning:", opts);
}

// Process admin command to schedule
async function handleScheduleCommand(adminId, text, msg) {
  // Format: !schedule 2025-12-31 20:30 Matn...
  const parts = text.split(" ");
  if (parts.length < 3) {
    bot.sendMessage(adminId, "❗ Format: !schedule YYYY-MM-DD HH:MM matn");
    return;
  }
  const datePart = parts[1];
  const timePart = parts[2];
  const whenStr = `${datePart} ${timePart}`;
  const when = new Date(whenStr);
  if (isNaN(when)) {
    bot.sendMessage(
      adminId,
      "❗ Sana/vaqt noto'g'ri. Misol: !schedule 2025-12-31 20:30 Xabar matni"
    );
    return;
  }
  const textPart = parts.slice(3).join(" ");
  const item = {
    id: genId(),
    type: "text",
    when: when.toISOString(),
    text: textPart,
    created_by: adminId,
    created_at: new Date().toISOString(),
    sent: false,
  };
  schedules.push(item);
  saveJSON(SCHEDULE_FILE, schedules);
  bot.sendMessage(
    adminId,
    `📆 E'lon ${when.toISOString()} ga rejalashtirildi (ID: ${item.id})`
  );
}

// Message handler
bot.on("message", async (msg) => {
  try {
    const chatId = msg.chat.id;
    const text = msg.text || "";
    const fromId = msg.from.id;

    // Track forwarded_from if message is forwarded
    if (msg.forward_from_chat || msg.forward_from) {
      // store forwarded origin for stats
      addUser(msg);
      const uid = String(chatId);
      if (!users[uid].forwarded_from) users[uid].forwarded_from = [];
      users[uid].forwarded_from.push({
        date: new Date().toISOString(),
        from: msg.forward_from_chat
          ? msg.forward_from_chat.title
          : msg.forward_from
          ? `${msg.forward_from.first_name}`
          : "unknown",
      });
      saveJSON(USERS_FILE, users);
    }

    // Add/update user
    addUser(msg);
    users[String(chatId)].messages += 1;
    saveJSON(USERS_FILE, users);

    // Anti-spam
    if (!checkSpam(chatId)) {
      // warn user or temporarily block
      bot.sendMessage(
        chatId,
        "⚠️ Siz juda tez-tez xabar yuboryapsiz. Iltimos, biroz kuting."
      );
      return;
    }

    // --- ASOSIY BUYRUQLAR VA MENYU ---

    // /start
    if (text === "/start") {
      sendReplyKeyboard(
        chatId,
        "🤖 Assalomu alaykum! Botga xush kelibsiz. Quyidagi menyu tugmalaridan birini tanlang."
      );
      return;
    }

    // /menu
    if (text === "/menu") {
      sendReplyKeyboard(chatId);
      return;
    }

    // /help
    if (text === "/help") {
      bot.sendMessage(chatId, getHelpText(isAdmin(fromId)), {
        parse_mode: "Markdown",
      });
      return;
    }

    // /contact
    if (text === "/contact") {
      const adm = ADMINS[0];
      let admDisplay = adm ? `@admin` : "admin";
      bot.sendMessage(
        chatId,
        `Admin bilan bog'lanish: ${admDisplay}\nAgar shaxsiy muammo bo'lsa, botga xabar yuboring va adminlar ko'radi.`
      );
      return;
    }

    // --- REPLY KEYBOARD TUGMALARIGA JAVOB BERISH MANTIQI ---
    switch (text) {
      case "Bosphorus Menu":
        bot.sendMessage(
          chatId,
          "🍽 Bosphorus Menu bo'limi. Menyu havolasini yuboring."
        );
        break;
      case "Baklava Sovg'a":
        bot.sendMessage(
          chatId,
          "🎁 Maxsus Baklava Sovg'a takliflari haqida ma'lumot olish uchun admin bilan bog'laning."
        );
        break;
      case "Lokaciya / Kontaktlar":
        bot.sendMessage(
          chatId,
          "📍 Lokatsiya: [Manzil yuboring] \n📞 Kontaktlar: +998 xx xxx xx xx"
        );
        break;
      case "Bizga Baho Bering":
        bot.sendMessage(
          chatId,
          "⭐️ Xizmatimizga baho berish uchun ushbu havoladan foydalaning: [Baho berish havolasi]"
        );
        break;
      case "Instagram":
        bot.sendMessage(
          chatId,
          "📸 Bizning Instagram sahifamiz: [Instagram havolasi]"
        );
        break;
      case "Stol Bron Qiling":
        bot.sendMessage(
          chatId,
          "📝 Stol band qilish uchun: Iltimos, ismingizni, telefon raqamingizni va vaqtni yuboring."
        );
        break;
      default:
        // Agar tanish buyruq yoki menyu tugmasi bo'lmasa, pastga tushib boshqa logikalarni tekshiradi
        break;
    }
    // --- REPLY KEYBOARD TUGMALARIGA JAVOB BERISH MANTIQI TUGADI ---

    // Admin only commands
    if (isAdmin(fromId)) {
      // /users -> statistikalar
      if (text === "/users") {
        const total = Object.keys(users).length;
        const active = Object.values(users).filter(
          (u) =>
            new Date(u.last_seen) > new Date(Date.now() - 30 * 24 * 3600 * 1000)
        ).length;
        const msgText = `📊 Foydalanuvchilar statistikasi:\nJami: ${total}\nOxirgi 30 kunda aktív: ${active}`;
        bot.sendMessage(chatId, msgText);
        return;
      }

      // !schedule command
      if (text.startsWith("!schedule ")) {
        await handleScheduleCommand(chatId, text, msg);
        return;
      }

      // Send example inline (old functionality for inline buttons)
      if (text === "/inline") {
        sendExampleInline(chatId);
        return;
      }

      // ADMIN reply by ID: @@123456789
      const idMatch = text.match(/@@(\d{5,})\b/);
      if (idMatch) {
        const targetId = idMatch[1];
        const msgToSend =
          text.replace(`@@${targetId}`, "").trim() || "(Admindan xabar)";
        try {
          if (msg.photo || msg.video || msg.document) {
            // if admin included media, forward message instead
            await bot.forwardMessage(targetId, chatId, msg.message_id);
          } else {
            await bot.sendMessage(
              targetId,
              `💼 *Admin javobi:*\n${msgToSend}`,
              { parse_mode: "Markdown" }
            );
          }
          bot.sendMessage(chatId, `📤 Xabar ID ${targetId} ga yuborildi.`);
        } catch (err) {
          bot.sendMessage(
            chatId,
            `❗ Xatolik: foydalanuvchi topilmadi yoki block qilgan. ${err.message}`
          );
        }
        return;
      }

      // ADMIN reply by username: @username (first matched)
      const unameMatch = text.match(/@([A-Za-z0-9_]+)\b/);
      if (unameMatch) {
        const uname = unameMatch[1];
        const user = Object.values(users).find(
          (u) => u.username && u.username.toLowerCase() === uname.toLowerCase()
        );
        if (user) {
          const msgToSend =
            text.replace(`@${uname}`, "").trim() || "(Admindan xabar)";
          try {
            if (msg.photo || msg.video || msg.document) {
              await bot.forwardMessage(user.id, chatId, msg.message_id);
            } else {
              await bot.sendMessage(
                user.id,
                `💼 *Admin javobi:*\n${msgToSend}`,
                { parse_mode: "Markdown" }
              );
            }
            bot.sendMessage(chatId, `📬 Xabar @${uname} ga yuborildi.`);
          } catch (err) {
            bot.sendMessage(chatId, `❗ Xatolik: ${err.message}`);
          }
          return;
        } else {
          // If no matching username found and admin sent only text without @ usage, treat as broadcast
          // but admin probably expected user not found
          bot.sendMessage(chatId, `⚠️ Username @${uname} topilmadi.`);
          return;
        }
      }

      // Broadcast to all (admin sends a message without special markers)
      // If admin sends media we forward; if text -> send formatted broadcast
      if (msg.photo || msg.video || msg.document || msg.audio) {
        await broadcastFromAdmin(chatId, msg);
        return;
      }
      if (text && !text.startsWith("/")) {
        // if admin typed plain text, broadcast as announcement
        await broadcastFromAdmin(chatId, msg);
        return;
      }
    }

    // Non-admin users: check for FAQ keywords (auto-reply)
    const lowered = text.toLowerCase();
    for (const item of FAQ) {
      for (const k of item.keys) {
        if (lowered.includes(k)) {
          bot.sendMessage(chatId, item.resp);
          return;
        }
      }
    }

    // If user sends "buttons" keyword, show reply keyboard
    if (
      lowered.includes("tugma") ||
      lowered.includes("button") ||
      lowered.includes("menu")
    ) {
      sendReplyKeyboard(chatId); // Asosiy menyu
      return;
    }

    // Default reply to user: accept message and forward to admins
    // Notify admins with message details and quick reply hints
    for (const admin of ADMINS) {
      try {
        await bot.sendMessage(
          admin,
          `📩 Yangi xabar!\n👤 ${
            msg.from.first_name || ""
          }\n🆔 ID: ${chatId}\n🌐 Username: @${
            msg.from.username || "mavjud emas"
          }\n✉️ ${
            text || "(media/xabar)"
          }\n\nJavob:\n• ID orqali: @@${chatId}\n• Username orqali: @${
            msg.from.username || "mavjud emas"
          }`,
          { parse_mode: "Markdown" }
        );
        // if message contains media, also forward one of the admins to see it
        if (msg.photo || msg.video || msg.document || msg.audio) {
          await bot.forwardMessage(admin, chatId, msg.message_id);
        }
      } catch (err) {
        // ignore
      }
    }

    // Acknowledge user
    await bot.sendMessage(
      chatId,
      "📥 Murojaatingiz qabul qilindi! Tez orada adminlar javob beradi."
    );
  } catch (err) {
    console.error("Message handler error:", err);
  }
});

// Callback query (inline buttons) handler (Bu qism o'zgarmadi, inline tugmalar ishlashi uchun kerak)
bot.on("callback_query", async (cb) => {
  try {
    const data = cb.data;
    const from = cb.from;
    if (data === "action_register") {
      await bot.answerCallbackQuery(cb.id, {
        text: "Siz ro'yxatdan o'tdingiz!",
      });
      // do registration action or store intent
      addUser({ chat: { id: from.id }, from });
      bot.sendMessage(
        from.id,
        "✅ Ro'yxatdan o'tishingiz qabul qilindi. Tez orada admin bilan bog'lanamiz."
      );
    } else {
      await bot.answerCallbackQuery(cb.id, { text: "Tugma bosildi." });
    }
  } catch (err) {
    // ignore
  }
});

// Graceful shutdown save
process.on("SIGINT", () => {
  console.log("SIGINT, saqlanmoqda...");
  saveJSON(USERS_FILE, users);
  saveJSON(SCHEDULE_FILE, schedules);
  process.exit();
});
process.on("SIGTERM", () => {
  console.log("SIGTERM, saqlanmoqda...");
  saveJSON(USERS_FILE, users);
  saveJSON(SCHEDULE_FILE, schedules);
  process.exit();
});

console.log("Bot ishga tushdi...");
