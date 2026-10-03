/**
 * Managed OMP 18.4.12 extension. Native factories rebind to task/eval/tan
 * children, including restricted specialists. No tool registration or changes.
 * Keep this source standalone: the installed profile cannot import ROX code.
 */
export const OMP_WORKER_POLICY_SOURCE = String.raw`
const directive = 'orchestrate workflowz ultrathink';
const policy = directive + '\nROX mandatory execution policy: use maximum supported thinking for every request. Apply orchestration and workflow planning within this agent\'s existing tool and recursion limits. These words do not grant tools, permissions, or spawning rights.';
function prefix(text) {
  const first = text.split(/\r?\n/, 1)[0];
  const words = first.trim().split(/\s+/);
  const required = directive.split(' ');
  if (!/^(?: {4}|\t)/.test(first) && words.every(word => required.includes(word))) {
    const missing = required.filter(word => !words.includes(word));
    return missing.length ? missing.join(' ') + '\n\n' + text : text;
  }
  return directive + '\n\n' + text;
}
export default function roxWorkerPolicy(pi) {
  // Prefix native task assignments before the child creates its own notices.
  // Preserve specialist selection, caller tool restrictions and recursion policy.
  pi.on('tool_call', event => {
    if (event.toolName !== 'task') return;
    const input = event.input;
    if (Array.isArray(input.tasks)) {
      return { input: { ...input, tasks: input.tasks.map(item => typeof item.task === 'string' ? { ...item, task: prefix(item.task) } : item) } };
    }
    if (typeof input.task === 'string') return { input: { ...input, task: prefix(input.task) } };
  });
  pi.on('before_agent_start', event => {
    pi.setThinkingLevel('max');
    return { systemPrompt: [...event.systemPrompt.filter(part => part !== policy), policy] };
  });
  // Native task/eval direct delivery can bypass input. Context is the final
  // provider projection, and also covers tool continuations and queued input.
  pi.on('context', event => {
    pi.setThinkingLevel('max');
    return { messages: event.messages.map(message => {
      if (message.role !== 'user') return message;
      if (typeof message.content === 'string') return { ...message, content: prefix(message.content) };
      if (!Array.isArray(message.content)) return message;
      const index = message.content.findIndex(block => block.type === 'text');
      if (index < 0) return { ...message, content: [{ type: 'text', text: directive }, ...message.content] };
      return { ...message, content: message.content.map((block, i) => i === index ? { ...block, text: prefix(block.text) } : block) };
    }) };
  });
}
`;
