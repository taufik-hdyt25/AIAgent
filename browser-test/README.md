# Headless Browser Testing for TH Agent

Autonomous headless Chromium testing suite for visual verification, console error capturing, HTTP status inspection, and Telegram screenshot dispatch.

## Features
- Ultra-lightweight Chromium Headless Shell (uses only ~150MB-200MB RAM during test, zero zombie processes)
- Supports Desktop and Mobile viewports (iPhone / Android emulation)
- Captures console errors, page crashes, failed network requests
- Optional instant screenshot dispatch to Telegram via `--telegram` flag
- Built-in automatic cleanup for screenshot artifacts older than 24 hours

## Usage
```bash
# Basic desktop test
node browser-test/test-runner.js --url=https://yourdomain.com

# Mobile viewport test
node browser-test/test-runner.js --url=https://yourdomain.com --mobile

# Test and send screenshot to Telegram
node browser-test/test-runner.js --url=https://yourdomain.com --telegram
```
