import pytest

from backend.ai import router


@pytest.fixture(autouse=True)
def fresh_model_cooldowns():
    """The router remembers busy models between requests; every test starts with none."""
    router._cooldown.clear()
    yield
    router._cooldown.clear()
