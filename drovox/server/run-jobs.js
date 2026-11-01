// Runs every background automation once and exits. For shared hosting, schedule it with cron, e.g. every 10 minutes:
//   */10 * * * * cd ~/drovox && /path/to/node --no-warnings server/run-jobs.js >> ~/drovox/data/jobs.log 2>&1
import { JOBS, runJob } from './services/jobs.js';
import { getSetting, setSetting } from './db.js';

// Remember when the slow jobs (daily digest, follow-ups) last ran so they keep their own interval.
const last = getSetting('job_last_run') || {};
for (const [name, j] of Object.entries(JOBS)) {
  const prev = last[name] ? Date.parse(last[name]) : 0;
  if (Date.now() - prev < j.every_min * 60e3 - 60e3) continue;
  const r = runJob(name);
  last[name] = r.last_run;
  console.log(new Date().toISOString(), name, r.ok ? 'ok' : 'FAILED', r.result);
}
setSetting('job_last_run', last);
