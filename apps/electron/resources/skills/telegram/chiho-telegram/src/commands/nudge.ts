import type { AppContext } from '../app/context.js';
import { parseCommandArgs, optionValue } from '../app/cli-args.js';
import {
  buildAiConversation,
  ensureAuthorized,
  fetchChatHistory,
  normalizePeerRef,
} from '../services/telegram.js';
import { printJson } from '../output.js';

export async function runNudge(ctx: AppContext, args: string[]): Promise<void> {
  if (!ctx.ai) {
    throw new Error(
      'AI mode is not configured. Set AI_MODE=gemini with GEMINI_API_KEY or AI_MODE=openclaw with OPENCLAW_BASE_URL.',
    );
  }

  const parsed = parseCommandArgs(args, ['--style']);
  const peerInput = parsed.positionals[0];
  if (!peerInput) {
    throw new Error('Usage: tgchats nudge <peer> [--style concise|friendly]');
  }

  const styleRaw = optionValue(parsed, ['--style']) ?? 'concise';
  if (!['concise', 'friendly'].includes(styleRaw)) {
    throw new Error('--style must be concise|friendly');
  }
  const style = styleRaw as 'concise' | 'friendly';

  await ensureAuthorized(ctx.telegram);
  const me = await ctx.telegram.getMe();
  const peer = await ctx.telegram.getPeer(normalizePeerRef(peerInput));
  const history = await fetchChatHistory(ctx.telegram, {
    chatId: String(peer.id),
    limit: 20,
  });
  const latestOutbound = history.find((message) => message.sender.id === me.id);
  const avoidQuestion = Boolean(
    latestOutbound?.text && /[?？]/.test(latestOutbound.text),
  );

  const suggestion = await ctx.ai.nudge(
    {
      peerDisplayName: peer.displayName,
      messages: buildAiConversation(history),
    },
    { style, avoidQuestion },
  );
  if (ctx.config.jsonOutput) {
    printJson({
      ok: true,
      peer: { id: peer.id, displayName: peer.displayName },
      style,
      avoidQuestion,
      nudge: suggestion.nudge,
    });
    return;
  }
  console.log(`Suggested follow-up for ${peer.displayName}:`);
  console.log(suggestion.nudge);
}
