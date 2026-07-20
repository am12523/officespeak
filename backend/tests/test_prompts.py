from app import prompts
from app.schemas import TranslateRequest


def test_forward_prompt_includes_tone_context_and_json_contract():
    p = prompts.build_forward("can't do this today", "executive", "email", [])
    assert "Executive" in p
    assert "Email" in p
    assert "scores_before" in p and "scores_after" in p
    assert "Never invent commitments" in p


def test_modifiers_are_injected():
    p = prompts.build_forward("hey", "professional", "chat", ["bullets", "less-snarky"])
    assert "Bullet points" in p
    assert "Less snarky" in p


def test_unknown_modifier_is_ignored():
    p = prompts.build_forward("hey", "professional", "chat", ["not-a-real-modifier"])
    assert "Apply ALL of these adjustments" not in p


def test_reverse_prompt_asks_for_subtext():
    p = prompts.build_reverse("We appreciate your patience.")
    assert "subtext" in p
    assert "scores_before" in p


def test_compare_prompt_lists_all_tones():
    p = prompts.build_compare("hey", "chat", [])
    for label in ["Professional", "Assertive", "Diplomatic", "Executive", "Hr", "Technical", "Passive Aggressive"]:
        assert label in p


def test_dispatch():
    fwd = prompts.build(TranslateRequest(text="hi", mode="forward"))
    rev = prompts.build(TranslateRequest(text="hi", mode="reverse"))
    cmp_ = prompts.build(TranslateRequest(text="hi", mode="forward", compare=True))
    assert "rewritten message" in fwd
    assert "decoder" in rev.lower()
    assert "variants" in cmp_


def test_direction_of_criticism_rule_present():
    p = prompts.build_forward("you are too stupid to explain things to", "diplomatic", "chat", [])
    assert "NEVER flip the criticism" in p
    assert "too stupid to explain things to" in p  # worked example is embedded


def test_spoken_contexts_get_spoken_norms():
    for ctx in ("inperson", "client"):
        p = prompts.build_forward("hey", "professional", ctx, [])
        assert "SAID OUT LOUD" in p
    written = prompts.build_forward("hey", "professional", "email", [])
    assert "SAID OUT LOUD" not in written


def test_compare_prompt_has_direction_rule_and_spoken_norms():
    p = prompts.build_compare("hey", "inperson", [])
    assert "NEVER flip the criticism" in p
    assert "SAID OUT LOUD" in p


def test_refine_prompt_contains_both_versions_and_instruction():
    p = prompts.build_refine(
        "no way I can finish this today",
        "I won't be able to complete this today.",
        "make it shorter",
        "professional",
        "chat",
        "forward",
    )
    assert "no way I can finish this today" in p
    assert "I won't be able to complete this today." in p
    assert "make it shorter" in p
    assert "never flip criticism" in p


def test_dispatch_routes_refine_before_other_modes():
    req = TranslateRequest(
        text="hi", mode="forward", compare=True,
        previous="Hello.", instruction="shorter",
    )
    p = prompts.build(req)
    assert "revision instruction" in p
    assert "variants" not in p  # refine wins over compare


def test_refine_spoken_context():
    p = prompts.build_refine("hey", "Hello there.", "shorter", "professional", "inperson", "forward")
    assert "SAID OUT LOUD" in p
