const path = require("path");

module.exports = {
  apps: [
    {
      name: "telegram-coding-agent",
      script: "./src/bot.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
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
  ]
};
