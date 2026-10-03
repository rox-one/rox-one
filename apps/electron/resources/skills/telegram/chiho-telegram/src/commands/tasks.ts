import type { AppContext } from '../app/context.js';
import {
  hasFlag,
  parseCommandArgs,
  optionValue,
  parsePositiveInt,
} from '../app/cli-args.js';
import {
  buildAiConversation,
  ensureAuthorized,
  fetchChatHistory,
  normalizePeerRef,
} from '../services/telegram.js';
import { requireDb } from '../app/db.js';
import { requireAccountId } from '../app/account.js';
import { addTask, listTasksToday, markTaskDone } from '../db/crm.js';
import { upsertPeer } from '../db/writes.js';
import { canonicalPeerKind } from '../db/peerIdentity.js';
import { printJson } from '../output.js';

function parseDueAt(raw: string): Date {
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid due date: ${raw}`);
  }
  return parsed;
}

export async function runTasks(ctx: AppContext, args: string[]): Promise<void> {
  const db = requireDb(ctx);
  const accountId = await requireAccountId(ctx);

  const sub = args[0];
  if (!sub) {
    throw new Error('Usage: tgchats tasks <add|done|today|suggest> ...');
  }

  if (sub === 'add') {
    const parsed = parseCommandArgs(args.slice(1), ['--due', '--why', '--priority']);
    const peerInput = parsed.positionals[0];
    const dueRaw = optionValue(parsed, ['--due']);
    const why = optionValue(parsed, ['--why']);
    const priorityRaw = optionValue(parsed, ['--priority']) ?? 'med';
    if (!peerInput || !dueRaw || !why) {
      throw new Error(
        'Usage: tgchats tasks add <peer> --due 2026-02-24 --why "Follow up" [--priority low|med|high]',
      );
    }

    if (!['low', 'med', 'high'].includes(priorityRaw)) {
      throw new Error('--priority must be low|med|high');
    }

    await ensureAuthorized(ctx.telegram);
    const peer = await ctx.telegram.getPeer(normalizePeerRef(peerInput));
    await upsertPeer(db, { accountId, peer });

    const taskId = await addTask(db, {
      accountId,
      peerId: peer.id,
      peerKind: canonicalPeerKind(peer),
      dueAt: parseDueAt(dueRaw),
      why,
      priority: priorityRaw as 'low' | 'med' | 'high',
    });
    if (ctx.config.jsonOutput) {
      printJson({
        ok: true,
        task: {
          taskId,
          peerId: peer.id,
          peerDisplayName: peer.displayName,
          dueAt: parseDueAt(dueRaw).toISOString(),
          why,
          priority: priorityRaw,
        },
      });
      return;
    }
    console.log(`Task #${taskId} created for ${peer.displayName}.`);
    return;
  }

  if (sub === 'done') {
    const taskIdRaw = args[1];
    if (!taskIdRaw) {
      throw new Error('Usage: tgchats tasks done <task_id>');
    }
    const taskId = Number.parseInt(taskIdRaw, 10);
    if (!Number.isInteger(taskId) || taskId <= 0) {
      throw new Error('task_id must be a positive integer.');
    }

    const updated = await markTaskDone(db, { accountId, taskId });
    if (!updated) {
      if (ctx.config.jsonOutput) {
        printJson({ ok: true, taskId, updated: false });
        return;
      }
      console.log(`Task #${taskId} not found.`);
      return;
    }
    if (ctx.config.jsonOutput) {
      printJson({ ok: true, taskId, updated: true });
      return;
    }
    console.log(`Task #${taskId} marked done.`);
    return;
  }

  if (sub === 'today') {
    const tasks = await listTasksToday(db, { accountId });
    if (tasks.length === 0) {
      if (ctx.config.jsonOutput) {
        printJson({ ok: true, count: 0, tasks: [] });
        return;
      }
      console.log('No due tasks for today.');
      return;
    }
    if (ctx.config.jsonOutput) {
      printJson({
        ok: true,
        count: tasks.length,
        tasks: tasks.map((task) => ({
          taskId: task.taskId,
          peerId: task.peerId,
          displayName: task.displayName,
          dueAt: task.dueAt.toISOString(),
          status: task.status,
          why: task.why,
          priority: task.priority,
        })),
      });
      return;
    }
    for (const task of tasks) {
      console.log(
        `#${task.taskId} | ${task.displayName ?? task.peerId} | ${task.dueAt.toISOString()} | ${task.priority} | ${task.why}`,
      );
    }
    return;
  }

  if (sub === 'suggest') {
    if (!ctx.ai) {
      throw new Error(
        'AI mode is not configured. Set AI_MODE=gemini with GEMINI_API_KEY or AI_MODE=openclaw with OPENCLAW_BASE_URL.',
      );
    }

    const parsed = parseCommandArgs(args.slice(1), ['--limit']);
    const peerInput = parsed.positionals[0];
    if (!peerInput) {
      throw new Error('Usage: tgchats tasks suggest <peer> [--limit N] [--apply]');
    }
    const limit = optionValue(parsed, ['--limit'])
      ? parsePositiveInt(optionValue(parsed, ['--limit'])!, '--limit')
      : 50;
    const apply = hasFlag(parsed, ['--apply']);

    await ensureAuthorized(ctx.telegram);
    const peer = await ctx.telegram.getPeer(normalizePeerRef(peerInput));
    const history = await fetchChatHistory(ctx.telegram, {
      chatId: String(peer.id),
      limit,
    });
    const suggestion = await ctx.ai.suggestTask({
      peerDisplayName: peer.displayName,
      messages: buildAiConversation(history),
    });

    if (!suggestion.shouldCreateTask) {
      if (ctx.config.jsonOutput) {
        printJson({
          ok: true,
          suggestion: {
            peerId: peer.id,
            peerDisplayName: peer.displayName,
            shouldCreateTask: false,
          },
        });
        return;
      }
      console.log(`AI suggests no follow-up task for ${peer.displayName}.`);
      return;
    }

    const dueInDays = suggestion.dueInDays ?? 1;
    const dueAt = new Date();
    dueAt.setDate(dueAt.getDate() + dueInDays);

    if (ctx.config.jsonOutput && !apply) {
      printJson({
        ok: true,
        suggestion: {
          peerId: peer.id,
          peerDisplayName: peer.displayName,
          shouldCreateTask: true,
          dueInDays,
          dueAt: dueAt.toISOString(),
          priority: suggestion.priority,
          why: suggestion.why,
        },
        applied: false,
      });
      return;
    }

    console.log(
      `Suggested task for ${peer.displayName}: due in ${dueInDays} day(s), priority=${suggestion.priority}, why="${suggestion.why}"`,
    );
    if (apply) {
      await upsertPeer(db, { accountId, peer });
      const taskId = await addTask(db, {
        accountId,
        peerId: peer.id,
        peerKind: canonicalPeerKind(peer),
        dueAt,
        why: suggestion.why,
        priority: suggestion.priority,
      });
      if (ctx.config.jsonOutput) {
        printJson({
          ok: true,
          suggestion: {
            peerId: peer.id,
            peerDisplayName: peer.displayName,
            shouldCreateTask: true,
            dueInDays,
            dueAt: dueAt.toISOString(),
            priority: suggestion.priority,
            why: suggestion.why,
          },
          applied: true,
          taskId,
        });
        return;
      }
      console.log(`Applied suggestion as task #${taskId}.`);
    } else {
      console.log('Use --apply to create the task.');
    }
    return;
  }

  throw new Error(`Unknown tasks subcommand: ${sub}`);
}
