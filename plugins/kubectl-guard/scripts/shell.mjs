// Accepted grammar: pipeline := command ('|' command)*; command := literal-word+.
// Every word is quote/escape aware and carries its source range. No expansions,
// redirects, command lists, globbing, comments, assignments or shell evaluation.
export function parsePipeline(source) {
  if (source.length > 65536 || /[\r\n\x00]/.test(source)) return null;
  const commands = [];
  let words = [], value = "", quote = "", start = -1;
  function finishWord(end) {
    if (start < 0) return true;
    if (value.length > 16384 || words.length >= 256) return false;
    words.push({ type: "Word", value, start, end });
    value = ""; start = -1;
    return true;
  }
  function finishCommand() {
    if (!words.length || commands.length >= 8 || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0].value)) return false;
    commands.push({ type: "Command", words, argv: words.map((word) => word.value) });
    words = [];
    return true;
  }
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quote === "'") {
      if (ch === "'") quote = ""; else value += ch;
    } else if (ch === "\\") {
      if (start < 0) start = i;
      const next = source[++i];
      if (next === undefined) return null;
      if (quote === '"' && !['$', '`', '"', '\\'].includes(next)) value += "\\";
      value += next;
    } else if (quote && ch === quote) quote = "";
    else if (ch === "$" || ch === "`") return null;
    else if (quote) value += ch;
    else if (ch === "'" || ch === '"') { if (start < 0) start = i; quote = ch; }
    else if (ch === "|") {
      if (source[i + 1] === "|" || source[i + 1] === "&" || !finishWord(i) || !finishCommand()) return null;
    } else if ("&;<>()[{}]*?!~".includes(ch) || (ch === "#" && start < 0)) return null;
    else if (ch === " " || ch === "\t") { if (!finishWord(i)) return null; }
    else { if (start < 0) start = i; value += ch; }
  }
  if (quote || !finishWord(source.length) || !finishCommand()) return null;
  return { type: "Pipeline", commands };
}

export function mentionsKubectl(source) {
  // Match binary names, including quoted/escaped names, without matching this
  // plugin's own kubectl-guard filenames. Encoded/dynamic programs are out of scope.
  return /(?:^|[^A-Za-z0-9_.-])(?:kubectl|kubecolor)(?=$|[^A-Za-z0-9_.-])/.test(source.replace(/[\\'"\r\n]/g, ""));
}

function safeJqProgram(program) {
  // Only field/index paths and these built-ins. General jq programs can load
  // modules or inspect the environment, so they require normal guard review.
  const builtins = new Set(["length", "keys", "keys_unsorted", "values", "to_entries", "type", "empty"]);
  const path = /^\.(?:[A-Za-z_][A-Za-z0-9_]*)?(?:(?:\.[A-Za-z_][A-Za-z0-9_]*)|(?:\[(?:[0-9]{1,7}|"(?:[^"\\\x00-\x1f]|\\["\\/bfnrt]|\\u[0-9A-Fa-f]{4})*")?\]))*\??$/;
  return program.split("|").every((stage) => builtins.has(stage.trim()) || path.test(stage.trim()));
}

export function safeFilter(argv) {
  const [name, ...args] = argv;
  // Bare filter names only, with no file operands, alternate programs or output paths.
  if (name === "jq") {
    const flags = new Set(["--raw-output", "--compact-output", "--exit-status", "--slurp", "--sort-keys", "--monochrome-output", "--join-output"]);
    let i = 0;
    while (i < args.length && args[i].startsWith("-")) {
      if (!flags.has(args[i]) && !/^-[rcesSMj]+$/.test(args[i])) return false;
      i++;
    }
    return i === args.length || (i === args.length - 1 && safeJqProgram(args[i]));
  }
  if (name === "grep") {
    const flags = new Set(["--ignore-case", "--invert-match", "--extended-regexp", "--fixed-strings", "--word-regexp", "--line-regexp", "--line-number", "--count", "--quiet"]);
    let i = 0;
    while (i < args.length && args[i].startsWith("-")) {
      if (!flags.has(args[i]) && !/^-[ivEFwxncq]+$/.test(args[i])) return false;
      i++;
    }
    return i === args.length - 1 && args[i].length > 0;
  }
  if (name === "head" || name === "tail") {
    return args.length === 0 || (args.length === 2 && ["-n", "--lines"].includes(args[0]) && /^\d{1,7}$/.test(args[1]))
      || (args.length === 1 && /^(?:-n|--lines=)\d{1,7}$/.test(args[0]));
  }
  if (name === "wc") return args.every((arg) => /^-[lwmc]+$/.test(arg) || ["--lines", "--words", "--chars", "--bytes"].includes(arg));
  return false;
}
