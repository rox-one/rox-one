import type { AppContext } from '../app/context.js';
import { hasFlag, parseCommandArgs, optionValue, parsePositiveInt } from '../app/cli-args.js';
import { requireDb } from '../app/db.js';
import { requireAccountId } from '../app/account.js';
import {
  buildAiConversation,
  ensureAuthorized,
  fetchChatHistory,
  listDialogs,
} from '../services/telegram.js';
import {
  addAutomationRule,
  addRuleEvent,
  addTask,
  deleteAutomationRule,
  hasRuleEventForMatch,
  listAutomationRules,
  listRuleEvents,
  setAutomationRuleEnabled,
  setPeerTags,
} from '../db/crm.js';
import { upsertPeer } from '../db/writes.js';
import { canonicalPeerKind } from '../db/peerIdentity.js';
import { CliError } from '../app/errors.js';
import { printJson } from '../output.js';

const MAX_RULE_RUN_DIALOGS = 1000;

export function parseRuleId(raw: string | undefined): number {
  if (!raw || !/^[1-9]\d*$/.test(raw)) {
    throw new Error('rule_id must be a positive integer.');
  }

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error('rule_id must be a positive integer.');
  }

  return parsed;
}

export function parseRulesRunArgs(args: string[]): {
  dryRun: boolean;
  dialogsLimit: number;
} {
  const parsed = parseCommandArgs(args, ['--dialogs']);
  const dialogsLimit = optionValue(parsed, ['--dialogs'])
    ? parsePositiveInt(optionValue(parsed, ['--dialogs'])!, '--dialogs')
    : 200;
  if (dialogsLimit > MAX_RULE_RUN_DIALOGS) {
    throw new Error(`--dialogs must be at most ${MAX_RULE_RUN_DIALOGS}.`);
  }
  return {
    dryRun: hasFlag(parsed, ['--dry-run']),
    dialogsLimit,
  };
}

export async function runRules(ctx: AppContext, args: string[]): Promise<void> {
  const db = requireDb(ctx);
  const accountId = await requireAccountId(ctx);

  const sub = args[0];
  if (!sub) {
    throw new Error('Usage: tgchats rules <list|add|disable|delete|run|log> ...');
  }

  if (sub === 'list') {
    const rules = await listAutomationRules(db, { accountId });
    if (rules.length === 0) {
      if (ctx.config.jsonOutput) {
        printJson({ ok: true, count: 0, rules: [] });
        return;
      }
      console.log('No rules configured.');
      return;
    }
    if (ctx.config.jsonOutput) {
      printJson({ ok: true, count: rules.length, rules });
      return;
    }
    for (const rule of rules) {
      console.log(
        `#${rule.ruleId} | ${rule.enabled ? 'on' : 'off'} | "${rule.containsText}" -> tag=${rule.setTag ?? '-'} followup=${rule.followupDays ?? '-'}`,
      );
    }
    return;
  }

  if (sub === 'add') {
    const parsed = parseCommandArgs(args.slice(1), [
      '--name',
      '--contains',
      '--instruction',
      '--tag',
      '--followup-days',
    ]);
    const name = optionValue(parsed, ['--name']);
    const contains = optionValue(parsed, ['--instruction', '--contains']);
    const tag = optionValue(parsed, ['--tag']);
    const followupDaysRaw = optionValue(parsed, ['--followup-days']);

    if (!name || !contains) {
      throw new Error(
        'Usage: tgchats rules add --name "pricing followup" --instruction "if they ask pricing" [--tag Lead] [--followup-days 1]',
      );
    }

    const followupDays = followupDaysRaw
      ? parsePositiveInt(followupDaysRaw, '--followup-days')
      : undefined;
    const ruleId = await addAutomationRule(db, {
      accountId,
      name,
      containsText: contains,
      setTag: tag,
      followupDays,
    });
    if (ctx.config.jsonOutput) {
      printJson({
        ok: true,
        rule: {
          ruleId,
          name,
          instruction: contains,
          defaultTag: tag ?? null,
          defaultFollowupDays: followupDays ?? null,
        },
      });
      return;
    }
    console.log(`Rule #${ruleId} created.`);
    return;
  }

  if (sub === 'disable') {
    const ruleIdRaw = args[1];
    if (!ruleIdRaw) {
      throw new Error('Usage: tgchats rules disable <rule_id>');
    }
    const ruleId = parseRuleId(ruleIdRaw);

    const updated = await setAutomationRuleEnabled(db, {
      accountId,
      ruleId,
      enabled: false,
    });
    if (ctx.config.jsonOutput) {
      printJson({ ok: true, ruleId, updated });
      return;
    }
    console.log(updated ? `Rule #${ruleId} disabled.` : `Rule #${ruleId} not found.`);
    return;
  }

  if (sub === 'delete') {
    const ruleIdRaw = args[1];
    if (!ruleIdRaw) {
      throw new Error('Usage: tgchats rules delete <rule_id>');
    }
    const ruleId = parseRuleId(ruleIdRaw);

    const deleted = await deleteAutomationRule(db, { accountId, ruleId });
    if (ctx.config.jsonOutput) {
      printJson({ ok: true, ruleId, deleted });
      return;
    }
    console.log(deleted ? `Rule #${ruleId} deleted.` : `Rule #${ruleId} not found.`);
    return;
  }

  if (sub === 'run') {
    const { dryRun, dialogsLimit } = parseRulesRunArgs(args.slice(1));

    if (!ctx.ai) {
      throw new CliError(
        'AI mode is not configured. Set AI_MODE=gemini with GEMINI_API_KEY or AI_MODE=openclaw with OPENCLAW_BASE_URL.',
        'AI_NOT_CONFIGURED',
      );
    }

    await ensureAuthorized(ctx.telegram);
    const rules = await listAutomationRules(db, { accountId });
    const activeRules = rules.filter((rule) => rule.enabled);
    if (activeRules.length === 0) {
      if (ctx.config.jsonOutput) {
        printJson({ ok: true, dryRun, matches: 0, actions: 0, events: [] });
        return;
      }
      console.log('No enabled rules.');
      return;
    }

    const dialogs = await listDialogs(ctx.telegram, { all: false, limit: dialogsLimit });
    let matchedCount = 0;
    let actionCount = 0;
    const events: Array<{
      ruleId: number;
      ruleName: string;
      peerId: number;
      peerDisplayName: string;
      matched: boolean;
      reason: string;
      tagApplied: string | null;
      taskCreated: boolean;
      taskDueAt: string | null;
      priority: 'low' | 'med' | 'high';
      dryRun: boolean;
    }> = [];
    for (const dialog of dialogs) {
      let peerUpserted = false;
      const history = await fetchChatHistory(ctx.telegram, {
        chatId: String(dialog.peer.id),
        limit: 25,
      });
      if (history.length === 0) continue;
      const latestMessageId = Math.max(...history.map((message) => message.id));

      for (const rule of activeRules) {
        const evaluation = await ctx.ai.evaluateRule({
          context: {
            peerDisplayName: dialog.peer.displayName,
            messages: buildAiConversation(history),
          },
          ruleName: rule.name,
          instruction: rule.containsText,
        });
        if (!evaluation.matched) continue;
        if (
          !dryRun &&
          await hasRuleEventForMatch(db, {
            accountId,
            ruleId: rule.ruleId,
            peerId: dialog.peer.id,
            peerKind: canonicalPeerKind(dialog.peer),
            matchMessageId: latestMessageId,
          })
        ) {
          continue;
        }
        matchedCount += 1;

        if (!dryRun && !peerUpserted) {
          await upsertPeer(db, { accountId, peer: dialog.peer });
          peerUpserted = true;
        }

        const resolvedTag = evaluation.setTag ?? rule.setTag;
        if (resolvedTag) {
          if (!dryRun) {
            await setPeerTags(db, {
              accountId,
              peerId: dialog.peer.id,
              peerKind: canonicalPeerKind(dialog.peer),
              tags: [resolvedTag],
              source: 'rule',
            });
          }
          actionCount += 1;
        }

        const resolvedFollowupDays =
          evaluation.dueInDays ?? (rule.followupDays && rule.followupDays > 0 ? rule.followupDays : null);
        const shouldCreateTask =
          evaluation.shouldCreateTask ||
          (rule.followupDays !== null && rule.followupDays !== undefined && rule.followupDays > 0);
        let taskDueAtIso: string | null = null;

        if (shouldCreateTask) {
          const followupDays = resolvedFollowupDays ?? 1;
          const dueAt = new Date();
          dueAt.setDate(dueAt.getDate() + followupDays);
          taskDueAtIso = dueAt.toISOString();
          if (!dryRun) {
            await addTask(db, {
              accountId,
              peerId: dialog.peer.id,
              peerKind: canonicalPeerKind(dialog.peer),
              dueAt,
              why: evaluation.why ?? `Automation rule "${rule.name}" matched`,
              priority: evaluation.priority,
            });
          }
          actionCount += 1;
        }

        if (!dryRun) {
          await addRuleEvent(db, {
            accountId,
            ruleId: rule.ruleId,
            peerId: dialog.peer.id,
            peerKind: canonicalPeerKind(dialog.peer),
            matchMessageId: latestMessageId,
            note: `${dialog.peer.displayName}: ${evaluation.reason} | tag=${resolvedTag ?? '-'} | task=${shouldCreateTask ? 'yes' : 'no'}`,
          });
        }
        events.push({
          ruleId: rule.ruleId,
          ruleName: rule.name,
          peerId: dialog.peer.id,
          peerDisplayName: dialog.peer.displayName,
          matched: true,
          reason: evaluation.reason,
          tagApplied: resolvedTag ?? null,
          taskCreated: shouldCreateTask,
          taskDueAt: taskDueAtIso,
          priority: evaluation.priority,
          dryRun,
        });
      }
    }

    if (ctx.config.jsonOutput) {
      printJson({
        ok: true,
        dryRun,
        matches: matchedCount,
        actions: actionCount,
        events,
      });
      return;
    }
    console.log(
      `Rule ${dryRun ? 'dry run' : 'run'} complete. Matches=${matchedCount}, actions=${actionCount}.`,
    );
    return;
  }

  if (sub === 'log') {
    const parsed = parseCommandArgs(args.slice(1), ['--limit', '-n']);
    const limit = optionValue(parsed, ['--limit', '-n'])
      ? parsePositiveInt(optionValue(parsed, ['--limit', '-n'])!, '--limit')
      : 20;
    const events = await listRuleEvents(db, { accountId, limit });
    if (events.length === 0) {
      if (ctx.config.jsonOutput) {
        printJson({ ok: true, count: 0, events: [] });
        return;
      }
      console.log('No rule events yet.');
      return;
    }
    if (ctx.config.jsonOutput) {
      printJson({
        ok: true,
        count: events.length,
        events: events.map((event) => ({
          ...event,
          createdAt: event.createdAt.toISOString(),
        })),
      });
      return;
    }
    for (const event of events) {
      console.log(
        `${event.createdAt.toISOString()} | rule=${event.ruleId} | peer=${event.peerId} | ${event.note}`,
      );
    }
    return;
  }

  throw new Error(`Unknown rules subcommand: ${sub}`);
}
