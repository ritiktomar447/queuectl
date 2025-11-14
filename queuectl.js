#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { QueueManager } from './src/queueManager.js';
import { startWorkers } from './src/worker.js';
import { config } from './config/config.js';

const program = new Command();
const queue = new QueueManager();

program
  .name('queuectl')
  .description('A simple CLI-based background job queue system')
  .version('1.0.0');

// 🧩 ENQUEUE command
program
  .command('enqueue <command...>')
  .description('Add a new job to the queue (e.g. queuectl enqueue "echo hello")')
  .action((commandParts) => {
    const command = commandParts.join(' ');
    const job = queue.enqueue({ command });
    console.log(chalk.green(`🆕 Added job: ${job.id} → ${command}`));
  });

// 🧩 WORKER START command
program
  .command('worker:start')
  .option('--count <n>', 'Number of workers', '1')
  .description('Start one or more worker processes')
  .action(async (options) => {
    const count = parseInt(options.count);
    console.log(
      chalk.cyan(
        `Starting ${count} worker(s) — poll ${config.poll_interval_ms}ms backoff base ${config.backoff_base}`
      )
    );

    startWorkers(count);

    process.on('SIGINT', () => {
      console.log(chalk.yellow('\nGraceful shutdown requested — finishing current jobs...'));
      process.exit(0);
    });
  });

// 🧩 STATUS command
program
  .command('status')
  .description('Show summary of all job states')
  .action(() => {
    const jobs = queue.listByState(); // get all jobs
    const summary = {
      pending: jobs.filter(j => j.state === 'pending').length,
      processing: jobs.filter(j => j.state === 'processing').length,
      completed: jobs.filter(j => j.state === 'completed').length,
      dead: jobs.filter(j => j.state === 'dead').length,
    };

    console.log(chalk.blueBright('\n📊 Queue Status:'));
    for (const [key, val] of Object.entries(summary)) {
      console.log(`  ${key.padEnd(10)}: ${val}`);
    }
  });

// 🧩 LIST command
program
  .command('list <state>')
  .description('List jobs by state (pending, completed, dead)')
  .action((state) => {
    const jobs = queue.listByState(state);
    if (jobs.length === 0) {
      console.log(chalk.gray(`No jobs in state: ${state}`));
    } else {
      console.table(jobs.map(j => ({
        id: j.id,
        command: j.command,
        state: j.state,
        attempts: j.attempts,
      })));
    }
  });

// 🧩 DLQ LIST command
program
  .command('dlq:list')
  .description('List jobs in Dead Letter Queue')
  .action(() => {
    const jobs = queue.listDLQ();
    if (jobs.length === 0) {
      console.log(chalk.gray('🪦 No jobs in DLQ'));
    } else {
      console.table(jobs.map(j => ({
        id: j.id,
        command: j.command,
        attempts: j.attempts,
      })));
    }
  });

// 🧩 DLQ RETRY command
program
  .command('dlq:retry <jobId>')
  .description('Retry a job from DLQ')
  .action((jobId) => {
    const success = queue.retryFromDLQ(jobId);
    if (success) {
      console.log(chalk.green(`🔁 Retried job ${jobId} — moved back to pending`));
    } else {
      console.log(chalk.red('❌ Job not found in DLQ'));
    }
  });

program.parse(process.argv);
