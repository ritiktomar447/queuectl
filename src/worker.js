// src/worker.js
import { exec } from "child_process";
import chalk from "chalk";
import { QueueManager } from "./queueManager.js";
import { loadConfig } from "./storage.js"; // note: storage.loadConfig exported earlier

// We'll keep workers in same process; to spawn N workers we will create N intervals
let workerTimers = [];
let shuttingDown = false;

const queue = new QueueManager();

function execCommand(command, timeoutMs = 60_000) {
  return new Promise((resolve) => {
    const child = exec(command, { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        // return exit code and stderr
        const code = error.code !== undefined ? error.code : 1;
        resolve({ success: false, code, stdout: stdout || "", stderr: stderr || error.message });
      } else {
        resolve({ success: true, code: 0, stdout: stdout || "", stderr: stderr || "" });
      }
    });
  });
}

export function startWorkers(count = 1) {
  shuttingDown = false;
  const cfg = loadConfig();
  const poll = cfg.poll_interval_ms || 2000;
  const backoffBase = cfg.backoff_base || 2;

  console.log(chalk.green(`Starting ${count} worker(s) — poll ${poll}ms backoff base ${backoffBase}`));

  for (let i = 1; i <= count; i++) {
    const wid = `worker-${i}`;
    const timer = setInterval(async () => {
      if (shuttingDown) return;
      try {
        const job = queue.claimNextAvailable();
        if (!job) {
          // nothing to do
          return;
        }
        console.log(chalk.yellow(`[${wid}] Claimed ${job.id} | cmd: ${job.command} | attempts: ${job.attempts}/${job.max_retries}`));
        // execute
        const result = await execCommand(job.command);
        if (result.success && result.code === 0) {
          queue.markCompleted(job.id, result.stdout);
          console.log(chalk.green(`[${wid}] Job ${job.id} completed`));
        } else {
          const errMsg = `exit:${result.code}; ${result.stderr || result.stdout}`;
          const res = queue.scheduleRetryOrDLQ(job.id, errMsg, backoffBase);
          if (res.moved) {
            console.log(chalk.magenta(`[${wid}] Job ${job.id} moved to DLQ after ${job.attempts} attempts`));
          } else {
            console.log(chalk.gray(`[${wid}] Job ${job.id} scheduled to retry in ${res.delaySec}s (attempt ${job.attempts}/${job.max_retries})`));
          }
        }
      } catch (e) {
        console.error("Worker loop error:", e);
      }
    }, poll);
    workerTimers.push(timer);
  }

  // graceful shutdown handlers
  process.on("SIGINT", gracefulShutdown);
  process.on("SIGTERM", gracefulShutdown);
}

export function stopWorkers() {
  shuttingDown = true;
  for (const t of workerTimers) clearInterval(t);
  workerTimers = [];
  console.log(chalk.yellow("Workers stopped (stopWorkers called)."));
}

async function gracefulShutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(chalk.yellow("Graceful shutdown requested — waiting for current work to finish..."));
  for (const t of workerTimers) clearInterval(t);
  workerTimers = [];
  // we don't have active child handles to wait here; since child execution is short,
  // wait a bit to let any running child finish:
  await new Promise(r => setTimeout(r, 1500));
  console.log(chalk.yellow("Shutdown complete."));
  process.exit(0);
}
