// src/queueManager.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import { loadJobs, saveJobs, loadDLQ, saveDLQ } from "./storage.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class QueueManager {
  constructor() {
    // nothing to init here; storage handles files
  }

  _allJobs() {
    return loadJobs();
  }
  _saveAll(jobs) {
    saveJobs(jobs);
  }

  enqueue(jobPartial) {
    const now = new Date().toISOString();
    const job = {
      id: jobPartial.id || uuidv4(),
      command: jobPartial.command,
      state: jobPartial.state || "pending",
      attempts: jobPartial.attempts || 0,
      max_retries: jobPartial.max_retries !== undefined ? jobPartial.max_retries : loadJobsDefaultMaxRetries(),
      created_at: jobPartial.created_at || now,
      updated_at: now,
      available_at: jobPartial.available_at || null,
      last_error: jobPartial.last_error || null,
    };
    const jobs = this._allJobs();
    jobs.push(job);
    this._saveAll(jobs);
    return job;
  }

  // find and claim next available pending job (simple atomic-ish for single-process)
  claimNextAvailable() {
    const jobs = this._allJobs();
    const nowMs = Date.now();
    for (let i = 0; i < jobs.length; i++) {
      const j = jobs[i];
      if (j.state === "pending") {
        if (!j.available_at || j.available_at <= nowMs) {
          j.state = "processing";
          j.attempts = (j.attempts || 0) + 1; // increment on claim
          j.updated_at = new Date().toISOString();
          this._saveAll(jobs);
          return j;
        }
      }
    }
    return null;
  }

  markCompleted(jobId, output) {
    const jobs = this._allJobs();
    const idx = jobs.findIndex(j=> j.id === jobId);
    if (idx !== -1) {
      jobs[idx].state = "completed";
      jobs[idx].updated_at = new Date().toISOString();
      jobs[idx].last_output = output;
      this._saveAll(jobs);
    }
  }

  scheduleRetryOrDLQ(jobId, errMsg, backoffBase) {
    const jobs = this._allJobs();
    const i = jobs.findIndex(j => j.id === jobId);
    if (i === -1) return;
    const job = jobs[i];
    job.last_error = errMsg;
    job.updated_at = new Date().toISOString();
    // attempts already incremented at claim
    if (job.attempts > job.max_retries) {
      // move to DLQ
      job.state = "dead";
      // remove from jobs and add to dlq
      jobs.splice(i,1);
      this._saveAll(jobs);
      const dlq = loadDLQ();
      dlq.push(job);
      saveDLQ(dlq);
      return { moved: true };
    } else {
      // schedule next available_at using exponential backoff
      const delaySec = Math.pow(backoffBase, job.attempts);
      job.state = "pending";
      job.available_at = Date.now() + delaySec * 1000;
      this._saveAll(jobs);
      return { moved: false, delaySec };
    }
  }

  listByState(state) {
    const jobs = this._allJobs();
    if (!state) return jobs;
    return jobs.filter(j => j.state === state);
  }

  getJob(jobId) {
    return this._allJobs().find(j=> j.id === jobId) || null;
  }

  // DLQ functions
  listDLQ() { return loadDLQ(); }
  retryFromDLQ(jobId) {
    const dlq = loadDLQ();
    const idx = dlq.findIndex(j=> j.id === jobId);
    if (idx === -1) return false;
    const job = dlq[idx];
    job.state = "pending";
    job.attempts = 0;
    job.available_at = null;
    job.updated_at = new Date().toISOString();
    dlq.splice(idx,1);
    saveDLQ(dlq);
    const jobs = this._allJobs();
    jobs.push(job);
    this._saveAll(jobs);
    return true;
  }
}

// helper to pick default max_retries from config file if present
function loadJobsDefaultMaxRetries() {
  try {
    const cfgPath = path.join(__dirname, "../config/config.json");
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
      if (cfg.max_retries !== undefined) return cfg.max_retries;
    }
  } catch(e){}
  return 3;
}
