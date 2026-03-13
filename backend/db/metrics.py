"""LLM usage, pipeline events, page visits, batch inserts, rollup, DAU, timeseries."""
from __future__ import annotations

import json

from db.connection import _exec, _exec_one, _exec_modify, _exec_scalar, _PgConnWrapper


# ── LLM Usage (batch insert + aggregation) ────────────────────


def batch_insert_usage(records: list) -> None:
    """Batch-insert UsageRecord objects into llm_usage table."""
    if not records:
        return
    from psycopg2.extras import execute_values
    with _PgConnWrapper() as conn:
        with conn.cursor() as cur:
            sql = """INSERT INTO llm_usage
                (session_id, conversation_id, role, model,
                 prompt_tokens, completion_tokens, total_tokens,
                 cost_usd, latency_ms, source)
                VALUES %s"""
            values = [
                (r.session_id, r.conversation_id, r.role, r.model,
                 r.prompt_tokens, r.completion_tokens, r.total_tokens,
                 r.cost_usd, r.latency_ms, getattr(r, 'source', 'user') or 'user')
                for r in records
            ]
            execute_values(cur, sql, values)
            conn.commit()


def batch_insert_pipeline_events(events: list) -> None:
    """Batch-insert PipelineEvent objects into pipeline_events table."""
    if not events:
        return
    from psycopg2.extras import execute_values
    with _PgConnWrapper() as conn:
        with conn.cursor() as cur:
            sql = """INSERT INTO pipeline_events
                (session_id, conversation_id, event_type, event_name,
                 duration_ms, metadata, success)
                VALUES %s"""
            values = [
                (e.session_id, e.conversation_id, e.event_type, e.event_name,
                 e.duration_ms, json.dumps(e.metadata) if e.metadata else '{}',
                 e.success)
                for e in events
            ]
            execute_values(cur, sql, values)
            conn.commit()


def batch_insert_page_visits(visits: list) -> None:
    """Batch-insert PageVisit objects into page_visits table."""
    if not visits:
        return
    from psycopg2.extras import execute_values
    with _PgConnWrapper() as conn:
        with conn.cursor() as cur:
            sql = """INSERT INTO page_visits
                (session_id, user_id, page, referrer, user_agent)
                VALUES %s"""
            values = [
                (v.session_id, v.user_id or None, v.page,
                 v.referrer, v.user_agent)
                for v in visits
            ]
            execute_values(cur, sql, values)
            conn.commit()


def get_daily_token_usage(days: int = 30) -> list[dict]:
    """Daily totals: tokens, cost, call count."""
    return _exec(
        """SELECT DATE(created_at)::TEXT AS date,
                  SUM(prompt_tokens) AS prompt_tokens,
                  SUM(completion_tokens) AS completion_tokens,
                  SUM(total_tokens) AS total_tokens,
                  SUM(cost_usd) AS cost_usd,
                  COUNT(*) AS call_count
           FROM llm_usage
           WHERE created_at >= NOW() - make_interval(days => %s)
           GROUP BY DATE(created_at)
           ORDER BY DATE(created_at)""",
        (days,),
    )


def get_usage_by_role(days: int = 7) -> list[dict]:
    """Token usage broken down by agent role."""
    return _exec(
        """SELECT role,
                  SUM(prompt_tokens) AS prompt_tokens,
                  SUM(completion_tokens) AS completion_tokens,
                  SUM(total_tokens) AS total_tokens,
                  SUM(cost_usd) AS cost_usd,
                  COUNT(*) AS call_count,
                  ROUND(AVG(latency_ms)) AS avg_latency_ms
           FROM llm_usage
           WHERE created_at >= NOW() - make_interval(days => %s)
           GROUP BY role
           ORDER BY SUM(total_tokens) DESC""",
        (days,),
    )


def get_usage_by_model(days: int = 7) -> list[dict]:
    """Token usage broken down by model."""
    return _exec(
        """SELECT model,
                  SUM(total_tokens) AS total_tokens,
                  SUM(cost_usd) AS cost_usd,
                  COUNT(*) AS call_count
           FROM llm_usage
           WHERE created_at >= NOW() - make_interval(days => %s)
           GROUP BY model
           ORDER BY SUM(cost_usd) DESC""",
        (days,),
    )


# ── Analytics Queries ───────────────────────────────────────────


def get_dau(days: int = 30) -> list[dict]:
    return _exec(
        """SELECT DATE(last_query_at)::TEXT AS date,
                  COUNT(DISTINCT user_id) AS users,
                  COUNT(DISTINCT session_id) AS sessions
           FROM usage_tracking
           WHERE last_query_at >= NOW() - make_interval(days => %s)
           GROUP BY DATE(last_query_at)
           ORDER BY DATE(last_query_at)""",
        (days,),
    )


def get_daily_queries(days: int = 30) -> list[dict]:
    return _exec(
        """SELECT DATE(last_query_at)::TEXT AS date,
                  SUM(query_count) AS count
           FROM usage_tracking
           WHERE last_query_at >= NOW() - make_interval(days => %s)
           GROUP BY DATE(last_query_at)
           ORDER BY DATE(last_query_at)""",
        (days,),
    )


def get_top_agents(days: int = 7) -> list[dict]:
    return _exec(
        """SELECT agent_used AS agent, COUNT(*) AS count
           FROM messages
           WHERE agent_used IS NOT NULL
             AND created_at >= NOW() - make_interval(days => %s)
           GROUP BY agent_used
           ORDER BY count DESC
           LIMIT 10""",
        (days,),
    )


def get_earliest_usage_date() -> str | None:
    """Return the earliest date in llm_usage, or None if table is empty."""
    return _exec_scalar(
        "SELECT MIN(created_at::date)::TEXT FROM llm_usage",
    )


def _upsert_metric(date: str, metric_type: str, dimension: str,
                    count_val: int = 0, sum_val: float = 0,
                    avg_val: float = 0, p95_val: float = 0,
                    min_val: float = 0, max_val: float = 0):
    """Upsert a single row into metrics_daily."""
    with _PgConnWrapper() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO metrics_daily
                    (date, metric_type, dimension, count, sum_value,
                     avg_value, p95_value, min_value, max_value, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (date, metric_type, dimension)
                DO UPDATE SET
                    count = EXCLUDED.count,
                    sum_value = EXCLUDED.sum_value,
                    avg_value = EXCLUDED.avg_value,
                    p95_value = EXCLUDED.p95_value,
                    min_value = EXCLUDED.min_value,
                    max_value = EXCLUDED.max_value,
                    updated_at = NOW()
            """, (date, metric_type, dimension, count_val, sum_val,
                  avg_val, p95_val, min_val, max_val))
            conn.commit()


def rollup_daily_metrics(target_date: str) -> int:
    """Aggregate raw llm_usage + usage_tracking into metrics_daily for a given date.

    target_date: 'YYYY-MM-DD' string.
    Returns total number of rows upserted.
    """
    count = 0

    # 1. Token/cost aggregation by role
    rows = _exec(
        """SELECT role,
                  COUNT(*) AS cnt,
                  SUM(total_tokens) AS sum_tokens,
                  AVG(total_tokens) AS avg_tokens,
                  MIN(total_tokens) AS min_tokens,
                  MAX(total_tokens) AS max_tokens,
                  SUM(cost_usd) AS sum_cost
           FROM llm_usage
           WHERE created_at::date = %s
           GROUP BY role""",
        (target_date,),
    )
    for r in rows:
        _upsert_metric(target_date, 'tokens', r['role'],
                        count_val=r['cnt'], sum_val=r['sum_tokens'] or 0,
                        avg_val=r['avg_tokens'] or 0,
                        min_val=r['min_tokens'] or 0, max_val=r['max_tokens'] or 0)
        _upsert_metric(target_date, 'cost', r['role'],
                        count_val=r['cnt'], sum_val=r['sum_cost'] or 0)
        count += 2

    # 2. Token/cost total (all roles combined)
    total = _exec_one(
        """SELECT COUNT(*) AS cnt,
                  SUM(total_tokens) AS sum_tokens,
                  AVG(total_tokens) AS avg_tokens,
                  MIN(total_tokens) AS min_tokens,
                  MAX(total_tokens) AS max_tokens,
                  SUM(cost_usd) AS sum_cost
           FROM llm_usage
           WHERE created_at::date = %s""",
        (target_date,),
    )
    if total and total['cnt']:
        _upsert_metric(target_date, 'tokens', '_total',
                        count_val=total['cnt'], sum_val=total['sum_tokens'] or 0,
                        avg_val=total['avg_tokens'] or 0,
                        min_val=total['min_tokens'] or 0, max_val=total['max_tokens'] or 0)
        _upsert_metric(target_date, 'cost', '_total',
                        count_val=total['cnt'], sum_val=total['sum_cost'] or 0)
        count += 2

    # 3. Latency aggregation by role
    lat_rows = _exec(
        """SELECT role,
                  COUNT(*) AS cnt,
                  AVG(latency_ms) AS avg_lat,
                  MIN(latency_ms) AS min_lat,
                  MAX(latency_ms) AS max_lat,
                  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_lat
           FROM llm_usage
           WHERE created_at::date = %s AND latency_ms > 0
           GROUP BY role""",
        (target_date,),
    )
    for r in lat_rows:
        _upsert_metric(target_date, 'latency', r['role'],
                        count_val=r['cnt'],
                        avg_val=r['avg_lat'] or 0,
                        p95_val=r['p95_lat'] or 0,
                        min_val=r['min_lat'] or 0, max_val=r['max_lat'] or 0)
        count += 1

    # 4. Token aggregation by model
    model_rows = _exec(
        """SELECT model,
                  COUNT(*) AS cnt,
                  SUM(total_tokens) AS sum_tokens,
                  SUM(cost_usd) AS sum_cost
           FROM llm_usage
           WHERE created_at::date = %s
           GROUP BY model""",
        (target_date,),
    )
    for r in model_rows:
        dim = f"model:{r['model']}"
        _upsert_metric(target_date, 'tokens', dim,
                        count_val=r['cnt'], sum_val=r['sum_tokens'] or 0)
        _upsert_metric(target_date, 'cost', dim,
                        count_val=r['cnt'], sum_val=r['sum_cost'] or 0)
        count += 2

    # 4b. Token/cost aggregation by source (user vs background)
    try:
        src_rows = _exec(
            """SELECT COALESCE(source, 'user') AS src,
                      COUNT(*) AS cnt,
                      SUM(total_tokens) AS sum_tokens,
                      SUM(cost_usd) AS sum_cost
               FROM llm_usage
               WHERE created_at::date = %s
               GROUP BY COALESCE(source, 'user')""",
            (target_date,),
        )
        for r in src_rows:
            dim = f"source:{r['src']}"
            _upsert_metric(target_date, 'tokens', dim,
                            count_val=r['cnt'], sum_val=r['sum_tokens'] or 0)
            _upsert_metric(target_date, 'cost', dim,
                            count_val=r['cnt'], sum_val=r['sum_cost'] or 0)
            count += 2
    except Exception:
        pass  # source column may not exist yet on older data

    # 5. Query count (total queries from llm_usage)
    if total and total['cnt']:
        _upsert_metric(target_date, 'queries', '_total', count_val=total['cnt'])
        count += 1

    # 6. DAU from usage_tracking
    dau = _exec_scalar(
        """SELECT COUNT(DISTINCT session_id)
           FROM usage_tracking
           WHERE last_query_at::date = %s""",
        (target_date,),
    )
    if dau:
        _upsert_metric(target_date, 'dau', '_total', count_val=dau)
        count += 1

    # 7. Pipeline events aggregation (if table exists)
    try:
        pe_rows = _exec(
            """SELECT event_type,
                      COUNT(*) AS cnt
               FROM pipeline_events
               WHERE created_at::date = %s
               GROUP BY event_type""",
            (target_date,),
        )
        for r in pe_rows:
            _upsert_metric(target_date, 'pipeline', r['event_type'],
                            count_val=r['cnt'])
            count += 1
    except Exception:
        pass

    # 8. Page visits by page
    try:
        pv_rows = _exec(
            """SELECT page,
                      COUNT(*) AS cnt
               FROM page_visits
               WHERE created_at::date = %s
               GROUP BY page""",
            (target_date,),
        )
        for r in pv_rows:
            _upsert_metric(target_date, 'visits', r['page'], count_val=r['cnt'])
            count += 1

        total_views = sum(r['cnt'] for r in pv_rows)
        if total_views:
            _upsert_metric(target_date, 'visits', '_total', count_val=total_views)
            count += 1

        # 9. Unique visitors (unique session_ids)
        uv = _exec_scalar(
            """SELECT COUNT(DISTINCT session_id)
               FROM page_visits
               WHERE created_at::date = %s""",
            (target_date,),
        )
        if uv:
            _upsert_metric(target_date, 'unique_visitors', '_total', count_val=uv)
            count += 1

        # 10. Authenticated visitors (unique user_ids, non-null)
        av = _exec_scalar(
            """SELECT COUNT(DISTINCT user_id)
               FROM page_visits
               WHERE created_at::date = %s AND user_id IS NOT NULL""",
            (target_date,),
        )
        if av:
            _upsert_metric(target_date, 'authenticated_visitors', '_total', count_val=av)
            count += 1
    except Exception:
        pass

    return count


# ── Metrics API query functions ────────────────────────────────────


def get_metrics_timeseries(metric_type: str, start_date: str, end_date: str,
                           dimension: str = "_total") -> list[dict]:
    """Return daily timeseries from metrics_daily for charting."""
    return _exec(
        """SELECT date::TEXT, count, sum_value, avg_value, p95_value, min_value, max_value
           FROM metrics_daily
           WHERE metric_type = %s AND dimension = %s
             AND date >= %s AND date <= %s
           ORDER BY date""",
        (metric_type, dimension, start_date, end_date),
    )


def get_metrics_summary(start_date: str, end_date: str) -> dict:
    """Return aggregated KPIs across a date range from metrics_daily."""
    row = _exec_one(
        """SELECT
              COALESCE(SUM(CASE WHEN metric_type='cost' AND dimension='_total' THEN sum_value END), 0) AS total_cost,
              COALESCE(SUM(CASE WHEN metric_type='tokens' AND dimension='_total' THEN sum_value END), 0) AS total_tokens,
              COALESCE(SUM(CASE WHEN metric_type='tokens' AND dimension='_total' THEN count END), 0) AS total_llm_calls,
              COALESCE(SUM(CASE WHEN metric_type='queries' AND dimension='_total' THEN count END), 0) AS total_queries,
              COALESCE(AVG(CASE WHEN metric_type='dau' AND dimension='_total' THEN count END), 0) AS avg_dau,
              COALESCE(AVG(CASE WHEN metric_type='latency' AND dimension='_total' THEN avg_value END), 0) AS avg_latency
           FROM metrics_daily
           WHERE date >= %s AND date <= %s""",
        (start_date, end_date),
    )
    return row or {
        "total_cost": 0, "total_tokens": 0, "total_llm_calls": 0,
        "total_queries": 0, "avg_dau": 0, "avg_latency": 0,
    }


def get_metrics_breakdown(metric_type: str, start_date: str, end_date: str,
                          dimension_prefix: str = "") -> list[dict]:
    """Return dimension-level breakdown for a metric_type."""
    if dimension_prefix:
        like_pattern = f"{dimension_prefix}:%"
        return _exec(
            """SELECT dimension,
                      SUM(count) AS total_count,
                      SUM(sum_value) AS total_value,
                      AVG(avg_value) AS avg_value
               FROM metrics_daily
               WHERE metric_type = %s AND date >= %s AND date <= %s
                 AND dimension LIKE %s
               GROUP BY dimension
               ORDER BY total_value DESC""",
            (metric_type, start_date, end_date, like_pattern),
        )

    return _exec(
        """SELECT dimension,
                  SUM(count) AS total_count,
                  SUM(sum_value) AS total_value,
                  AVG(avg_value) AS avg_value
           FROM metrics_daily
           WHERE metric_type = %s AND date >= %s AND date <= %s
             AND dimension != '_total'
             AND dimension NOT LIKE '%%:%%'
           GROUP BY dimension
           ORDER BY total_count DESC""",
        (metric_type, start_date, end_date),
    )


def get_pipeline_events_summary(start_date: str, end_date: str) -> dict:
    """Return pipeline event stats from pipeline_events table."""
    result = {"agent_calls": [], "tool_calls": [], "stage_durations": [], "cache_stats": []}
    try:
        result["agent_calls"] = _exec(
            """SELECT event_name, COUNT(*) AS count
               FROM pipeline_events
               WHERE event_type = 'agent_selected'
                 AND created_at::date >= %s AND created_at::date <= %s
               GROUP BY event_name ORDER BY count DESC""",
            (start_date, end_date),
        )
        result["tool_calls"] = _exec(
            """SELECT event_name,
                      COUNT(*) AS count,
                      AVG(duration_ms) AS avg_duration_ms,
                      SUM(CASE WHEN success THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) AS success_rate
               FROM pipeline_events
               WHERE event_type = 'tool_call'
                 AND created_at::date >= %s AND created_at::date <= %s
               GROUP BY event_name ORDER BY count DESC""",
            (start_date, end_date),
        )
        result["stage_durations"] = _exec(
            """SELECT event_name,
                      COUNT(*) AS count,
                      AVG(duration_ms) AS avg_duration_ms,
                      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_duration_ms,
                      MAX(duration_ms) AS max_duration_ms
               FROM pipeline_events
               WHERE event_type = 'pipeline_stage'
                 AND created_at::date >= %s AND created_at::date <= %s
               GROUP BY event_name ORDER BY event_name""",
            (start_date, end_date),
        )
        result["cache_stats"] = _exec(
            """SELECT event_type, event_name, COUNT(*) AS count
               FROM pipeline_events
               WHERE event_type IN ('cache_hit', 'cache_miss')
                 AND created_at::date >= %s AND created_at::date <= %s
               GROUP BY event_type, event_name ORDER BY count DESC""",
            (start_date, end_date),
        )
    except Exception:
        pass
    return result


def get_realtime_metrics() -> dict:
    """Return today's partial metrics from raw tables (before rollup runs)."""
    row = _exec_one(
        """SELECT COUNT(*) AS llm_calls,
                  COALESCE(SUM(total_tokens), 0) AS tokens,
                  COALESCE(SUM(cost_usd), 0) AS cost_usd,
                  COALESCE(AVG(latency_ms), 0) AS avg_latency_ms
           FROM llm_usage
           WHERE created_at::date = CURRENT_DATE""",
    )
    dau = _exec_scalar(
        """SELECT COUNT(DISTINCT session_id)
           FROM usage_tracking
           WHERE last_query_at::date = CURRENT_DATE""",
    )
    return {
        "llm_calls": row["llm_calls"] if row else 0,
        "tokens": row["tokens"] if row else 0,
        "cost_usd": round(row["cost_usd"], 4) if row else 0,
        "avg_latency_ms": round(row["avg_latency_ms"], 1) if row else 0,
        "dau": dau or 0,
    }
