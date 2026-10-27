import { loadConfig } from './config.js';
import { createBackend } from './server.js';

async function main() {
  const config = loadConfig();
  const backend = createBackend(config, { reportError: entry => console.error(JSON.stringify(entry)) });
  try { await backend.listen(); } catch { console.error('LISTEN_FAILED'); process.exitCode = 1; await backend.close(); return; }
  console.log('Naufragio VTT: HTTP ready (phase 3)');
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 5000);
    deadline.unref();
    await backend.close();
    clearTimeout(deadline);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch(() => { console.error('STARTUP_FAILED: check configuration'); process.exitCode = 1; });
