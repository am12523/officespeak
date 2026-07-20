import pytest

from app.llm import LLMError, _extract_json


def test_literal_newlines_inside_strings():
    raw = '{\n"translation": "Hi team,\n- point one\n- point two",\n"changes": []\n}'
    out = _extract_json(raw)
    assert out["translation"] == "Hi team,\n- point one\n- point two"


def test_fences_and_surrounding_prose_with_stray_brace():
    raw = 'Sure! ```json\n{"translation": "done", "changes": []}\n``` hope that helps :-}'
    assert _extract_json(raw)["translation"] == "done"


def test_trailing_comma():
    assert _extract_json('{"translation": "hi", "changes": [],}')["translation"] == "hi"


def test_escaped_quotes_with_raw_newline():
    raw = '{"translation": "She said \\"no\\" —\nfirmly", "changes": []}'
    assert _extract_json(raw)["translation"] == 'She said "no" —\nfirmly'


def test_no_json_raises():
    with pytest.raises(LLMError):
        _extract_json("I cannot answer that.")
