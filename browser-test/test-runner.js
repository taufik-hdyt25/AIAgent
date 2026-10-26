#!/usr/bin/env node
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const arg = args.find((a) => a.startsWith(`--${name}=`));
  if (arg) return arg.split("=")[1];
  const flag = args.find((a) => a === `--${name}`);
  if (flag) return true;
  return fallback;
};

const targetUrl = getArg("url", "https://thstudio.web.id");
const testName = getArg("name", "page-test");
const shouldScreenshot = getArg("screenshot", true);
const isMobile = getArg("mobile", false);
const waitSelector = getArg("wait", null);
const sendToTelegram = getArg("telegram", false);

const screenshotsDir = path.join(__dirname, "screenshots");
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

// Auto cleanup files older than 24 hours (1 day)
function cleanupOldScreenshots(maxAgeMs = 24 * 60 * 60 * 1000) {
  try {
    if (!fs.existsSync(screenshotsDir)) return;
    const now = Date.now();
    const files = fs.readdirSync(screenshotsDir);
    for (const file of files) {
      const filePath = path.join(screenshotsDir, file);
      try {
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > maxAgeMs) {
          fs.unlinkSync(filePath);
        }
      } catch (_) {}
    }
  } catch (_) {}
}

cleanupOldScreenshots();

async function runBrowserTest() {
  const result = {
    url: targetUrl,
    timestamp: new Date().toISOString(),
    status: "UNKNOWN",
    httpStatus: null,
    loadTimeMs: 0,
    title: "",
    errors: [],
    warnings: [],
    failedRequests: [],
    screenshots: {},
  };

  const startTime = Date.now();
  let browser = null;

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--single-process",
        "--no-zygote",
      ],
    });

    const context = await browser.newContext(
      isMobile
        ? {
            viewport: { width: 390, height: 844 },
            userAgent:
              "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1",
            isMobile: true,
            hasTouch: true,
          }
        : {
            viewport: { width: 1280, height: 800 },
          }
    );

    const page = await context.newPage();

    // Catch console logs & errors
    page.on("console", (msg) => {
      const type = msg.type();
      const text = msg.text();
      if (type === "error") {
        result.errors.push(`[Console Error] ${text}`);
      } else if (type === "warning") {
        result.warnings.push(`[Console Warning] ${text}`);
      }
    });

    // Catch unhandled page errors
    page.on("pageerror", (err) => {
      result.errors.push(`[Page Crash/Error] ${err.message}`);
    });

    // Catch failed network requests
    page.on("requestfailed", (req) => {
      const failure = req.failure();
      result.failedRequests.push({
        url: req.url(),
        method: req.method(),
        errorText: failure ? failure.errorText : "Failed",
      });
    });

    // Catch HTTP response status
    page.on("response", (res) => {
      if (res.url() === targetUrl || res.url() === `${targetUrl}/`) {
        result.httpStatus = res.status();
      } else if (res.status() >= 400 && !res.url().includes("favicon")) {
        result.failedRequests.push({
          url: res.url(),
          status: res.status(),
          statusText: res.statusText(),
        });
      }
    });

    // Navigate with 25s timeout
    const response = await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 25000,
    });

    if (response && !result.httpStatus) {
      result.httpStatus = response.status();
    }

    // Wait for network idle or optional selector
    if (waitSelector) {
      await page.waitForSelector(waitSelector, { timeout: 5000 }).catch(() => {});
    } else {
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    }

    result.loadTimeMs = Date.now() - startTime;
    result.title = await page.title();

    // Check if the page is an error page
    const bodyText = await page.innerText("body").catch(() => "");
    if (bodyText.includes("This page couldn’t load") || bodyText.includes("Internal Server Error")) {
      result.errors.push("Detected application error message on page content.");
    }

    let savedScreenshotPath = null;
    // Take screenshot if enabled
    if (shouldScreenshot) {
      const timestampStr = Date.now();
      const filename = `${testName}-${isMobile ? "mobile" : "desktop"}-${timestampStr}.png`;
      savedScreenshotPath = path.join(screenshotsDir, filename);

      await page.screenshot({ path: savedScreenshotPath, fullPage: false });
      result.screenshots[isMobile ? "mobile" : "desktop"] = savedScreenshotPath;
    }

    result.status = result.errors.length === 0 && (result.httpStatus < 400 || !result.httpStatus) ? "PASSED" : "FAILED";

    // Optional Telegram send
    if (sendToTelegram && savedScreenshotPath) {
      try {
        const envPath = path.join("/home/ubuntu/.th-agent/.env");
        if (fs.existsSync(envPath)) {
          const env = fs.readFileSync(envPath, "utf-8");
          const tokenMatch = env.match(/BOT_TOKEN=([^\r\n]+)/);
          const idsMatch = env.match(/ALLOWED_TELEGRAM_IDS=([^\r\n]+)/);
          if (tokenMatch && idsMatch) {
            const botToken = tokenMatch[1].trim();
            const chatId = idsMatch[1].split(",")[0].trim();
            const caption = `📸 Screenshot: ${targetUrl} (${result.status} in ${result.loadTimeMs}ms)`;
            execSync(`curl -s -F chat_id=${chatId} -F photo=@${savedScreenshotPath} -F caption="${caption}" https://api.telegram.org/bot${botToken}/sendPhoto`);
          }
        }
      } catch (_) {}
    }
  } catch (err) {
    result.status = "ERROR";
    result.errors.push(err.message);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }

  console.log(JSON.stringify(result, null, 2));
}

runBrowserTest();
