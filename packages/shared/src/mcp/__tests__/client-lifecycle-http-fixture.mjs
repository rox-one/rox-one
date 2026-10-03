// Run under Node: Bun's node:http POST socket facade does not report peer
// disconnects consistently. Observe actual TCP teardown in the real server.
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';

const settings = JSON.parse(process.argv[2]);
const emit = event => process.stdout.write(JSON.stringify(event) + '\n');
const sockets = new Set();
const heldResponses = new Map();
let requestIndex = 0;
const server = createServer((req, res) => {
  if (settings.sse !== undefined) {
    emit({ requested: true });
    req.socket.once('close', () => emit({ closed: true }));
    if (settings.sse) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.flushHeaders();
      res.write(': waiting\n\n');
    }
    return;
  }
  if (settings.status) { res.writeHead(settings.status).end(settings.body); return; }
  if (req.method !== 'POST') { res.writeHead(405).end(); return; }
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    const message = JSON.parse(body);
    const index = ++requestIndex;
    emit({ method: message.method });
    if (message.method === settings.stall) {
      emit({ pending: true });
      req.socket.once('close', () => emit({ closed: true }));
      return;
    }
    const respond = () => {
      if (message.id === undefined) { res.writeHead(202).end(); return; }
      const result = message.method === 'initialize'
        ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'http-fixture', version: '1.0' } }
        : { tools: [] };
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        jsonrpc: '2.0', id: message.id,
        ...(message.method === 'tools/list' && settings.error
          ? { error: { code: -32603, message: settings.error } } : { result }),
      }));
    };
    if (settings.holdResponses) {
      heldResponses.set(index, respond);
      res.once('close', () => {
        if (heldResponses.delete(index)) emit({ abandoned: index });
      });
      emit({ held: { index, method: message.method } });
    }
    else if (settings.delayMs) setTimeout(respond, settings.delayMs);
    else respond();
  });
});
server.on('connection', socket => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
});
server.listen(0, '127.0.0.1', () => emit({ port: server.address().port }));
const input = createInterface({ input: process.stdin });
input.on('line', line => {
  const command = JSON.parse(line);
  if (command.release !== undefined) {
    const respond = heldResponses.get(command.release);
    if (!respond) throw new Error(`No held response ${command.release}`);
    heldResponses.delete(command.release);
    respond();
  } else {
    Object.assign(settings, command);
  }
  emit({ updated: true });
});
input.on('close', () => {
  for (const socket of sockets) socket.destroy();
  server.close(() => process.exit(0));
});
