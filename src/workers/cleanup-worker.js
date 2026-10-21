import "dotenv/config";
import { Bot } from "grammy";
import { BOT_TOKEN } from "../config/env.js";
import { initDailyCleanup } from "../services/cleanup-service.js";

const bot = BOT_TOKEN ? new Bot(BOT_TOKEN) : null;
console.log("[Cleanup Worker] Scheduler aktif, memantau jadwal jam 00:00 WIB...");
initDailyCleanup(bot);

// Keep process running
setInterval(() => {}, 1 << 30);
