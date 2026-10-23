const path = require("path");
const isMac = process.platform === "darwin";

const apps = [
  {
    name: "telegram-coding-agent",
    script: "./src/bot.js",
    cwd: __dirname,
    instances: 1,
    exec_mode: "fork",
    autorestart: true,
    max_restarts: 100,
    min_uptime: "10s",
    restart_delay: 3000,
    kill_timeout: 10000,
    time: true,
    out_file: path.join(__dirname, "logs/out.log"),
    error_file: path.join(__dirname, "logs/error.log"),
    merge_logs: true,
    env: {
      NODE_ENV: "production"
    }
  }
];

// Khusus macOS: Caffeinate untuk menjaga CPU & Wi-Fi aktif saat layar mati
if (isMac) {
  apps.push({
    name: "keep-awake",
    script: "/usr/bin/caffeinate",
    args: "-ims",
    instances: 1,
    exec_mode: "fork",
    autorestart: true,
    max_restarts: 100,
    min_uptime: "10s",
    restart_delay: 3000,
    time: true,
    env: {
      NODE_ENV: "production"
    }
  });
}

module.exports = { apps };
