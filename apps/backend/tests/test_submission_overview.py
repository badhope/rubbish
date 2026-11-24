from httpx import AsyncClient


async def test_submission_overview_is_editor_readable(
    client: AsyncClient, admin_user: dict
) -> None:
    response = await client.get(
        "/api/submissions/overview",
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 0
    assert body["resource_total"] == 0
    assert body["published"] == 0
    assert body["draft"] == 0
    assert body["duplicate_accepted"] == 0
