import { useState, useMemo, useRef, useEffect } from "react";

/* ================================================================
   OfficeSpeak AI — rewrite messages for Slack, email, meetings and
   reviews while preserving your intent. Powered by Claude.
   ================================================================ */

const TONES = [
  { id: "professional", label: "Professional", hint: "Clear, courteous, gets to the point" },
  { id: "assertive", label: "Assertive", hint: "Direct and confident, no hedging" },
  { id: "diplomatic", label: "Diplomatic", hint: "Maximum tact, softened edges" },
  { id: "executive", label: "Executive", hint: "Brief, strategic, decision-oriented" },
  { id: "hr", label: "HR", hint: "Neutral, policy-safe, people-first" },
  { id: "technical", label: "Technical", hint: "Precise, engineering-grade wording for technical readers" },
  { id: "passive-aggressive", label: "Passive-aggressive", hint: "Per my last email…" },
];

const MODIFIERS = [
  { id: "concise", label: "More to the point", instr: "Cut all waffle; make it as short as possible without losing meaning." },
  { id: "polite", label: "More polite", instr: "Add courtesy and warmth without becoming servile." },
  { id: "less-snarky", label: "Less snarky", instr: "Remove any sarcasm, snark, or edge entirely." },
  { id: "less-emotional", label: "Less emotional", instr: "Strip emotional language; keep it factual and neutral." },
  { id: "accessible", label: "Easier to understand", instr: "Use plain words a non-expert or non-native speaker instantly understands." },
  { id: "formal", label: "More formal", instr: "Raise the register: full sentences, no contractions, formal salutations where natural." },
  { id: "bullets", label: "Bullet points", instr: "Format the rewrite as a short bulleted list (use '- ' bullets), one point per line." },
  { id: "grammar", label: "Grammar fix only", instr: "Prioritize fixing grammar, spelling and punctuation; change wording only where required." },
];

const CONTEXTS = [
  { id: "chat", label: "Chat (Slack/Teams)" },
  { id: "email", label: "Email" },
  { id: "inperson", label: "In person" },
  { id: "review", label: "Performance review" },
  { id: "client", label: "Client call" },
];

const REFINERS = [
  { id: "shorter", label: "Shorter", instr: "Make it noticeably shorter while keeping the core message." },
  { id: "longer", label: "Longer", instr: "Expand it with a bit more context and courtesy; keep it natural." },
  { id: "softer", label: "Softer", instr: "Soften the delivery further; lower the confrontation level." },
  { id: "direct", label: "More direct", instr: "Make it more direct and unambiguous; remove hedging." },
];

const LOADING_LINES = [
  "Aligning stakeholders…",
  "Circling back…",
  "Leveraging synergies…",
  "Taking this offline…",
  "Putting a pin in it…",
  "Looping in leadership…",
  "Moving the needle…",
];

const EXAMPLES = {
  forward: [
    "no way I can finish this today, my plate is FULL",
    "this meeting could've been an email fr",
    "you are too stupid to explain things to",
    "idk who broke prod but it wasn't me lol",
  ],
  reverse: [
    "We appreciate your continued patience while we evaluate internal priorities.",
    "Let's take this offline and circle back once we have more bandwidth.",
    "We're streamlining the team to better align with our strategic goals.",
    "Per my last email, please advise on next steps at your earliest convenience.",
  ],
};

/* ---------------- Prompt building ---------------- */

function modifierBlock(modifiers) {
  const active = MODIFIERS.filter((m) => modifiers?.includes(m.id));
  if (!active.length) return "";
  return `\nApply ALL of these adjustments to the rewrite:\n${active
    .map((m) => `- ${m.label}: ${m.instr}`)
    .join("\n")}\n`;
}

function buildPrompt({ text, mode, tone, context, modifiers, compare, previous, instruction }) {
  const ctx = CONTEXTS.find((c) => c.id === context)?.label || "Slack";

  if (previous && instruction) {
    const spoken =
      mode === "forward" && (context === "inperson" || context === "client")
        ? " The result will be SAID OUT LOUD: natural spoken sentences only, no written formatting."
        : "";
    const job =
      mode === "reverse"
        ? "decoded a corporate message into plain English"
        : `rewrote a casual message for ${ctx} in a ${TONES.find((t) => t.id === tone)?.label || "Professional"} tone`;
    return `You are OfficeSpeak AI, a workplace communication assistant. You previously ${job}. The user wants a revision.

Original message:
"""${text}"""

Your current version:
"""${previous}"""

User's revision instruction: "${instruction}"

Revise YOUR CURRENT VERSION according to the instruction. Still preserve the original message's intent and facts, and preserve WHO is criticizing WHOM — never flip criticism of another person into the sender's own shortcoming.${spoken}

Respond ONLY with valid JSON, no markdown fences, no preamble. Every string value must be a single valid JSON string — escape any line breaks inside string values as \\n. Exactly this shape:
{
  "translation": "the revised version",
  "changes": [
    { "from": "phrase in the current version", "to": "the revised phrasing", "reason": "one short sentence on how this serves the instruction" }
  ],
  "scores_before": {
    "buzzword_density": <0-100 for the CURRENT version>,
    "readability": <0-100 for the CURRENT version>,
    "professionalism": <0-100 for the CURRENT version>
  },
  "scores_after": {
    "buzzword_density": <0-100 for YOUR revision>,
    "readability": <0-100 for YOUR revision>,
    "professionalism": <0-100 for YOUR revision>
  }
}
Include 1-4 items in "changes". Numbers must be integers.`;
  }

  if (mode === "reverse") {
    return `You are OfficeSpeak AI, a workplace communication decoder.

Translate the following corporate-speak message into blunt, plain English that says what it actually means. Be honest and a little funny, but accurate.

Message:
"""${text}"""

Respond ONLY with valid JSON, no markdown fences, no preamble. Every string value must be a single valid JSON string — escape any line breaks inside string values as \\n. Exactly this shape:
{
  "translation": "the plain-English meaning, 1-3 sentences",
  "subtext": "one short cynical line summarizing what this really signals",
  "changes": [
    { "from": "corporate phrase quoted from the input", "to": "what it really means", "reason": "why companies phrase it this way" }
  ],
  "scores_before": {
    "buzzword_density": <0-100, how much of the INPUT is buzzwords/filler>,
    "readability": <0-100, how easy the INPUT is to genuinely understand>,
    "professionalism": <0-100, surface-level polish of the INPUT>
  }
}
Include 2-5 items in "changes". Numbers must be integers.`;
  }

  const toneDef = TONES.find((t) => t.id === tone);

  if (compare) {
    return `You are OfficeSpeak AI, a workplace communication assistant.

Rewrite the following casual message for ${ctx}, in SEVEN different tones, preserving the sender's actual intent and any concrete facts (deadlines, names, commitments). Never invent commitments the sender didn't make. Preserve WHO is saying WHAT about WHOM: if the sender criticizes or blames ANOTHER person, every variant must still address that person's behavior — softened, never flipped into the sender's own shortcoming or a vague shared problem, and always in the sender's own voice. If the message is a pure personal insult with no work-related point, do not invent professional content: return a single variant explaining there is no professional version.${
      context === "inperson" || context === "client"
        ? " This will be SAID OUT LOUD: natural spoken sentences only, no written formatting."
        : ""
    }
${modifierBlock(modifiers)}
Message:
"""${text}"""

Tones: ${TONES.map((t) => `${t.label} (${t.hint})`).join("; ")}.

Respond ONLY with valid JSON, no markdown fences, no preamble. Every string value must be a single valid JSON string — escape any line breaks inside string values as \\n. Exactly this shape:
{
  "variants": [
${TONES.map((t) => `    { "tone": "${t.label}", "translation": "..." }`).join(",\n")}
  ]
}
Keep each variant appropriate in length for ${ctx} (chat: 1-2 sentences; email: short paragraph).`;
  }

  return `You are OfficeSpeak AI, a workplace communication assistant.

Rewrite the following casual message so it is appropriate for ${ctx}, using a ${toneDef.label} tone (${toneDef.hint}).

RULES — all mandatory:
1. Preserve the sender's actual intent and any concrete facts (deadlines, names, commitments). Never invent commitments the sender didn't make.
2. Preserve WHO is saying WHAT about WHOM. If the sender is criticizing, blaming, or making a demand of ANOTHER person, the rewrite must still be aimed at that person's behavior — softened in wording, identical in direction. NEVER flip the criticism into the sender's own shortcoming, and never dilute it into a vague shared problem. Example: "you are too stupid to explain things to" criticizes the OTHER person's ability to follow explanations; a correct rewrite addresses their difficulty following what's being explained (e.g. "I've noticed my explanations aren't landing with you — let's find a format that works"), NOT the sender's need for clearer information. The rewrite is always spoken BY THE SENDER in the sender's own voice — never reposition the sender as the recipient, a bystander, or someone objecting to the message.
2b. If the message contains no work-related intent that could survive a rewrite — a pure personal insult, an attack on someone's appearance or family, or nonsense with no request, complaint, or information in it — do NOT invent professional content and do NOT reframe it from someone else's perspective. Instead set "untranslatable": true, put a one-sentence explanation in "translation" addressed to the user, and leave "changes" empty. Blunt criticism about someone's WORK is translatable and must be rewritten normally, not flagged.
3. Match the medium: ${
    context === "inperson" || context === "client"
      ? "this will be SAID OUT LOUD — write natural spoken sentences someone could comfortably say to a person's face; contractions are fine; no greetings, sign-offs, subject lines, or written formatting"
      : "internal chat (Slack/Teams): 1-2 sentences, casual-professional; email: a short paragraph with greeting/sign-off only if natural"
  }.
${modifierBlock(modifiers)}
Message:
"""${text}"""

Respond ONLY with valid JSON, no markdown fences, no preamble. Every string value must be a single valid JSON string — escape any line breaks inside string values as \\n. Exactly this shape:
{
  "translation": "the rewritten message",
  "untranslatable": <true ONLY if rule 2b applies (no work-related intent); otherwise false>,
  "changes": [
    { "from": "casual word or phrase from the input", "to": "the replacement used", "reason": "one short sentence on why this wording works better" }
  ],
  "scores_before": {
    "buzzword_density": <0-100 for the ORIGINAL input>,
    "readability": <0-100 for the ORIGINAL input>,
    "professionalism": <0-100 for the ORIGINAL input>
  },
  "scores_after": {
    "buzzword_density": <0-100 for YOUR rewrite; lower is cleaner>,
    "readability": <0-100 for YOUR rewrite>,
    "professionalism": <0-100 for YOUR rewrite>
  }
}
Include 2-5 items in "changes". Numbers must be integers.`;
}

/* ---------------- Robust JSON extraction ----------------
   Models occasionally emit literal newlines inside JSON string values
   (especially multi-line rewrites / bullet outputs), stray prose around
   the object, or trailing commas. JSON.parse rejects all of these, so we
   repair before parsing instead of failing the whole request. */

function repairControlChars(s) {
  let out = "";
  let inStr = false;
  let esc = false;
  for (const ch of s) {
    if (inStr) {
      if (esc) {
        out += ch;
        esc = false;
      } else if (ch === "\\") {
        out += ch;
        esc = true;
      } else if (ch === '"') {
        inStr = false;
        out += ch;
      } else if (ch === "\n") {
        out += "\\n";
      } else if (ch === "\r") {
        out += "\\r";
      } else if (ch === "\t") {
        out += "\\t";
      } else {
        out += ch;
      }
    } else {
      if (ch === '"') inStr = true;
      out += ch;
    }
  }
  return out;
}

function extractJson(raw) {
  const clean = raw.replace(/```json|```/g, "").trim();
  const start = clean.indexOf("{");
  if (start === -1) throw new Error("Unexpected response format");
  const repaired = repairControlChars(clean.slice(start));
  // Balanced-brace scan (string-aware) to find where the object really ends,
  // so trailing prose after the JSON can't break the slice.
  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let i = 0; i < repaired.length; i++) {
    const ch = repaired[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const candidate = end !== -1 ? repaired.slice(0, end + 1) : repaired;
  try {
    return JSON.parse(candidate);
  } catch {
    // Last resort: strip trailing commas before } or ]
    return JSON.parse(candidate.replace(/,\s*([}\]])/g, "$1"));
  }
}

/* __LLM_CALL_START__ */
async function runTranslation(payload) {
  // Deployed mode: the FastAPI backend builds the prompt, calls Claude,
  // tracks tokens/cost, and persists the request for analytics.
  const base = (typeof window !== "undefined" && window.OFFICESPEAK_API) || "";
  const response = await fetch(base + "/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    let detail = "";
    try {
      detail = (await response.json()).detail || "";
    } catch {}
    throw new Error(`API error (${response.status})${detail ? ": " + detail : ""}`);
  }
  return await response.json();
}
/* __LLM_CALL_END__ */

/* ---------------- Small UI pieces ---------------- */

function ScoreBar({ label, value, delta, invert }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const good = invert ? v <= 40 : v >= 70;
  const mid = invert ? v <= 70 : v >= 40;
  const color = good ? "#1E7A46" : mid ? "#B07A1E" : "#B3352B";
  const hasDelta = typeof delta === "number" && !isNaN(delta) && delta !== 0;
  const improved = invert ? delta < 0 : delta > 0;
  return (
    <div className="os-score">
      <div className="os-score-top">
        <span>{label}</span>
        <span>
          {hasDelta && (
            <span className={"os-delta " + (improved ? "up" : "down")}>
              {delta > 0 ? "▲ +" : "▼ "}{delta}
            </span>
          )}
          <span className="os-score-num" style={{ color }}>{v}%</span>
        </span>
      </div>
      <div className="os-score-track" role="img" aria-label={`${label}: ${v} percent`}>
        <div className="os-score-fill" style={{ width: `${v}%`, background: color }} />
      </div>
    </div>
  );
}

function Chip({ active, onClick, children, title, dashed }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={"os-chip" + (active ? " os-chip-on" : "") + (dashed ? " os-chip-dash" : "")}
    >
      {children}
    </button>
  );
}

/* Server-side, all-time analytics (only active in the deployed app,
   where index.html sets window.OFFICESPEAK_API). */
function ServerStats({ refreshKey }) {
  const enabled = typeof window !== "undefined" && window.OFFICESPEAK_API !== undefined;
  const [stats, setStats] = useState(null);
  useEffect(() => {
    if (!enabled) return;
    fetch((window.OFFICESPEAK_API || "") + "/api/analytics/summary")
      .then((r) => (r.ok ? r.json() : null))
      .then(setStats)
      .catch(() => {});
  }, [enabled, refreshKey]);
  if (!enabled || !stats) return null;
  return (
    <div className="os-server-strip">
      <span className="os-eyebrow">All-time (server)</span>
      <span>{stats.total_requests} requests</span>
      <span>{(stats.total_tokens || 0).toLocaleString()} tokens</span>
      <span>${Number(stats.total_cost_usd || 0).toFixed(4)} spent</span>
      <span>{Math.round(stats.avg_latency_ms || 0)} ms avg</span>
    </div>
  );
}

/* ---------------- Main app ---------------- */

export default function OfficeSpeakAI() {
  const [mode, setMode] = useState("forward"); // forward | reverse
  const [tone, setTone] = useState("professional");
  const [modifiers, setModifiers] = useState([]);
  const [context, setContext] = useState("chat");
  const [input, setInput] = useState("");
  const [result, setResult] = useState(null);
  const [variants, setVariants] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadLine, setLoadLine] = useState(LOADING_LINES[0]);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);
  const [copied, setCopied] = useState(null);
  const [refineCustom, setRefineCustom] = useState("");
  const loadTimer = useRef(null);

  useEffect(() => {
    if (loading) {
      let i = 0;
      loadTimer.current = setInterval(() => {
        i = (i + 1) % LOADING_LINES.length;
        setLoadLine(LOADING_LINES[i]);
      }, 1200);
    }
    return () => clearInterval(loadTimer.current);
  }, [loading]);

  const toggleModifier = (id) =>
    setModifiers((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));

  const run = async (compare = false, refineInstr = null) => {
    const isRefine = Boolean(refineInstr);
    if (isRefine && !result?.translation) return;
    const text = isRefine ? result._input || input.trim() : input.trim();
    if (!text || loading) return;
    const previous = isRefine ? result.translation : undefined;
    setLoading(true);
    setError(null);
    if (!isRefine) setResult(null);
    setVariants(null);
    try {
      const parsed = await runTranslation({
        text,
        mode,
        tone,
        context,
        modifiers,
        compare,
        previous,
        instruction: refineInstr || undefined,
      });
      if (compare) {
        if (!Array.isArray(parsed.variants)) throw new Error("Unexpected response format");
        setVariants(parsed.variants);
        setResult(parsed.meta ? { metaOnly: true, meta: parsed.meta } : null);
      } else {
        setResult({
          ...parsed,
          // Models sometimes emit the string "true" instead of a boolean.
          untranslatable: parsed.untranslatable === true || parsed.untranslatable === "true",
          _input: text,
        });
        setRefineCustom("");
        setHistory((h) =>
          [
            {
              input: text,
              output: parsed.translation,
              tone: mode === "reverse" ? "decode" : tone,
              context,
              modifiers: [...modifiers],
              mode,
              refined: isRefine,
              scoresBefore: parsed.scores_before || {},
              scoresAfter: parsed.scores_after || {},
              changes: parsed.changes || [],
              time: new Date().toISOString(),
            },
            ...h,
          ].slice(0, 100)
        );
      }
    } catch (e) {
      setError(
        String(e.message).includes("API error")
          ? `The rewrite service returned an error (${e.message}). Try again in a moment.`
          : "Couldn't parse the rewrite. Try again — this usually works on a second attempt."
      );
    } finally {
      setLoading(false);
    }
  };

  const copy = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(key);
    setTimeout(() => setCopied(null), 1400);
  };

  const restore = (h) => {
    setInput(h.input);
    setMode(h.mode);
    if (h.mode === "forward") {
      setTone(h.tone);
      setContext(h.context);
      setModifiers(h.modifiers || []);
    }
    setResult(null);
    setVariants(null);
    setError(null);
  };

  const exportSession = () => {
    const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), entries: history }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "officespeak-session.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const swapModes = () => {
    setMode((m) => (m === "forward" ? "reverse" : "forward"));
    setResult(null);
    setVariants(null);
    setError(null);
  };

  /* ---- session analytics ---- */
  const stats = useMemo(() => {
    const fwd = history.filter((h) => h.mode === "forward");
    const toneCounts = {};
    const ctxCounts = {};
    const phraseCounts = {};
    let liftSum = 0;
    let liftN = 0;
    fwd.forEach((h) => {
      toneCounts[h.tone] = (toneCounts[h.tone] || 0) + 1;
      ctxCounts[h.context] = (ctxCounts[h.context] || 0) + 1;
      const b = Number(h.scoresBefore?.professionalism);
      const a = Number(h.scoresAfter?.professionalism);
      if (!isNaN(b) && !isNaN(a)) {
        liftSum += a - b;
        liftN++;
      }
      (h.changes || []).forEach((c) => {
        const key = String(c.from || "").toLowerCase().trim();
        if (key) phraseCounts[key] = (phraseCounts[key] || 0) + 1;
      });
    });
    const profs = fwd.map((h) => Number(h.scoresAfter?.professionalism)).filter((n) => !isNaN(n));
    const topPhrases = Object.entries(phraseCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    return {
      total: history.length,
      decoded: history.filter((h) => h.mode === "reverse").length,
      avgProf: profs.length ? Math.round(profs.reduce((a, b) => a + b, 0) / profs.length) : null,
      avgLift: liftN ? Math.round(liftSum / liftN) : null,
      toneCounts,
      ctxCounts,
      maxTone: Math.max(1, ...Object.values(toneCounts)),
      maxCtx: Math.max(1, ...Object.values(ctxCounts)),
      topPhrases,
    };
  }, [history]);

  const examples = EXAMPLES[mode];
  const scoresAfter = result?.scores_after || (mode === "reverse" ? result?.scores_before : null);
  const scoresBefore = mode === "forward" ? result?.scores_before : null;
  const delta = (k) =>
    scoresBefore && scoresAfter ? Math.round((Number(scoresAfter[k]) || 0) - (Number(scoresBefore[k]) || 0)) : undefined;

  return (
    <div className="os-root">
      <style>{CSS}</style>

      {/* ---------- Header ---------- */}
      <header className="os-header">
        <div className="os-brand">
          <div className="os-mark" aria-hidden="true">OS</div>
          <div>
            <h1>OfficeSpeak&nbsp;AI</h1>
            <p className="os-tagline">Internal memo № {String(1000 + stats.total).padStart(4, "0")} · Communication department</p>
          </div>
        </div>
        <div className="os-mode" role="tablist" aria-label="Translation direction">
          <button
            role="tab"
            aria-selected={mode === "forward"}
            className={"os-mode-btn" + (mode === "forward" ? " on" : "")}
            onClick={() => mode !== "forward" && swapModes()}
          >
            Casual → Corporate
          </button>
          <button
            role="tab"
            aria-selected={mode === "reverse"}
            className={"os-mode-btn" + (mode === "reverse" ? " on" : "")}
            onClick={() => mode !== "reverse" && swapModes()}
          >
            Corporate → Plain English
          </button>
        </div>
      </header>

      {/* ---------- Workbench ---------- */}
      <main className="os-grid">
        {/* Input panel */}
        <section className="os-panel">
          <div className="os-panel-head">
            <span className="os-eyebrow">{mode === "forward" ? "What you want to say" : "What they sent you"}</span>
          </div>

          <textarea
            className="os-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") run(false);
            }}
            placeholder={
              mode === "forward"
                ? "e.g. no way I can finish this today, my plate is FULL"
                : "e.g. We appreciate your continued patience while we evaluate internal priorities."
            }
            rows={5}
          />

          <div className="os-examples">
            <span className="os-examples-label">Try:</span>
            {examples.map((ex) => (
              <button key={ex} className="os-example" onClick={() => setInput(ex)}>
                “{ex.length > 46 ? ex.slice(0, 44) + "…" : ex}”
              </button>
            ))}
          </div>

          {mode === "forward" && (
            <>
              <div className="os-field">
                <span className="os-eyebrow">Where it's going</span>
                <div className="os-chips">
                  {CONTEXTS.map((c) => (
                    <Chip key={c.id} active={context === c.id} onClick={() => setContext(c.id)}>
                      {c.label}
                    </Chip>
                  ))}
                </div>
              </div>

              <div className="os-field">
                <span className="os-eyebrow">Voice — pick one</span>
                <div className="os-chips">
                  {TONES.map((t) => (
                    <Chip key={t.id} title={t.hint} active={tone === t.id} onClick={() => setTone(t.id)}>
                      {t.label}
                    </Chip>
                  ))}
                </div>
                <p className="os-hint">{TONES.find((t) => t.id === tone)?.hint}</p>
              </div>

              <div className="os-field">
                <span className="os-eyebrow">Adjustments — stack any</span>
                <div className="os-chips">
                  {MODIFIERS.map((m) => (
                    <Chip
                      key={m.id}
                      dashed
                      title={m.instr}
                      active={modifiers.includes(m.id)}
                      onClick={() => toggleModifier(m.id)}
                    >
                      {modifiers.includes(m.id) ? "✓ " : ""}{m.label}
                    </Chip>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="os-actions">
            <button className="os-go" disabled={!input.trim() || loading} onClick={() => run(false)}>
              {loading ? loadLine : mode === "forward" ? "Rewrite message" : "Decode message"}
            </button>
            {mode === "forward" && (
              <button className="os-secondary" disabled={!input.trim() || loading} onClick={() => run(true)}>
                Compare all voices
              </button>
            )}
          </div>
          <p className="os-kbd">⌘/Ctrl + Enter to run</p>
        </section>

        {/* Output panel */}
        <section className="os-panel os-out">
          <div className="os-panel-head">
            <span className="os-eyebrow">{mode === "forward" ? "Ready to send" : "What it actually means"}</span>
            {result?.translation && !variants && !result.untranslatable && (
              <button className="os-copy" onClick={() => copy(result.translation, "main")}>
                {copied === "main" ? "Copied ✓" : "Copy"}
              </button>
            )}
          </div>

          {error && <div className="os-error">{error}</div>}

          {!error && !result && !variants && !loading && (
            <div className="os-empty">
              <div className="os-stamp os-stamp-idle">AWAITING INPUT</div>
              <p>
                {mode === "forward"
                  ? "Type what you actually want to say. Pick a voice, stack adjustments, and OfficeSpeak rewrites it for the channel — showing exactly what it changed, why, and how much more professional it got."
                  : "Paste any corporate message. OfficeSpeak decodes the buzzwords and tells you what's really being said."}
              </p>
            </div>
          )}

          {loading && (
            <div className="os-empty">
              <div className="os-stamp os-stamp-busy">IN REVIEW</div>
              <p className="os-loadline">{loadLine}</p>
            </div>
          )}

          {/* Single result */}
          {result && !result.metaOnly && !loading && (
            <div className="os-memo">
              <div className={"os-stamp" + (result.untranslatable ? " os-stamp-flag" : "")}>
                {result.untranslatable
                  ? "NO PROFESSIONAL EQUIVALENT"
                  : mode === "forward"
                  ? "APPROVED FOR SEND"
                  : "DECODED"}
              </div>
              <p className="os-translation">{result.translation}</p>
              {mode === "reverse" && result.subtext && <p className="os-subtext">Subtext: {result.subtext}</p>}

              {scoresAfter && !result.untranslatable && (
                <div className="os-scores">
                  <ScoreBar label="Buzzword density" value={scoresAfter.buzzword_density} delta={delta("buzzword_density")} invert />
                  <ScoreBar label="Readability" value={scoresAfter.readability} delta={delta("readability")} />
                  <ScoreBar label="Professionalism" value={scoresAfter.professionalism} delta={delta("professionalism")} />
                  <p className="os-hint">
                    {mode === "reverse"
                      ? "Scores describe the original message you pasted."
                      : "▲▼ shows the change versus your original wording."}
                  </p>
                </div>
              )}

              {!result.untranslatable && Array.isArray(result.changes) && result.changes.length > 0 && (
                <div className="os-changes">
                  <span className="os-eyebrow">{mode === "forward" ? "Redline — what changed and why" : "Decoder ring"}</span>
                  {result.changes.map((c, i) => (
                    <div key={i} className="os-change">
                      <div className="os-change-line">
                        <s>{c.from}</s>
                        <span className="os-arrow">→</span>
                        <mark>{c.to}</mark>
                      </div>
                      <p className="os-reason">{c.reason}</p>
                    </div>
                  ))}
                </div>
              )}

              <div className="os-refine">
                <span className="os-eyebrow">Not quite right?</span>
                <div className="os-chips">
                  {REFINERS.map((r) => (
                    <Chip key={r.id} dashed title={r.instr} onClick={() => run(false, r.instr)}>
                      {r.label}
                    </Chip>
                  ))}
                </div>
                <div className="os-refine-custom">
                  <input
                    value={refineCustom}
                    onChange={(e) => setRefineCustom(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && refineCustom.trim()) run(false, refineCustom.trim());
                    }}
                    placeholder="Or tell it what to change… e.g. mention the Friday deadline"
                  />
                  <button
                    className="os-copy"
                    disabled={!refineCustom.trim() || loading}
                    onClick={() => run(false, refineCustom.trim())}
                  >
                    Apply
                  </button>
                </div>
              </div>

              {result.meta && (
                <p className="os-meta">
                  {result.meta.model ? result.meta.model + " · " : ""}
                  {result.meta.input_tokens + result.meta.output_tokens} tokens · $
                  {Number(result.meta.cost_usd).toFixed(5)} · {result.meta.latency_ms} ms
                </p>
              )}
            </div>
          )}

          {/* Compare-all result */}
          {variants && !loading && (
            <div className="os-variants">
              {variants.map((v, i) => (
                <div key={i} className="os-variant">
                  <div className="os-variant-head">
                    <span className="os-variant-tone">{v.tone}</span>
                    <button className="os-copy" onClick={() => copy(v.translation, "v" + i)}>
                      {copied === "v" + i ? "Copied ✓" : "Copy"}
                    </button>
                  </div>
                  <p>{v.translation}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* ---------- Session analytics ---------- */}
      {history.length > 0 && (
        <section className="os-analytics">
          <div className="os-panel-head">
            <span className="os-eyebrow">This session</span>
            <span className="os-analytics-actions">
              <button className="os-copy" onClick={exportSession}>Export JSON</button>
              <button className="os-copy" onClick={() => setHistory([])}>Clear</button>
            </span>
          </div>

          <ServerStats refreshKey={history.length} />

          <div className="os-analytics-grid">
            <div className="os-stat">
              <span className="os-stat-num">{stats.total}</span>
              <span className="os-stat-label">messages processed</span>
            </div>
            <div className="os-stat">
              <span className="os-stat-num">{stats.avgProf === null ? "—" : stats.avgProf + "%"}</span>
              <span className="os-stat-label">avg. professionalism</span>
            </div>
            <div className="os-stat">
              <span className="os-stat-num os-lift">
                {stats.avgLift === null ? "—" : (stats.avgLift >= 0 ? "▲ +" : "▼ ") + stats.avgLift}
              </span>
              <span className="os-stat-label">avg. professionalism lift</span>
            </div>
            <div className="os-stat">
              <span className="os-stat-num">{stats.decoded}</span>
              <span className="os-stat-label">messages decoded</span>
            </div>
          </div>

          <div className="os-charts">
            <div className="os-tonechart">
              <span className="os-stat-label">voice mix</span>
              {TONES.map((t) => {
                const n = stats.toneCounts[t.id] || 0;
                if (!n) return null;
                return (
                  <div key={t.id} className="os-tonebar-row">
                    <span>{t.label}</span>
                    <div className="os-tonebar-track">
                      <div className="os-tonebar-fill" style={{ width: `${(n / stats.maxTone) * 100}%` }} />
                    </div>
                    <span className="os-tonebar-n">{n}</span>
                  </div>
                );
              })}
            </div>
            <div className="os-tonechart">
              <span className="os-stat-label">channel mix</span>
              {CONTEXTS.map((c) => {
                const n = stats.ctxCounts[c.id] || 0;
                if (!n) return null;
                return (
                  <div key={c.id} className="os-tonebar-row">
                    <span>{c.label}</span>
                    <div className="os-tonebar-track">
                      <div className="os-tonebar-fill os-fill-alt" style={{ width: `${(n / stats.maxCtx) * 100}%` }} />
                    </div>
                    <span className="os-tonebar-n">{n}</span>
                  </div>
                );
              })}
            </div>
            <div className="os-tonechart">
              <span className="os-stat-label">your habits — most rewritten phrases</span>
              {stats.topPhrases.length === 0 && <p className="os-hint">No redlines yet.</p>}
              {stats.topPhrases.map(([phrase, n]) => (
                <div key={phrase} className="os-phrase-row">
                  <s>{phrase}</s>
                  <span className="os-tonebar-n">×{n}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="os-history">
            {history.slice(0, 8).map((h, i) => (
              <div key={i} className="os-history-row">
                <button className="os-history-load" onClick={() => restore(h)} title="Restore text, voice, channel and adjustments">
                  ↺
                </button>
                <span className="os-history-tone">
                  {h.refined ? "↻ " : ""}{h.mode === "reverse" ? "decode" : `${h.tone} · ${h.context}`}
                </span>
                <span className="os-history-in" title={h.input}>{h.input}</span>
                <span className="os-history-out" title={h.output}>{h.output}</span>
                <button className="os-copy" onClick={() => copy(h.output, "h" + i)}>
                  {copied === "h" + i ? "✓" : "Copy"}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <footer className="os-footer">
        OfficeSpeak AI · rewrites preserve your intent — always read before you send.
      </footer>
    </div>
  );
}

/* ---------------- Styles ---------------- */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Sans+Condensed:wght@600;700&family=IBM+Plex+Mono:ital,wght@0,400;0,500;1,400&display=swap');

.os-root {
  --paper: #F6F5F0;
  --card: #FFFFFF;
  --ink: #1B2534;
  --ink-soft: #5A6472;
  --line: #D8D5CC;
  --blue: #2B4C9B;
  --blue-dark: #1F3A78;
  --hilite: #FFE569;
  --redline: #B3352B;
  --approve: #1E7A46;
  min-height: 100vh;
  background: var(--paper);
  background-image: repeating-linear-gradient(0deg, transparent, transparent 31px, rgba(27,37,52,0.035) 31px, rgba(27,37,52,0.035) 32px);
  color: var(--ink);
  font-family: 'IBM Plex Sans', system-ui, sans-serif;
  padding: 28px 20px 40px;
  box-sizing: border-box;
}
.os-root *, .os-root *::before, .os-root *::after { box-sizing: border-box; }
.os-root button { font-family: inherit; cursor: pointer; }
.os-root button:focus-visible, .os-root textarea:focus-visible {
  outline: 2px solid var(--blue); outline-offset: 2px;
}

/* Header */
.os-header {
  max-width: 1060px; margin: 0 auto 22px;
  display: flex; flex-wrap: wrap; gap: 16px;
  align-items: flex-end; justify-content: space-between;
  border-bottom: 3px double var(--ink);
  padding-bottom: 16px;
}
.os-brand { display: flex; gap: 14px; align-items: center; }
.os-mark {
  width: 46px; height: 46px; flex: none;
  background: var(--ink); color: var(--hilite);
  font-family: 'IBM Plex Sans Condensed', sans-serif; font-weight: 700; font-size: 20px;
  display: grid; place-items: center; letter-spacing: 1px;
}
.os-brand h1 {
  margin: 0; font-family: 'IBM Plex Sans Condensed', sans-serif;
  font-size: 26px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase;
}
.os-tagline {
  margin: 2px 0 0; font-family: 'IBM Plex Mono', monospace;
  font-size: 11px; color: var(--ink-soft); letter-spacing: 0.4px;
}
.os-mode { display: flex; border: 1px solid var(--ink); background: var(--card); }
.os-mode-btn {
  border: none; background: transparent; padding: 9px 14px;
  font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: var(--ink);
}
.os-mode-btn.on { background: var(--ink); color: #fff; }

/* Layout */
.os-grid {
  max-width: 1060px; margin: 0 auto;
  display: grid; grid-template-columns: 1fr 1fr; gap: 20px;
}
@media (max-width: 820px) { .os-grid { grid-template-columns: 1fr; } }

.os-panel {
  background: var(--card); border: 1px solid var(--line);
  border-top: 4px solid var(--ink);
  padding: 18px; display: flex; flex-direction: column; gap: 14px;
  box-shadow: 0 1px 0 rgba(27,37,52,0.06);
}
.os-panel-head { display: flex; justify-content: space-between; align-items: center; }
.os-eyebrow {
  font-family: 'IBM Plex Mono', monospace; font-size: 11px;
  text-transform: uppercase; letter-spacing: 1.2px; color: var(--ink-soft);
}

/* Input */
.os-input {
  width: 100%; resize: vertical; min-height: 110px;
  border: 1px solid var(--line); background: #FDFDFB;
  padding: 12px; font-family: 'IBM Plex Sans', sans-serif;
  font-size: 15px; line-height: 1.5; color: var(--ink);
}
.os-examples { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.os-examples-label { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--ink-soft); }
.os-example {
  border: 1px dashed var(--line); background: transparent;
  font-size: 12px; color: var(--ink-soft); padding: 3px 8px;
}
.os-example:hover { border-color: var(--blue); color: var(--blue); }

.os-field { display: flex; flex-direction: column; gap: 8px; }
.os-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.os-chip {
  border: 1px solid var(--line); background: var(--card);
  padding: 6px 12px; font-size: 13px; color: var(--ink);
}
.os-chip:hover { border-color: var(--ink); }
.os-chip-on { background: var(--ink); color: #fff; border-color: var(--ink); }
.os-chip-dash { border-style: dashed; font-size: 12.5px; }
.os-chip-dash.os-chip-on { background: var(--blue); border-color: var(--blue); border-style: solid; }
.os-hint { margin: 0; font-size: 12px; color: var(--ink-soft); font-style: italic; }

.os-actions { display: flex; gap: 10px; flex-wrap: wrap; }
.os-go {
  flex: 1; min-width: 180px;
  background: var(--blue); color: #fff; border: none;
  padding: 12px 18px; font-size: 15px; font-weight: 600;
}
.os-go:hover:not(:disabled) { background: var(--blue-dark); }
.os-go:disabled { opacity: 0.55; cursor: default; }
.os-secondary {
  background: transparent; border: 1px solid var(--blue); color: var(--blue);
  padding: 12px 16px; font-size: 14px; font-weight: 500;
}
.os-secondary:hover:not(:disabled) { background: rgba(43,76,155,0.07); }
.os-secondary:disabled { opacity: 0.5; cursor: default; }
.os-kbd { margin: -6px 0 0; font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: var(--ink-soft); }

/* Output */
.os-copy {
  border: 1px solid var(--line); background: transparent;
  font-family: 'IBM Plex Mono', monospace; font-size: 11px; padding: 4px 10px; color: var(--ink);
}
.os-copy:hover { border-color: var(--ink); }
.os-error {
  border: 1px solid var(--redline); background: #FBEDEC; color: var(--redline);
  padding: 12px; font-size: 14px;
}
.os-empty { text-align: center; padding: 36px 18px; color: var(--ink-soft); font-size: 14px; line-height: 1.6; }
.os-loadline { font-family: 'IBM Plex Mono', monospace; }

.os-stamp {
  display: inline-block; margin-bottom: 14px;
  font-family: 'IBM Plex Mono', monospace; font-weight: 500; font-size: 12px;
  letter-spacing: 2px; color: var(--approve);
  border: 2px solid var(--approve); padding: 4px 12px;
  transform: rotate(-2deg);
}
.os-stamp-flag { color: var(--redline); border-color: var(--redline); }
.os-stamp-idle { color: var(--ink-soft); border-color: var(--line); }
.os-stamp-busy { color: var(--blue); border-color: var(--blue); animation: os-pulse 1.2s ease-in-out infinite; }
@keyframes os-pulse { 50% { opacity: 0.45; } }
@media (prefers-reduced-motion: reduce) { .os-stamp-busy { animation: none; } }

.os-memo { display: flex; flex-direction: column; gap: 16px; }
.os-translation {
  margin: 0; font-size: 17px; line-height: 1.6; white-space: pre-wrap;
  border-left: 3px solid var(--hilite); padding-left: 14px;
}
.os-subtext { margin: 0; font-style: italic; color: var(--ink-soft); font-size: 14px; }
.os-meta { margin: 0; font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--ink-soft); }

.os-scores { display: flex; flex-direction: column; gap: 10px; border-top: 1px solid var(--line); padding-top: 14px; }
.os-score-top {
  display: flex; justify-content: space-between;
  font-family: 'IBM Plex Mono', monospace; font-size: 12px; margin-bottom: 4px;
}
.os-score-num { font-weight: 500; }
.os-delta { margin-right: 8px; font-size: 11px; }
.os-delta.up { color: var(--approve); }
.os-delta.down { color: var(--redline); }
.os-score-track { height: 10px; background: #ECEAE2; border: 1px solid var(--line); }
.os-score-fill { height: 100%; transition: width 0.5s ease; }

.os-changes { display: flex; flex-direction: column; gap: 12px; border-top: 1px solid var(--line); padding-top: 14px; }
.os-change-line { font-size: 14px; line-height: 1.7; }
.os-change-line s { color: var(--redline); text-decoration-color: var(--redline); }
.os-arrow { margin: 0 8px; color: var(--ink-soft); }
.os-change-line mark { background: var(--hilite); padding: 1px 4px; }
.os-reason { margin: 3px 0 0; font-size: 12.5px; color: var(--ink-soft); }

.os-refine { display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--line); padding-top: 14px; }
.os-refine-custom { display: flex; gap: 8px; }
.os-refine-custom input {
  flex: 1; border: 1px solid var(--line); background: #FDFDFB;
  padding: 7px 10px; font-family: 'IBM Plex Sans', sans-serif; font-size: 13px; color: var(--ink);
}
.os-refine-custom button:disabled { opacity: 0.5; cursor: default; }

.os-variants { display: flex; flex-direction: column; gap: 12px; }
.os-variant { border: 1px solid var(--line); padding: 12px 14px; }
.os-variant-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.os-variant-tone {
  font-family: 'IBM Plex Mono', monospace; font-size: 11px;
  text-transform: uppercase; letter-spacing: 1px; color: var(--blue); font-weight: 500;
}
.os-variant p { margin: 0; font-size: 14px; line-height: 1.55; white-space: pre-wrap; }

/* Analytics */
.os-analytics {
  max-width: 1060px; margin: 20px auto 0;
  background: var(--card); border: 1px solid var(--line); border-top: 4px solid var(--blue);
  padding: 18px; display: flex; flex-direction: column; gap: 14px;
}
.os-analytics-actions { display: flex; gap: 8px; }
.os-server-strip {
  display: flex; flex-wrap: wrap; gap: 16px; align-items: baseline;
  border: 1px dashed var(--line); padding: 8px 12px;
  font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: var(--ink-soft);
}
.os-analytics-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 22px; align-items: start; }
@media (max-width: 720px) { .os-analytics-grid { grid-template-columns: 1fr 1fr; } }
.os-stat { display: flex; flex-direction: column; }
.os-stat-num { font-family: 'IBM Plex Sans Condensed', sans-serif; font-size: 30px; font-weight: 700; }
.os-lift { color: var(--approve); }
.os-stat-label { font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; color: var(--ink-soft); text-transform: uppercase; letter-spacing: 0.8px; }

.os-charts { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 22px; border-top: 1px solid var(--line); padding-top: 14px; }
@media (max-width: 820px) { .os-charts { grid-template-columns: 1fr; } }
.os-tonechart { display: flex; flex-direction: column; gap: 5px; }
.os-tonebar-row { display: grid; grid-template-columns: 118px 1fr 24px; gap: 8px; align-items: center; font-size: 12px; }
.os-tonebar-track { height: 8px; background: #ECEAE2; }
.os-tonebar-fill { height: 100%; background: var(--blue); }
.os-fill-alt { background: var(--ink); }
.os-tonebar-n { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--ink-soft); }
.os-phrase-row { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; }
.os-phrase-row s { color: var(--redline); text-decoration-color: var(--redline); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.os-history { display: flex; flex-direction: column; border-top: 1px solid var(--line); }
.os-history-row {
  display: grid; grid-template-columns: 28px 150px 1fr 1fr 58px; gap: 10px; text-align: left;
  padding: 8px 4px; border-bottom: 1px dashed var(--line);
  font-size: 12.5px; align-items: center;
}
.os-history-row:hover { background: #FBFAF6; }
.os-history-load { border: 1px solid var(--line); background: transparent; font-size: 13px; padding: 2px 0; color: var(--blue); }
.os-history-load:hover { border-color: var(--blue); }
.os-history-tone { font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; text-transform: uppercase; color: var(--blue); }
.os-history-in, .os-history-out { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.os-history-out { color: var(--ink-soft); }
@media (max-width: 720px) { .os-history-row { grid-template-columns: 28px 90px 1fr 58px; } .os-history-out { display: none; } }

.os-footer {
  max-width: 1060px; margin: 26px auto 0; text-align: center;
  font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--ink-soft);
}
`;
