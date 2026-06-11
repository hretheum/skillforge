// injection-guard — heuristic prompt-injection detector for inbound content
// (, T-HARD-01) — docs/11-security-and-secrets.md §"Inbound threat: untrusted source
// content" + §"Content / instruction isolation".
//
// Sources: concept + first principles + general prompt-injection literature (the canonical
// "ignore previous instructions…" family); zero files from any third-party skills-factory
// codebase (clean-room). See docs/11-security-and-secrets.md, docs/13-tool-governance.md.
//
// WHY THIS EXISTS. The inbound guard (inbound-guard.js) frames untrusted content as DATA and the
// content sanitizer strips invisible/confusable characters, but neither one READS the content for
// intent. A payload can sit in plain ASCII inside a labelled fence and still try to talk the model
// across the data/instruction line: "ignore previous instructions", a forged tool call, a request
// to repeat the system prompt. This module scans the already-visible text for those intent markers
// and surfaces a finding, so the framing layer can warn loudly rather than fencing silently.
//
// SCOPE. Detection only — defense in depth, NOT a boundary (docs/11). The boundary remains the
// deny-first resolver, which never reads content at all. A "no injection" result is not a safety
// guarantee and a "high" result does not block anything by itself; it only annotates the framed
// envelope so the manipulation is observable. Fail-closed: a scanner fault is reported as a
// high-severity injection rather than a silent pass.

// --- instruction-override patterns (severity: high) -------------------------------------
// Phrases that try to revoke or replace the agent's standing instructions. These are the textbook
// "jailbreak preamble" markers — if the text is trying to make the model act FROM the content
// rather than ON it, it almost always reaches for one of these.
const INSTRUCTION_OVERRIDE = [
  { re: /ignore\s+(?:all\s+|any\s+)?(?:previous|prior|earlier|above)\s+instructions?/i, label: "instruction-override: ignore previous instructions" },
  { re: /disregard\s+(?:your|all|any|the|previous|prior)\b/i, label: "instruction-override: disregard your/previous" },
  { re: /forget\s+(?:your|all|any|the|previous|prior)\s+instructions?/i, label: "instruction-override: forget your instructions" },
  { re: /you\s+are\s+now\b/i, label: "instruction-override: you are now" },
  { re: /new\s+system\s+prompt\b/i, label: "instruction-override: new system prompt" },
  { re: /your\s+real\s+instructions?\b/i, label: "instruction-override: your real instructions" },
];

// --- tool-coercion patterns (severity: high) --------------------------------------------
// Tool-call-shaped fragments embedded in untrusted text. Real tool invocations never arrive inside
// a source document; their presence means the content is trying to forge a call into the model's
// action plane.
const TOOL_COERCION = [
  { re: /<\/?tool_call\b/i, label: "tool-coercion: <tool_call> fragment" },
  { re: /<\/?function_calls\b/i, label: "tool-coercion: <function_calls> fragment" },
  { re: /<\/?invoke\b/i, label: "tool-coercion: <invoke> fragment" },
  { re: /\[TOOL\s*:/i, label: "tool-coercion: [TOOL: directive" },
  { re: /\bcall\s+(?:the\s+)?[A-Za-z_][\w]*\s+tool\b/i, label: "tool-coercion: 'call the X tool'" },
];

// --- exfiltration patterns (severity: medium) -------------------------------------------
// Requests to disclose the agent's own instructions or to ship data outward. Information-disclosure
// (STRIDE I): lower severity than override because, on its own, it is a request rather than an
// attempt to seize the instruction plane — but it is still adversarial intent worth flagging.
const EXFILTRATION = [
  { re: /(?:output|print|reveal|show|repeat)\s+(?:your|the)\s+(?:system\s+)?(?:prompt|instructions?)/i, label: "exfil: reveal your prompt/instructions" },
  { re: /repeat\s+(?:your|the)\s+instructions?\b/i, label: "exfil: repeat your instructions" },
  { re: /send\s+this\s+to\b/i, label: "exfil: send this to" },
  { re: /email\s+(?:everything|all|this|the)\b/i, label: "exfil: email everything" },
  { re: /\bexfiltrat/i, label: "exfil: exfiltrate" },
];

// --- fake role/system tags (severity: high) ---------------------------------------------
// Forged conversation-role delimiters. A source document is DATA; it never legitimately carries the
// turn markers that frame a real chat. Their presence is an attempt to inject a fake system/assistant
// turn so the model treats embedded text as a trusted instruction rather than untrusted content.
const FAKE_ROLE_TAGS = [
  { re: /<\/?\s*system\s*>/i, label: "fake-tag: <system>" },
  { re: /<\|\s*system\s*\|>/i, label: "fake-tag: <|system|>" },
  { re: /<\/?\s*assistant\s*>/i, label: "fake-tag: <assistant>" },
  { re: /<\|\s*assistant\s*\|>/i, label: "fake-tag: <|assistant|>" },
  { re: /<\/?\s*human\s*>/i, label: "fake-tag: <human>" },
  { re: /<\|\s*human\s*\|>/i, label: "fake-tag: <|human|>" },
  { re: /\[\/?\s*SYSTEM\s*\]/i, label: "fake-tag: [SYSTEM]" },
  { re: /\[\/?\s*INST\s*\]/i, label: "fake-tag: [INST]" },
  { re: /<<\/?\s*SYS\s*>>/i, label: "fake-tag: <<SYS>>" },
];

// --- base64-encoded instructions (severity: high) ---------------------------------------
// A base64 blob is harmless DATA on its own (e.g. an inline data: URL), but paired with a nearby
// "decode and run this" instruction it is a smuggled payload: the visible text looks benign while the
// real instruction hides in the encoding. We fire only when a decode directive sits within ±200 chars
// of a base64-like blob, so plain data URLs without that context stay quiet (true-negative).
const BASE64_BLOB = /[A-Za-z0-9+/]{40,}={0,2}/g;
const DECODE_DIRECTIVE = /\b(?:base64[_\s-]?decode|atob|decode\s+(?:this|and|the)|from\s+base64|decode\s+and\s+(?:execute|run|follow)|run\s+this\s+after\s+decoding|base64[\s-]?encoded\s+(?:instructions?|payload)|encoded\s+payload|decode\s+and\s+execute)\b/i;
const DECODE_PROXIMITY = 200;

function detectBase64Instructions(str) {
  BASE64_BLOB.lastIndex = 0;
  let m;
  while ((m = BASE64_BLOB.exec(str)) !== null) {
    const start = Math.max(0, m.index - DECODE_PROXIMITY);
    const end = Math.min(str.length, m.index + m[0].length + DECODE_PROXIMITY);
    if (DECODE_DIRECTIVE.test(str.slice(start, end))) return true;
  }
  return false;
}

// --- weak heuristics (severity: low) ----------------------------------------------------
// Single weak signals that, alone, are not enough to call an override but are worth surfacing.
const WEAK = [
  { re: /\bjailbreak\b/i, label: "weak: jailbreak mention" },
  { re: /\bDAN\s+mode\b/i, label: "weak: DAN-mode mention" },
  { re: /\bno\s+restrictions?\b/i, label: "weak: 'no restrictions'" },
];

const SEVERITY_RANK = Object.freeze({ low: 1, medium: 2, high: 3 });

/**
 * @typedef {object} InjectionResult
 * @property {boolean} isInjection  true iff any pattern matched
 * @property {string[]} patterns    human-readable labels for every matched pattern (in scan order)
 * @property {'low'|'medium'|'high'} severity  the highest severity among the matches ('low' if none)
 */

/**
 * Scan untrusted text for prompt-injection intent markers. Pure: same input -> same output. Never
 * throws on bad input — a non-string coerces to '' (no match); an internal fault fails closed.
 *
 * @param {unknown} text  raw inbound content (a source doc, a tool result, etc.)
 * @returns {InjectionResult}
 */
export function detectInjection(text) {
  try {
    const str = typeof text === "string" ? text : String(text ?? "");
    const patterns = [];
    let severity = "low";

    const scan = (groups, sev) => {
      for (const { re, label } of groups) {
        if (re.test(str)) {
          patterns.push(label);
          if (SEVERITY_RANK[sev] > SEVERITY_RANK[severity]) severity = sev;
        }
      }
    };

    scan(INSTRUCTION_OVERRIDE, "high");
    scan(TOOL_COERCION, "high");
    scan(FAKE_ROLE_TAGS, "high");
    scan(EXFILTRATION, "medium");
    scan(WEAK, "low");

    if (detectBase64Instructions(str)) {
      patterns.push("base64-payload: decode directive near base64 blob");
      severity = "high";
    }

    return { isInjection: patterns.length > 0, patterns, severity };
  } catch {
    // Fail-closed: a scanner fault must not read as "clean". Report the strongest signal so the
    // framing layer warns rather than fencing silently.
    return { isInjection: true, patterns: ["scanner-error"], severity: "high" };
  }
}
