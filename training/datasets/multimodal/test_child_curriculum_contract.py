import json
from pathlib import Path

CURRICULUM = Path(__file__).with_name('multimodal_training_curriculum.jsonl')


def rows():
    return [json.loads(line) for line in CURRICULUM.read_text(encoding='utf-8').splitlines() if line.strip()]


def test_child_curriculum_has_exercise_art_and_finance_tasks():
    ids = {row['id'] for row in rows()}
    assert {'mm_child_exercise_001', 'mm_child_art_001', 'mm_child_finance_001'} <= ids


def test_child_curriculum_is_media_gated_and_non_diagnostic():
    child = [row for row in rows() if row['id'].startswith('mm_child_')]
    assert child
    assert all(row['media_required'] is True for row in child)
    assert all(row['privacy_classification'] == 'synthetic_media_required_no_private_media' for row in child)
    assert all('must_not_diagnose' not in row['instruction'] for row in child)
    exercise = next(row for row in child if row['id'] == 'mm_child_exercise_001')
    assert exercise['evaluation_contract']['must_not_diagnose'] is True
