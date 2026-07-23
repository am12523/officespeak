"""Prompt templates for OfficeSpeak AI.

Kept in one module so prompts are versionable, testable, and reviewable
independently of transport code. All prompts demand strict JSON output.
"""

TONES = {
    "professional": "Clear, courteous, gets to the point",
    "assertive": "Direct and confident, no hedging",
    "diplomatic": "Maximum tact, softened edges",
    "executive": "Brief, strategic, decision-oriented",
    "hr": "Neutral, policy-safe, people-first",
    "technical": "Precise, engineering-grade wording for technical readers",
    "passive-aggressive": "Per my last email…",
}

MODIFIERS = {
    "concise": ("More to the point", "Cut all waffle; make it as short as possible without losing meaning."),
    "polite": ("More polite", "Add courtesy and warmth without becoming servile."),
    "less-snarky": ("Less snarky", "Remove any sarcasm, snark, or edge entirely."),
    "less-emotional": ("Less emotional", "Strip emotional language; keep it factual and neutral."),
    "accessible": ("Easier to understand", "Use plain words a non-expert or non-native speaker instantly understands."),
    "formal": ("More formal", "Raise the register: full sentences, no contractions, formal salutations where natural."),
    "bullets": ("Bullet points", "Format the rewrite as a short bulleted list (use '- ' bullets), one point per line."),
    "grammar": ("Grammar fix only", "Prioritize fixing grammar, spelling and punctuation; change wording only where required."),
}

CONTEXTS = {
    "chat": "internal chat (Slack/Teams)",
    # legacy ids kept so old clients/stored rows keep working
    "slack": "internal chat (Slack/Teams)",
    "teams": "internal chat (Slack/Teams)",
    "email": "Email",
    "inperson": "In person",
    "review": "Performance review",
    "client": "Client call",
}

SPOKEN_CONTEXTS = {"inperson", "client"}

DIRECTION_RULE = (
    "Preserve WHO is saying WHAT about WHOM. If the sender is criticizing, blaming, or "
    "making a demand of ANOTHER person, the rewrite must still be aimed at that person's "
    "behavior — softened in wording, identical in direction. NEVER flip the criticism into "
    "the sender's own shortcoming, and never dilute it into a vague shared problem. "
    'Example: "you are too stupid to explain things to" criticizes the OTHER person\'s '
    "ability to follow explanations; a correct rewrite addresses their difficulty following "
    "what's being explained, NOT the sender's need for clearer information. "
    "The rewrite is always spoken BY THE SENDER in the sender's own voice. Never "
    "reposition the sender as the recipient, a bystander, or someone reporting or "
    "objecting to the message — if the sender wrote an insult, the output is not a "
    "complaint about that insult."
)

NO_INTENT_RULE = (
    "If the message contains no work-related intent that could survive a rewrite — a pure "
    "personal insult, an attack on someone's appearance or family, or nonsense with no "
    "request, complaint, or information in it — do NOT invent professional content and do "
    "NOT reframe it from someone else's perspective. Instead set \"untranslatable\": true, "
    "put a one-sentence explanation in \"translation\" addressed to the user (e.g. \"There's "
    "no professional version of this — it's a personal insult with no work-related point to "
    "make.\"), and leave \"changes\" as an empty list. Blunt or harsh criticism about someone's "
    "WORK is translatable and must be rewritten normally, not flagged."
)


def _modifier_block(modifiers):
    active = [(MODIFIERS[m][0], MODIFIERS[m][1]) for m in modifiers or [] if m in MODIFIERS]
    if not active:
        return ""
    lines = "\n".join(f"- {label}: {instr}" for label, instr in active)
    return f"\nApply ALL of these adjustments to the rewrite:\n{lines}\n"


def build_forward(text, tone, context, modifiers):
    ctx = CONTEXTS.get(context, CONTEXTS["chat"])
    tone_hint = TONES.get(tone, TONES["professional"])
    tone_label = tone.replace("-", " ").title()
    medium = (
        "this will be SAID OUT LOUD — write natural spoken sentences someone could "
        "comfortably say to a person's face; contractions are fine; no greetings, "
        "sign-offs, subject lines, or written formatting"
        if context in SPOKEN_CONTEXTS
        else "internal chat (Slack/Teams): 1-2 sentences, casual-professional; email: a short paragraph with greeting/sign-off only if natural"
    )
    return f'''You are OfficeSpeak AI, a workplace communication assistant.

Rewrite the following casual message so it is appropriate for {ctx}, using a {tone_label} tone ({tone_hint}).

RULES — all mandatory:
1. Preserve the sender's actual intent and any concrete facts (deadlines, names, commitments). Never invent commitments the sender didn't make.
2. {DIRECTION_RULE}
2b. {NO_INTENT_RULE}
3. Match the medium: {medium}.
{_modifier_block(modifiers)}
Message:
"""{text}"""

Respond ONLY with valid JSON, no markdown fences, no preamble. Every string value must be a single valid JSON string — escape any line breaks inside string values as \\n. Exactly this shape:
{{
  "translation": "the rewritten message",
  "untranslatable": false,
  "changes": [
    {{ "from": "casual word or phrase from the input", "to": "the replacement used", "reason": "one short sentence on why this wording works better" }}
  ],
  "scores_before": {{
    "buzzword_density": <0-100 for the ORIGINAL input>,
    "readability": <0-100 for the ORIGINAL input>,
    "professionalism": <0-100 for the ORIGINAL input>
  }},
  "scores_after": {{
    "buzzword_density": <0-100 for YOUR rewrite; lower is cleaner>,
    "readability": <0-100 for YOUR rewrite>,
    "professionalism": <0-100 for YOUR rewrite>
  }}
}}
Include 2-5 items in "changes". Numbers must be integers.'''


def build_reverse(text):
    return f'''You are OfficeSpeak AI, a workplace communication decoder.

Translate the following corporate-speak message into blunt, plain English that says what it actually means. Be honest and a little funny, but accurate.

Message:
"""{text}"""

Respond ONLY with valid JSON, no markdown fences, no preamble. Every string value must be a single valid JSON string — escape any line breaks inside string values as \\n. Exactly this shape:
{{
  "translation": "the plain-English meaning, 1-3 sentences",
  "subtext": "one short cynical line summarizing what this really signals",
  "changes": [
    {{ "from": "corporate phrase quoted from the input", "to": "what it really means", "reason": "why companies phrase it this way" }}
  ],
  "scores_before": {{
    "buzzword_density": <0-100, how much of the INPUT is buzzwords/filler>,
    "readability": <0-100, how easy the INPUT is to genuinely understand>,
    "professionalism": <0-100, surface-level polish of the INPUT>
  }}
}}
Include 2-5 items in "changes". Numbers must be integers.'''


def build_compare(text, context, modifiers):
    ctx = CONTEXTS.get(context, CONTEXTS["chat"])
    tone_list = "; ".join(f"{t.replace('-', ' ').title()} ({hint})" for t, hint in TONES.items())
    variant_lines = ",\n".join(
        f'    {{ "tone": "{t.replace("-", " ").title()}", "translation": "..." }}' for t in TONES
    )
    spoken = (
        " This will be SAID OUT LOUD: natural spoken sentences only, no written formatting."
        if context in SPOKEN_CONTEXTS
        else ""
    )
    return f'''You are OfficeSpeak AI, a workplace communication assistant.

Rewrite the following casual message for {ctx}, in SEVEN different tones, preserving the sender's actual intent and any concrete facts (deadlines, names, commitments). Never invent commitments the sender didn't make. {DIRECTION_RULE} {NO_INTENT_RULE} If untranslatable, return a single variant whose "translation" is that one-sentence explanation.{spoken}
{_modifier_block(modifiers)}
Message:
"""{text}"""

Tones: {tone_list}.

Respond ONLY with valid JSON, no markdown fences, no preamble. Every string value must be a single valid JSON string — escape any line breaks inside string values as \\n. Exactly this shape:
{{
  "variants": [
{variant_lines}
  ]
}}
Keep each variant appropriate in length for {ctx} (chat: 1-2 sentences; email: short paragraph).'''


def build_refine(text, previous, instruction, tone, context, mode):
    ctx = CONTEXTS.get(context, CONTEXTS["chat"])
    tone_label = tone.replace("-", " ").title()
    job = (
        "decoded a corporate message into plain English"
        if mode == "reverse"
        else f"rewrote a casual message for {ctx} in a {tone_label} tone"
    )
    spoken = (
        " The result will be SAID OUT LOUD: natural spoken sentences only, no written formatting."
        if mode == "forward" and context in SPOKEN_CONTEXTS
        else ""
    )
    return f'''You are OfficeSpeak AI, a workplace communication assistant. You previously {job}. The user wants a revision.

Original message:
"""{text}"""

Your current version:
"""{previous}"""

User's revision instruction: "{instruction}"

Revise YOUR CURRENT VERSION according to the instruction. Still preserve the original message's intent and facts, and preserve WHO is criticizing WHOM — never flip criticism of another person into the sender's own shortcoming, and keep the text in the sender's own voice.{spoken}

Respond ONLY with valid JSON, no markdown fences, no preamble. Every string value must be a single valid JSON string — escape any line breaks inside string values as \\n. Exactly this shape:
{{
  "translation": "the revised version",
  "changes": [
    {{ "from": "phrase in the current version", "to": "the revised phrasing", "reason": "one short sentence on how this serves the instruction" }}
  ],
  "scores_before": {{
    "buzzword_density": <0-100 for the CURRENT version>,
    "readability": <0-100 for the CURRENT version>,
    "professionalism": <0-100 for the CURRENT version>
  }},
  "scores_after": {{
    "buzzword_density": <0-100 for YOUR revision>,
    "readability": <0-100 for YOUR revision>,
    "professionalism": <0-100 for YOUR revision>
  }}
}}
Include 1-4 items in "changes". Numbers must be integers.'''


def build(req):
    """Dispatch on a TranslateRequest-like object."""
    if getattr(req, "previous", None) and getattr(req, "instruction", None):
        return build_refine(req.text, req.previous, req.instruction, req.tone, req.context, req.mode)
    if req.mode == "reverse":
        return build_reverse(req.text)
    if req.compare:
        return build_compare(req.text, req.context, req.modifiers)
    return build_forward(req.text, req.tone, req.context, req.modifiers)
