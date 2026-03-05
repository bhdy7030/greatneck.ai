"""Multi-source community scraper for batch ingestion via Crawl4AI.

Sources: Reddit, Yelp, Google Reviews, RedNote (Xiaohongshu), Patch, Island Now, GN Record.
Uses Playwright under the hood — run `crawl4ai-setup` once after install.
"""
from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass
from urllib.parse import quote_plus

import httpx

logger = logging.getLogger(__name__)


@dataclass
class SocialPost:
    title: str
    content: str
    url: str
    source_type: str = ""  # Reddit, Yelp, Patch, etc.


# ---------------------------------------------------------------------------
# Source definitions: each source has search URL templates
# ---------------------------------------------------------------------------

AREA_TERMS = [
    "Great Neck",
    "Great Neck Plaza",
    "Great Neck Estates",
    "Kensington NY",
    "Thomaston NY",
]


def _reddit_urls(terms: list[str] | None = None) -> list[str]:
    """Build Reddit search URLs (old.reddit renders server-side HTML)."""
    subs = ["longisland", "nassaucounty"]
    t = terms or AREA_TERMS
    urls = []
    for sub in subs:
        for term in t:
            q = quote_plus(term)
            urls.append(
                f"https://old.reddit.com/r/{sub}/search?q={q}&restrict_sr=on&sort=relevance&t=year"
            )
    return urls


def _yelp_urls() -> list[str]:
    """Build Yelp search URLs for Great Neck area."""
    categories = ["restaurants", "home+services", "beauty+spas", "shopping"]
    return [
        f"https://www.yelp.com/search?find_desc={cat}&find_loc=Great+Neck+NY"
        for cat in categories
    ]


def _news_urls() -> list[str]:
    """Build local news/blog URLs."""
    return [
        "https://www.theislandnow.com/?s=Great+Neck",
        "https://patch.com/new-york/greatneck",
        "https://www.greatneckrecord.com/?s=Great+Neck",
    ]


def _rednote_urls() -> list[str]:
    """Build RedNote/Xiaohongshu search URLs."""
    return [
        "https://www.xiaohongshu.com/search_result?keyword=Great+Neck",
        "https://www.xiaohongshu.com/search_result?keyword=Great+Neck+NY",
    ]


# ---------------------------------------------------------------------------
# Parsing: extract posts from crawled markdown
# ---------------------------------------------------------------------------

_MD_LINK_RE = re.compile(r"\[([^\]]+)\]\([^)]*\)")


def _clean_title(raw: str) -> str:
    """Strip markdown formatting from a title string."""
    title = _MD_LINK_RE.sub(r"\1", raw)
    title = title.strip("# []()>*`")
    return title.strip()


def _parse_reddit_markdown(markdown: str, url: str) -> list[SocialPost]:
    """Extract posts from a Reddit/Google search result page markdown."""
    posts = []
    sections = re.split(r"\n---\n|\n\*\*\*\n|\n#{1,3}\s", markdown)
    for section in sections:
        section = section.strip()
        if len(section) < 30:
            continue
        lines = section.split("\n", 1)
        title = _clean_title(lines[0])
        if not title or len(title) < 5:
            continue
        content = lines[1].strip() if len(lines) > 1 else ""
        # Try to extract subreddit from content links
        sub_match = re.search(r"reddit\.com/r/(\w+)", section)
        sub = sub_match.group(1) if sub_match else ""
        posts.append(SocialPost(
            title=title[:200],
            content=content[:1000],
            url=url,
            source_type=f"Reddit r/{sub}" if sub else "Reddit",
        ))
    return posts


def _parse_generic_markdown(markdown: str, url: str, source_type: str) -> list[SocialPost]:
    """Extract posts/articles from generic page markdown."""
    posts = []
    sections = re.split(r"\n#{1,3}\s|\n---\n|\n\*\*\*\n", markdown)
    for section in sections:
        section = section.strip()
        if len(section) < 50:
            continue
        lines = section.split("\n", 1)
        title = _clean_title(lines[0])
        if not title or len(title) < 5:
            continue
        content = lines[1].strip() if len(lines) > 1 else ""
        posts.append(SocialPost(
            title=title[:200],
            content=content[:1000],
            url=url,
            source_type=source_type,
        ))
    return posts


_DOMAIN_LABELS: dict[str, str] = {
    "reddit.com": "Reddit",
    "yelp.com": "Yelp",
    "google.com/maps": "Google Reviews",
    "tripadvisor.com": "TripAdvisor",
    "xiaohongshu.com": "RedNote",
    "patch.com": "Patch",
    "theislandnow.com": "Island Now",
    "greatneckrecord.com": "GN Record",
}

_DOMAIN_PARSERS: list[tuple[str, str]] = [
    ("reddit.com", ""),  # handled separately
    ("yelp.com", "Yelp"),
    ("xiaohongshu.com", "RedNote"),
    ("patch.com", "Patch"),
    ("theislandnow.com", "Island Now"),
    ("greatneckrecord.com", "GN Record"),
]


def _parse_crawl_result(markdown: str, url: str) -> list[SocialPost]:
    """Route to the right parser based on URL domain."""
    if "reddit.com" in url:
        return _parse_reddit_markdown(markdown, url)
    for domain, label in _DOMAIN_PARSERS:
        if domain in url:
            return _parse_generic_markdown(markdown, url, label)
    return _parse_generic_markdown(markdown, url, "Web")


# ---------------------------------------------------------------------------
# Main scrape function
# ---------------------------------------------------------------------------

async def scrape_community(
    include_reddit: bool = True,
    include_yelp: bool = True,
    include_news: bool = True,
    include_rednote: bool = True,
    include_google: bool = True,
    search_terms: list[str] | None = None,
) -> list[SocialPost]:
    """Scrape community posts from multiple sources using Crawl4AI.

    Returns deduplicated list of SocialPost ready for ingestion.

    Requires one-time setup: pip install 'crawl4ai>=0.8.0' && crawl4ai-setup
    """
    from crawl4ai import (
        AsyncWebCrawler,
        BrowserConfig,
        CrawlerRunConfig,
        CacheMode,
        MemoryAdaptiveDispatcher,
    )

    urls: list[str] = []
    if include_reddit:
        urls.extend(_reddit_urls(search_terms))
    if include_yelp:
        urls.extend(_yelp_urls())
    if include_news:
        urls.extend(_news_urls())
    if include_rednote:
        urls.extend(_rednote_urls())

    logger.info(f"Crawling {len(urls)} URLs across community sources...")

    browser_config = BrowserConfig(
        headless=True,
        verbose=False,
        text_mode=True,        # skip images — saves memory
        light_mode=True,       # disable background features
    )

    run_config = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        word_count_threshold=20,
        page_timeout=30000,          # 30s per page
        wait_until="load",           # full page load (needed for JS-heavy sites)
        check_robots_txt=False,      # batch ingest — public content, one-time runs
        remove_overlay_elements=True, # remove popups/modals
        process_iframes=False,
        stream=True,                 # process results as they arrive (memory efficient)
    )

    dispatcher = MemoryAdaptiveDispatcher(
        memory_threshold_percent=85.0,
        max_session_permit=5,  # limit concurrency — each Chromium ~200MB
    )

    all_posts: list[SocialPost] = []
    seen_titles: set[str] = set()

    async with AsyncWebCrawler(config=browser_config) as crawler:
        async for result in await crawler.arun_many(
            urls=urls,
            config=run_config,
            dispatcher=dispatcher,
        ):
            if not result.success:
                logger.warning(
                    f"Failed [{result.status_code}] {result.url}: "
                    f"{result.error_message or 'unknown error'}"
                )
                continue

            if not result.markdown:
                logger.debug(f"Empty markdown for {result.url}")
                continue

            posts = _parse_crawl_result(result.markdown, result.url)
            for post in posts:
                title_key = post.title.lower().strip()
                if title_key in seen_titles:
                    continue
                seen_titles.add(title_key)
                all_posts.append(post)

            logger.info(f"Crawled {result.url}: {len(posts)} posts extracted")

    # --- Tavily fallback for sources that Crawl4AI couldn't scrape ---
    crawled_domains = {_domain_from_url(p.url) for p in all_posts if _domain_from_url(p.url)}
    desired_domains = set()
    if include_yelp:
        desired_domains.add("yelp.com")
    if include_rednote:
        desired_domains.add("xiaohongshu.com")
    failed_domains = desired_domains - crawled_domains

    if failed_domains:
        tavily_posts = await _tavily_fallback(
            failed_domains, search_terms or AREA_TERMS, seen_titles
        )
        all_posts.extend(tavily_posts)

    # --- Google Reviews: always via Tavily (JS-heavy, can't be crawled) ---
    if include_google:
        google_posts = await _google_reviews_fallback(
            search_terms or AREA_TERMS, seen_titles
        )
        all_posts.extend(google_posts)

    logger.info(f"Scraped {len(all_posts)} community posts total from {len(urls)} URLs")
    return all_posts


def _domain_from_url(url: str) -> str:
    """Extract base domain from URL."""
    for domain in _DOMAIN_LABELS:
        if domain in url:
            return domain
    return ""


async def _tavily_fallback(
    domains: set[str], terms: list[str], seen_titles: set[str]
) -> list[SocialPost]:
    """Use Tavily include_domains for sources that Crawl4AI couldn't scrape."""
    api_key = os.environ.get("TAVILY_API_KEY", "")
    if not api_key:
        logger.info("Tavily fallback skipped (TAVILY_API_KEY not set)")
        return []

    domain_list = list(domains)
    logger.info(f"Tavily fallback for: {domain_list}")
    posts: list[SocialPost] = []

    for term in terms:
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(
                    "https://api.tavily.com/search",
                    json={
                        "api_key": api_key,
                        "query": term,
                        "max_results": 5,
                        "include_answer": False,
                        "include_domains": domain_list,
                    },
                )
                resp.raise_for_status()
                results = resp.json().get("results", [])
        except Exception as e:
            logger.warning(f"Tavily fallback failed for '{term}': {e}")
            continue

        for r in results:
            url = r.get("url", "")
            title = r.get("title", "")
            content = r.get("content", "")
            if not title or not url:
                continue
            title_key = title.lower().strip()
            if title_key in seen_titles:
                continue
            seen_titles.add(title_key)

            source_type = "Web"
            for domain, label in _DOMAIN_LABELS.items():
                if domain in url:
                    source_type = label
                    break

            posts.append(SocialPost(
                title=title[:200],
                content=content[:1000],
                url=url,
                source_type=source_type,
            ))

    logger.info(f"Tavily fallback: {len(posts)} additional posts")
    return posts


# Review-specific queries for Google Reviews search
_REVIEW_QUERIES = [
    "Great Neck restaurant reviews",
    "Great Neck NY salon reviews",
    "Great Neck home services reviews",
    "Great Neck Plaza shopping reviews",
    "Great Neck NY doctor dentist reviews",
]


async def _google_reviews_fallback(
    terms: list[str], seen_titles: set[str]
) -> list[SocialPost]:
    """Search for Google Reviews via Tavily without domain restriction.

    Google Maps/Reviews can't be filtered via include_domains (google.com is too
    broad), so we use review-focused queries that naturally surface Google Maps
    review snippets and other review sites (TripAdvisor, etc.).
    """
    api_key = os.environ.get("TAVILY_API_KEY", "")
    if not api_key:
        return []

    logger.info("Google Reviews fallback via Tavily review queries")
    posts: list[SocialPost] = []

    for query in _REVIEW_QUERIES:
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(
                    "https://api.tavily.com/search",
                    json={
                        "api_key": api_key,
                        "query": query,
                        "max_results": 5,
                        "include_answer": False,
                    },
                )
                resp.raise_for_status()
                results = resp.json().get("results", [])
        except Exception as e:
            logger.warning(f"Google Reviews fallback failed for '{query}': {e}")
            continue

        for r in results:
            url = r.get("url", "")
            title = r.get("title", "")
            content = r.get("content", "")
            if not title or not url:
                continue
            title_key = title.lower().strip()
            if title_key in seen_titles:
                continue
            seen_titles.add(title_key)

            source_type = "Reviews"
            for domain, label in _DOMAIN_LABELS.items():
                if domain in url:
                    source_type = label
                    break

            posts.append(SocialPost(
                title=title[:200],
                content=content[:1000],
                url=url,
                source_type=source_type,
            ))

    logger.info(f"Google Reviews fallback: {len(posts)} review posts")
    return posts


def format_post_for_ingestion(post: SocialPost) -> str:
    """Format a SocialPost as flat text for KB ingestion."""
    parts = []
    if post.source_type:
        parts.append(f"[{post.source_type}] {post.title}")
    else:
        parts.append(post.title)
    if post.content:
        parts.append(post.content)
    return "\n\n".join(parts)
