import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import {
  DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE,
  asBoolean,
  asNumber,
  asString,
  asStringArray,
  buildInvocationEnvForLogs,
  buildPaperclipEnv,
  ensureAbsoluteDirectory,
  ensurePathInEnv,
  joinPromptSections,
  parseObject,
  readPaperclipIssueWorkModeFromContext,
  refreshPaperclipWorkspaceEnvForExecution,
  renderPaperclipWakePrompt,
  renderTemplate,
  resolveCommandForLogs,
  runChildProcess,
  stringifyPaperclipWakePayload,
} from "@paperclipai/adapter-utils/server-utils";

const ADAPTER_TYPE = "agy";
const DEFAULT_PRINT_TIMEOUT = "10m";

function cleanString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "";
}

// Model ids are the exact label strings `agy models` prints; the CLI's model
// resolver accepts them verbatim via --model. Keep in sync with `agy models`.
export function buildAgyModels() {
  return [
    { id: "auto", label: "Current Antigravity default" },
    { id: "Gemini 3.6 Flash (Low)", label: "Gemini 3.6 Flash (Low)" },
    { id: "Gemini 3.6 Flash (Medium)", label: "Gemini 3.6 Flash (Medium)" },
    { id: "Gemini 3.6 Flash (High)", label: "Gemini 3.6 Flash (High)" },
    { id: "Gemini 3.1 Pro (Low)", label: "Gemini 3.1 Pro (Low)" },
    { id: "Gemini 3.1 Pro (High)", label: "Gemini 3.1 Pro (High)" },
    { id: "Claude Sonnet 4.6 (Thinking)", label: "Claude Sonnet 4.6 (Thinking)" },
    { id: "Claude Opus 4.6 (Thinking)", label: "Claude Opus 4.6 (Thinking)" },
    { id: "GPT-OSS 120B (Medium)", label: "GPT-OSS 120B (Medium)" },
  ];
}

export function parseAgyModels(stdout) {
  const models = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((id) => ({ id, label: id }));
  if (models.length === 0) {
    throw new Error("agy models returned an empty model catalog");
  }
  return models;
}

export async function listAgyModels() {
  const stdout = await new Promise((resolve, reject) => {
    const child = execFile(
      "agy",
      ["models"],
      { encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 },
      (error, output) => error ? reject(error) : resolve(output),
    );
    child.stdin?.end();
  });
  return parseAgyModels(stdout);
}

function buildRuntimeEnv(agent, runId, config, context, authToken, cwd) {
  const envConfig = parseObject(config.env);
  const env = { ...buildPaperclipEnv(agent) };
  env.PAPERCLIP_RUN_ID = runId;

  const wakeTaskId =
    cleanString(context.taskId) ||
    cleanString(context.issueId) ||
    "";
  const wakeReason = cleanString(context.wakeReason);
  const wakeCommentId = cleanString(context.wakeCommentId) || cleanString(context.commentId);
  const approvalId = cleanString(context.approvalId);
  const approvalStatus = cleanString(context.approvalStatus);
  const linkedIssueIds = Array.isArray(context.issueIds)
    ? context.issueIds.filter((value) => typeof value === "string" && value.trim().length > 0)
    : [];
  const wakePayloadJson = stringifyPaperclipWakePayload(context.paperclipWake);
  const issueWorkMode = readPaperclipIssueWorkModeFromContext(context);

  if (wakeTaskId) env.PAPERCLIP_TASK_ID = wakeTaskId;
  if (issueWorkMode) env.PAPERCLIP_ISSUE_WORK_MODE = issueWorkMode;
  if (wakeReason) env.PAPERCLIP_WAKE_REASON = wakeReason;
  if (wakeCommentId) env.PAPERCLIP_WAKE_COMMENT_ID = wakeCommentId;
  if (approvalId) env.PAPERCLIP_APPROVAL_ID = approvalId;
  if (approvalStatus) env.PAPERCLIP_APPROVAL_STATUS = approvalStatus;
  if (linkedIssueIds.length > 0) env.PAPERCLIP_LINKED_ISSUE_IDS = linkedIssueIds.join(",");
  if (wakePayloadJson) env.PAPERCLIP_WAKE_PAYLOAD_JSON = wakePayloadJson;

  for (const [key, value] of Object.entries(envConfig)) {
    if (typeof value === "string") env[key] = value;
  }

  if (!cleanString(env.PAPERCLIP_API_KEY) && authToken) {
    env.PAPERCLIP_API_KEY = authToken;
  }

  const workspaceContext = parseObject(context.paperclipWorkspace);
  const workspaceHints = Array.isArray(context.paperclipWorkspaces)
    ? context.paperclipWorkspaces.filter((value) => typeof value === "object" && value !== null)
    : [];
  refreshPaperclipWorkspaceEnvForExecution({
    env,
    envConfig,
    workspaceCwd: asString(workspaceContext.cwd, ""),
    workspaceSource: asString(workspaceContext.source, ""),
    workspaceId: asString(workspaceContext.workspaceId, ""),
    workspaceRepoUrl: asString(workspaceContext.repoUrl, ""),
    workspaceRepoRef: asString(workspaceContext.repoRef, ""),
    workspaceHints,
    agentHome: asString(workspaceContext.agentHome, ""),
    executionTargetIsRemote: false,
    executionCwd: cwd,
  });

  return env;
}

async function readInstructionsPrefix(config, onLog) {
  const instructionsFilePath = asString(config.instructionsFilePath, "").trim();
  if (!instructionsFilePath) return { text: "", notes: [] };
  const instructionsDir = `${path.dirname(instructionsFilePath)}/`;
  try {
    const contents = await fs.readFile(instructionsFilePath, "utf8");
    return {
      text:
        `${contents}\n\n` +
        `The above agent instructions were loaded from ${instructionsFilePath}. ` +
        `Resolve any relative file references from ${instructionsDir}.\n\n`,
      notes: [
        `Loaded agent instructions from ${instructionsFilePath}`,
        `Prepended instructions + path directive to prompt (relative references from ${instructionsDir}).`,
      ],
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await onLog("stdout", `[paperclip] Warning: could not read agent instructions file "${instructionsFilePath}": ${reason}\n`);
    return {
      text: "",
      notes: [`Configured instructionsFilePath ${instructionsFilePath}, but file could not be read.`],
    };
  }
}

function renderRuntimeNote(env) {
  const keys = Object.keys(env).filter((key) => key.startsWith("PAPERCLIP_")).sort();
  if (keys.length === 0) return "";
  return [
    "Paperclip runtime note:",
    `The following PAPERCLIP_* environment variables are available in this run: ${keys.join(", ")}`,
    "Use PAPERCLIP_API_URL, PAPERCLIP_API_KEY, and PAPERCLIP_RUN_ID for Paperclip API writes when needed.",
  ].join("\n");
}

function resolveCwd(config, context) {
  const workspaceContext = parseObject(context.paperclipWorkspace);
  const workspaceCwd = asString(workspaceContext.cwd, "").trim();
  const configuredCwd = asString(config.cwd, "").trim();
  return workspaceCwd || configuredCwd || process.cwd();
}

function buildPrompt(agent, runId, config, context, instructionsPrefix, env) {
  const promptTemplate = asString(config.promptTemplate, DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE);
  const bootstrapPromptTemplate = asString(config.bootstrapPromptTemplate, "");
  const templateData = {
    agentId: agent.id,
    companyId: agent.companyId,
    runId,
    company: { id: agent.companyId },
    agent,
    run: { id: runId, source: "on_demand" },
    context,
  };
  const renderedBootstrapPrompt = bootstrapPromptTemplate.trim().length > 0
    ? renderTemplate(bootstrapPromptTemplate, templateData).trim()
    : "";
  const wakePrompt = renderPaperclipWakePrompt(context.paperclipWake, { resumedSession: false });
  const handoff = asString(context.paperclipSessionHandoffMarkdown, "").trim();
  const runtimeNote = renderRuntimeNote(env);
  const renderedPrompt = renderTemplate(promptTemplate, templateData);
  return joinPromptSections([
    instructionsPrefix,
    renderedBootstrapPrompt,
    wakePrompt,
    handoff,
    runtimeNote,
    renderedPrompt,
  ]);
}

function buildArgs(config, prompt) {
  const args = [];
  const model = asString(config.model, "auto").trim();
  const printTimeout = asString(config.printTimeout, DEFAULT_PRINT_TIMEOUT).trim() || DEFAULT_PRINT_TIMEOUT;
  if (model && model !== "auto") args.push("--model", model);
  if (asBoolean(config.sandbox, false)) args.push("--sandbox");
  if (asBoolean(config.dangerouslySkipPermissions, true)) args.push("--dangerously-skip-permissions");
  const project = asString(config.project, "").trim();
  if (project) args.push("--project", project);
  if (asBoolean(config.newProject, false)) args.push("--new-project");
  const extraArgs = (() => {
    const fromExtraArgs = asStringArray(config.extraArgs);
    if (fromExtraArgs.length > 0) return fromExtraArgs;
    return asStringArray(config.args);
  })();
  if (extraArgs.length > 0) args.push(...extraArgs);
  args.push("--print-timeout", printTimeout, "--print", prompt);
  return args;
}

export function createServerAdapter() {
  return {
    type: ADAPTER_TYPE,
    models: buildAgyModels(),
    listModels: listAgyModels,
    refreshModels: listAgyModels,
    supportsLocalAgentJwt: true,
    supportsInstructionsBundle: true,
    instructionsPathKey: "instructionsFilePath",
    requiresMaterializedRuntimeSkills: false,
    agentConfigurationDoc: `# agy agent configuration

Adapter: agy

Runs the Antigravity CLI command \`agy\` in non-interactive print mode from the Paperclip container.

Core fields:
- cwd (string, optional): working directory fallback. Paperclip workspace cwd wins when present.
- instructionsFilePath (string, optional): markdown instructions prepended to the prompt.
- promptTemplate (string, optional): Paperclip run prompt template.
- command (string, optional): defaults to \`agy\`.
- model (string, optional): Antigravity model id/label. Leave \`auto\` to use the CLI default/current selection.
- printTimeout (string, optional): Antigravity print-mode timeout. Defaults to \`${DEFAULT_PRINT_TIMEOUT}\`.
- dangerouslySkipPermissions (boolean, optional): pass \`--dangerously-skip-permissions\`. Defaults to true for unattended Paperclip runs.
- sandbox (boolean, optional): pass \`--sandbox\`.
- extraArgs / args (string[] | string, optional): additional CLI args.
- env (object, optional): KEY=VALUE environment variables.

Notes:
- Auth is stored in the mounted \`/home/kevin/.gemini\` volume.
- The adapter does not currently resume Antigravity conversations; each run is a fresh print-mode prompt.
`,
    getRuntimeCommandSpec(config) {
      const command = asString(config.command, "agy").trim() || "agy";
      return { command, detectCommand: command, installCommand: null };
    },
    getConfigSchema() {
      return {
        fields: [
          { key: "command", label: "Command", type: "text", default: "agy", required: true },
          { key: "model", label: "Model", type: "combobox", default: "auto", options: buildAgyModels() },
          { key: "cwd", label: "Working directory", type: "text", hint: "Optional fallback; Paperclip workspace cwd wins when present." },
          { key: "printTimeout", label: "Print timeout", type: "text", default: DEFAULT_PRINT_TIMEOUT },
          { key: "timeoutSec", label: "Process timeout seconds", type: "number", default: 0 },
          { key: "dangerouslySkipPermissions", label: "Skip permission prompts", type: "toggle", default: true },
          { key: "sandbox", label: "Use Antigravity sandbox", type: "toggle", default: false },
          { key: "extraArgs", label: "Extra args", type: "textarea", hint: "JSON/string array or newline-separated args, depending on Paperclip form handling." },
        ],
      };
    },
    async testEnvironment(ctx) {
      const config = parseObject(ctx.config);
      const command = asString(config.command, "agy").trim() || "agy";
      const cwd = asString(config.cwd, process.cwd()).trim() || process.cwd();
      const checks = [];
      const runId = `agy-envtest-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      try {
        await ensureAbsoluteDirectory(cwd, { createIfMissing: true });
        checks.push({ code: "agy_cwd_valid", level: "info", message: `Working directory is valid: ${cwd}` });
      } catch (err) {
        checks.push({ code: "agy_cwd_invalid", level: "error", message: err instanceof Error ? err.message : "Invalid working directory", detail: cwd });
      }
      const runtimeEnv = ensurePathInEnv({ ...process.env });
      try {
        const resolved = await resolveCommandForLogs(command, cwd, runtimeEnv);
        checks.push({ code: "agy_command_resolvable", level: "info", message: `Command is executable: ${command}`, detail: resolved });
      } catch (err) {
        checks.push({ code: "agy_command_unresolvable", level: "error", message: err instanceof Error ? err.message : "Command is not executable", detail: command });
      }
      if (!checks.some((check) => check.level === "error")) {
        const proc = await runChildProcess(runId, command, ["--version"], {
          cwd,
          env: Object.fromEntries(Object.entries(runtimeEnv).filter(([, value]) => typeof value === "string")),
          timeoutSec: 30,
          graceSec: 5,
          onLog: async () => {},
        });
        const version = (proc.stdout || proc.stderr).trim();
        if (!proc.timedOut && (proc.exitCode ?? 1) === 0) {
          checks.push({ code: "agy_version_probe_passed", level: "info", message: "Antigravity CLI version probe succeeded.", detail: version });
        } else {
          checks.push({ code: "agy_version_probe_failed", level: "error", message: "Antigravity CLI version probe failed.", detail: version || `exitCode=${proc.exitCode}` });
        }
      }
      const status = checks.some((check) => check.level === "error")
        ? "fail"
        : checks.some((check) => check.level === "warn")
          ? "warn"
          : "pass";
      return { adapterType: ctx.adapterType, status, checks, testedAt: new Date().toISOString() };
    },
    async execute(ctx) {
      const { runId, agent, config, context, onLog, onMeta, onSpawn, authToken } = ctx;
      const cwd = resolveCwd(config, context);
      await ensureAbsoluteDirectory(cwd, { createIfMissing: true });
      const env = buildRuntimeEnv(agent, runId, config, context, authToken, cwd);
      const runtimeEnv = Object.fromEntries(Object.entries(ensurePathInEnv({ ...process.env, ...env })).filter(([, value]) => typeof value === "string"));
      const command = asString(config.command, "agy").trim() || "agy";
      const resolvedCommand = await resolveCommandForLogs(command, cwd, runtimeEnv);
      const instructionResult = await readInstructionsPrefix(config, onLog);
      const prompt = buildPrompt(agent, runId, config, context, instructionResult.text, env);
      const args = buildArgs(config, prompt);
      const timeoutSec = asNumber(config.timeoutSec, 0);
      const graceSec = asNumber(config.graceSec, 20);
      const model = asString(config.model, "auto").trim() || "auto";
      const loggedEnv = buildInvocationEnvForLogs(env, { runtimeEnv, includeRuntimeKeys: ["HOME"], resolvedCommand });

      if (onMeta) {
        await onMeta({
          adapterType: ADAPTER_TYPE,
          command: resolvedCommand,
          cwd,
          commandNotes: [
            "Prompt is passed to Antigravity via --print for non-interactive execution.",
            ...instructionResult.notes,
          ],
          commandArgs: args.map((value, index) => (index === args.length - 1 ? `<prompt ${prompt.length} chars>` : value)),
          env: loggedEnv,
          prompt,
          promptMetrics: { promptChars: prompt.length, instructionsChars: instructionResult.text.length },
          context,
        });
      }

      const proc = await runChildProcess(runId, command, args, {
        cwd,
        env: runtimeEnv,
        timeoutSec,
        graceSec,
        onLog,
        onSpawn,
      });
      const summary = proc.stdout.trim();
      const stderrSummary = proc.stderr.trim();
      // Antigravity exits 0 with empty stdout when the account quota is
      // exhausted (RESOURCE_EXHAUSTED only appears in its own cli.log), which
      // otherwise surfaces as a "missing disposition" run in Paperclip.
      const emptyOutput = !proc.timedOut && (proc.exitCode ?? 0) === 0 && !summary;
      const failed = proc.timedOut || (proc.exitCode ?? 0) !== 0 || emptyOutput;
      return {
        exitCode: proc.exitCode,
        signal: proc.signal,
        timedOut: proc.timedOut,
        errorMessage: failed
          ? (proc.timedOut
            ? `Timed out after ${timeoutSec}s`
            : emptyOutput
              ? "Antigravity produced no output (exit 0). Likely cause: account quota exhausted or auth problem — check `agy` login account and ~/.gemini/antigravity-cli/cli.log for RESOURCE_EXHAUSTED."
              : (stderrSummary || summary || `Antigravity exited with code ${proc.exitCode ?? -1}`))
          : null,
        provider: "google",
        biller: "google",
        model,
        billingType: "subscription",
        resultJson: { stdout: proc.stdout, stderr: proc.stderr },
        summary: summary || null,
      };
    },
  };
}
