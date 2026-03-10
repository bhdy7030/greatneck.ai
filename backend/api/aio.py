"""Async helper to offload sync functions to the thread pool."""
from __future__ import annotations

import asyncio
from functools import partial


async def run_sync(func, *args, **kwargs):
    """Run a sync function in the default executor (thread pool).

    Usage:
        result = await run_sync(get_user_by_id, user_id)
        result = await run_sync(some_func, arg1, key=val)
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, partial(func, *args, **kwargs))
