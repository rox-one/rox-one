export interface ParsedArgs {
  positionals: string[];
  flags: Set<string>;
  values: Map<string, string>;
}

function isNegativeIntegerToken(value: string): boolean {
  return /^-\d+$/.test(value);
}

export function parseCommandArgs(
  args: string[],
  optionsWithValues: string[] = [],
): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const valueOptions = new Set(optionsWithValues);
  let consumeAsPositionals = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (consumeAsPositionals) {
      positionals.push(arg);
      continue;
    }

    if (arg === '--') {
      consumeAsPositionals = true;
      continue;
    }

    if (arg.startsWith('-')) {
      if (valueOptions.has(arg)) {
        const value = args[index + 1];
        // Opaque base64url cursors may legitimately begin with one or more "-".
        const cursorValue = arg === '--cursor' && value !== '--' && !valueOptions.has(value);
        if (!value || (value.startsWith('-') && !isNegativeIntegerToken(value) && !cursorValue)) {
          throw new Error(`Missing value for ${arg}`);
        }
        values.set(arg, value);
        index += 1;
      } else if (isNegativeIntegerToken(arg)) {
        positionals.push(arg);
      } else {
        flags.add(arg);
      }
      continue;
    }
    positionals.push(arg);
  }

  return { positionals, flags, values };
}

export function optionValue(
  parsed: ParsedArgs,
  names: string[],
): string | undefined {
  for (const name of names) {
    const value = parsed.values.get(name);
    if (value !== undefined) return value;
  }
  return undefined;
}

export function hasFlag(parsed: ParsedArgs, names: string[]): boolean {
  return names.some((name) => parsed.flags.has(name));
}

export function parsePositiveInt(value: string, optionName: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${optionName} must be a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a positive integer.`);
  }
  return parsed;
}
