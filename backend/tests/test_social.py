"""Social features tests: comments, likes, notifications."""
from tests.conftest import create_test_user
from db import create_user_guide


def _make_guide(user_id: int, guide_id_suffix: str = "social-g1") -> str:
    """Create a minimal user guide for social tests. Returns guide_id."""
    raw = {
        "title": "Social Test Guide",
        "description": "A guide for testing social features",
        "icon": "🧪",
        "color": "#2196F3",
        "steps": [{"id": "s1", "title": "Step 1", "description": "Do it"}],
    }
    return create_user_guide(user_id, None, raw)


def test_comment_create_and_list():
    from db import create_comment, get_comments_for_guide
    user = create_test_user()
    guide_id = _make_guide(user["id"])

    comment = create_comment(guide_id, user["id"], "Great guide!")
    assert comment["body"] == "Great guide!"

    comments = get_comments_for_guide(guide_id)
    assert len(comments) >= 1
    assert any(c["body"] == "Great guide!" for c in comments)


def test_comment_delete():
    from db import create_comment, delete_comment, get_comments_for_guide
    user = create_test_user()
    guide_id = _make_guide(user["id"])

    comment = create_comment(guide_id, user["id"], "To be deleted")
    result = delete_comment(comment["id"], user["id"])
    assert result is True

    comments = get_comments_for_guide(guide_id)
    assert not any(c["id"] == comment["id"] for c in comments)


def test_like_toggle():
    from db import toggle_like
    user = create_test_user()
    guide_id = _make_guide(user["id"])

    # Like — toggle_like(user_id, target_type, target_id)
    result = toggle_like(user["id"], "guide", guide_id)
    assert result["liked"] is True
    assert result["count"] >= 1

    # Unlike
    result2 = toggle_like(user["id"], "guide", guide_id)
    assert result2["liked"] is False
    assert result2["count"] == result["count"] - 1


def test_notification_create_and_read():
    from db import create_notification, get_notifications, count_unread_notifications, mark_notifications_read
    user = create_test_user()
    bob = create_test_user("bob@test.pytest", "Bob Test")

    create_notification(
        user_id=user["id"],
        type="comment",
        actor_id=bob["id"],
        target_type="guide",
        target_id="test-notif-g1",
        body="Bob commented on your guide",
    )

    unread = count_unread_notifications(user["id"])
    assert unread >= 1

    notifs = get_notifications(user["id"])
    assert len(notifs) >= 1

    mark_notifications_read(user["id"])
    assert count_unread_notifications(user["id"]) == 0
