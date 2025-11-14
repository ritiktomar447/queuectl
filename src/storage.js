// src/storage.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const JOBS_FILE = path.join(__dirname, "../jobs/jobs.json");
const DLQ_FILE = path.join(__dirname, "../jobs/dlq.json");
const CONFIG_FILE = path.join(__dirname, "../config/config.json");

function readJson(file, fallback) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
    return fallback;
  }
  const txt = fs.readFileSync(file, "utf8");
  try { return JSON.parse(txt || "null") || fallback; }
  catch (e) { return fallback; }
}
function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

export function initFiles() {
  readJson(JOBS_FILE, []);
  readJson(DLQ_FILE, []);
  readJson(CONFIG_FILE, { max_retries: 3, backoff_base: 2, poll_interval_ms: 2000 });
}

export function loadJobs() {
  return readJson(JOBS_FILE, []);
}
export function saveJobs(jobs) {
  writeJson(JOBS_FILE, jobs);
}

export function loadDLQ() {
  return readJson(DLQ_FILE, []);
}
export function saveDLQ(dlq) {
  writeJson(DLQ_FILE, dlq);
}

export function loadConfig() {
  return readJson(CONFIG_FILE, { max_retries: 3, backoff_base: 2, poll_interval_ms: 2000 });
}
export function saveConfig(cfg) {
  writeJson(CONFIG_FILE, cfg);
}
