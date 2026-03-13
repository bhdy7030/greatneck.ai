"""Guide lifecycle tests: save/unsave, step status, user guide CRUD."""
import json
from tests.conftest import create_test_user


def test_save_and_unsave_guide():
    from db import save_guide, unsave_guide, get_saved_guide_ids
    user = create_test_user()
    uid = user["id"]

    save_guide(uid, None, "test-guide-1")
    saved = get_saved_guide_ids(uid, None)
    assert "test-guide-1" in saved

    unsave_guide(uid, None, "test-guide-1")
    saved = get_saved_guide_ids(uid, None)
    assert "test-guide-1" not in saved


def test_save_guide_idempotent():
    from db import save_guide, get_saved_guide_ids
    user = create_test_user()
    uid = user["id"]

    save_guide(uid, None, "test-guide-2")
    save_guide(uid, None, "test-guide-2")
    saved = get_saved_guide_ids(uid, None)
    assert saved.count("test-guide-2") == 1


def test_step_status_update():
    from db import save_guide, update_step_status, get_step_statuses
    user = create_test_user()
    uid = user["id"]

    save_guide(uid, None, "test-guide-3")
    update_step_status(uid, None, "test-guide-3", "step-1", status="in_progress")

    statuses = get_step_statuses(uid, None, "test-guide-3")
    step = next((s for s in statuses if s["step_id"] == "step-1"), None)
    assert step is not None
    assert step["status"] == "in_progress"


def test_step_status_with_note():
    from db import save_guide, update_step_status, get_step_statuses
    user = create_test_user()
    uid = user["id"]

    save_guide(uid, None, "test-guide-4")
    update_step_status(uid, None, "test-guide-4", "step-1", status="todo", note="check back later")

    statuses = get_step_statuses(uid, None, "test-guide-4")
    step = next((s for s in statuses if s["step_id"] == "step-1"), None)
    assert step["note"] == "check back later"


def test_user_guide_crud():
    from db import create_user_guide, get_user_guide, update_user_guide, delete_user_guide
    user = create_test_user()
    uid = user["id"]

    raw = {
        "title": "Test Guide",
        "description": "A test guide",
        "icon": "📋",
        "color": "#4CAF50",
        "steps": [
            {"id": "s1", "title": "Step 1", "description": "Do step 1"},
        ],
    }
    # create_user_guide(user_id, session_id, guide_data, source_guide_id=None) -> guide_id str
    guide_id = create_user_guide(uid, None, raw)
    assert guide_id is not None
    assert guide_id.startswith("ug-")

    fetched = get_user_guide(guide_id)
    assert fetched is not None
    assert fetched["user_id"] == uid

    raw["title"] = "Updated Guide"
    update_user_guide(guide_id, uid, None, raw)
    fetched2 = get_user_guide(guide_id)
    assert fetched2["guide_data"]["title"] == "Updated Guide"

    delete_user_guide(guide_id, user_id=uid)
    assert get_user_guide(guide_id) is None
