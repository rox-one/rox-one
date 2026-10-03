import { pathToFileURL } from 'node:url';
const { runHostBash } = await import(pathToFileURL(process.env.HOST_BASH_MODULE!).href);
const result = await runHostBash({ cwd: process.env.HOST_BASH_PROBE_ROOT!, command: process.env.HOST_BASH_PROBE_COMMAND!, timeoutMs: 1500 });
console.log(JSON.stringify(result));
