"""Event scrapers for upcoming local events.

Sources:
  - Patch.com Great Neck calendar (area scope)
  - events.longisland.com (longisland scope — entertainment/food/festivals)
  - Eventbrite API (longisland scope — ticketed events)
  - The Island Now (area scope — community/local news events)
  - Great Neck Library via LibCal AJAX API (area scope)
  - Great Neck School District via Finalsite calendar (area scope)
  - Village websites — meetings, hearings, public notices (village scope)

Uses Crawl4AI (Playwright headless browser) for JS-heavy pages.
Uses httpx for pure API endpoints (LibCal JSON, Eventbrite REST).

Each scraper returns list[ScrapedEvent]. Main orchestrator: scrape_all_events().
"""
from __future__ import annotations

import hashlib
import logging
import re
from dataclasses import dataclass, asdict
from datetime import datetime, timedelta

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}
TIMEOUT = 30


@dataclass
class ScrapedEvent:
    title: str
    description: str = ""
    event_date: str = ""  # ISO: '2026-03-15'
    event_time: str = ""  # '7:00 PM'
    end_date: str | None = None
    location: str = ""
    venue: str = ""
    url: str = ""
    image_url: str = ""
    category: str = "general"
    scope: str = "area"
    village: str = ""
    source: str = ""
    source_id: str = ""


def _make_source_id(source: str, text: str) -> str:
    """Generate a stable source_id from source name + identifying text."""
    return hashlib.md5(f"{source}:{text}".encode()).hexdigest()[:16]


def _sanitize(text: str) -> str:
    """Strip markdown artifacts, image tags, and junk from scraped text."""
    # Remove markdown images: ![alt](url)
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", text)
    # Remove markdown links but keep text: [text](url) → text
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
    # Remove remaining raw URLs
    text = re.sub(r"https?://\S+", "", text)
    # Remove markdown formatting
    text = re.sub(r"[#*_`]", "", text)
    # Remove "Featured" labels
    text = re.sub(r"\bFeatured\b", "", text, flags=re.IGNORECASE)
    # Collapse whitespace
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _parse_date_flexible(text: str) -> str | None:
    """Try multiple date formats and return ISO date string or None."""
    text = text.strip()
    for fmt in (
        "%B %d, %Y",    # March 15, 2026
        "%b %d, %Y",    # Mar 15, 2026
        "%m/%d/%Y",     # 03/15/2026
        "%Y-%m-%d",     # 2026-03-15
        "%B %d",        # March 15 (assume current year)
        "%b %d",        # Mar 15
    ):
        try:
            dt = datetime.strptime(text, fmt)
            if dt.year < 2000:
                dt = dt.replace(year=datetime.now().year)
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def _categorize(title: str, description: str = "") -> str:
    """Guess event category from title/description keywords."""
    combined = f"{title} {description}".lower()

    # School — PTA, conferences, school district admin events
    if any(w in combined for w in (
        "pta ", "pta-", "pto ", "pto-", "guidance",
        "parent teacher", "conferences", "dismissal",
        "registration deadline", "sports registration",
        "incoming gr", "assessment m", "shared decision",
        "board of education", "school board",
    )):
        return "school"

    # Student activity — school sports, clubs, competitions, student performances
    if any(w in combined for w in (
        "varsity", "jv ", "tournament", "championship",
        "track", "lacrosse", "baseball", "softball", "soccer",
        "basketball", "volleyball", "fencing", "swimming",
        "debate", "deca", "robotics", "science fair",
        "science symposium", "math team", "quiz bowl",
        "spring sport", "winter sport", "fall sport",
        "rehearsal", "school play", "school concert",
        "prom", "graduation", "commencement",
        "dancing classrooms", "world language week",
    )):
        return "student"

    # Kids — younger children activities (library, community programs)
    if any(w in combined for w in (
        "storytime", "story time", "pre-k", "prek", "kindergarten",
        "toddler", "baby ", "babies", "ages 0",
        "children", "kids", "kid's",
        "puppet", "lego", "pokémon", "pokemon", "minecraft",
        "jr.", "junior", "camp",
        "crawlers", "dancetime",
    )):
        return "kids"

    # Teen / youth
    if any(w in combined for w in (
        "teen", "tween", "youth", "levels",
        "grades 5", "grades 6", "grades 7", "grades 8",
        "grade 5", "grade 6", "grade 7", "grade 8",
    )):
        return "teens"

    # Family
    if any(w in combined for w in (
        "family", "families", "all ages", "fun for",
        "scavenger hunt", "game night", "dance",
    )):
        return "family"

    # Arts & culture
    if any(w in combined for w in (
        "art ", "arts ", "artist", "gallery", "exhibit", "exhibition",
        "painting", "drawing", "photography", "photo ", "camera",
        "craft", "wreath", "knitting", "crochet", "pottery",
        "recital", "organ", "sculpture",
    )):
        return "art"

    # Entertainment — film, music, theater
    if any(w in combined for w in (
        "concert", "music", "show", "theater", "theatre",
        "comedy", "film", "screening", "movie", "performance",
        "acting", "improv", "opera", "jazz", "band",
    )):
        return "entertainment"

    # Food & dining
    if any(w in combined for w in (
        "food", "wine", "taste", "tasting", "restaurant",
        "dining", "chef", "cook", "bake", "brunch",
    )):
        return "food"

    # Festival
    if any(w in combined for w in (
        "festival", "fair", "carnival", "parade", "celebration",
    )):
        return "festival"

    # Health & wellness
    if any(w in combined for w in (
        "health", "wellness", "yoga", "meditation", "fitness",
        "medicare", "knee", "pain", "mental health", "therapy",
        "aarp", "tax assistance",
    )):
        return "health"

    # Education & learning
    if any(w in combined for w in (
        "lecture", "talk", "author", "book", "reading",
        "workshop", "class", "seminar", "webinar", "learn",
        "stem", "diy", "lab", "library", "literacy",
        "history", "historian", "anthropology",
    )):
        return "education"

    # Community & civic
    if any(w in combined for w in (
        "volunteer", "cleanup", "fundraiser", "charity", "donate",
        "community", "rally", "resistance", "civic", "outreach",
        "meeting", "board", "hearing", "council", "agenda",
    )):
        return "community"

    return "general"


# ---------------------------------------------------------------------------
# Crawl4AI helper — shared browser instance for all web scrapers
# ---------------------------------------------------------------------------

async def _crawl_pages(urls: list[str]) -> dict[str, str]:
    """Crawl multiple URLs with Crawl4AI and return {url: markdown} dict.

    Uses a single browser instance for all pages. Returns empty string for
    failed pages (never raises).
    """
    from crawl4ai import (
        AsyncWebCrawler,
        BrowserConfig,
        CrawlerRunConfig,
        CacheMode,
        MemoryAdaptiveDispatcher,
    )

    browser_config = BrowserConfig(
        headless=True,
        verbose=False,
        text_mode=True,
        light_mode=True,
    )
    run_config = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        word_count_threshold=10,
        page_timeout=30000,
        wait_until="load",
        check_robots_txt=False,
        remove_overlay_elements=True,
        process_iframes=False,
        stream=True,
    )
    dispatcher = MemoryAdaptiveDispatcher(
        memory_threshold_percent=85.0,
        max_session_permit=3,
    )

    results: dict[str, str] = {u: "" for u in urls}

    try:
        async with AsyncWebCrawler(config=browser_config) as crawler:
            async for result in await crawler.arun_many(
                urls=urls,
                config=run_config,
                dispatcher=dispatcher,
            ):
                if result.success and result.markdown:
                    results[result.url] = result.markdown
                    logger.debug(f"[crawl4ai] OK {result.url} ({len(result.markdown)} chars)")
                else:
                    logger.warning(
                        f"[crawl4ai] Failed [{result.status_code}] {result.url}: "
                        f"{result.error_message or 'empty'}"
                    )
    except Exception as e:
        logger.error(f"[crawl4ai] Browser error: {e}")

    return results


async def _crawl_single(url: str) -> str:
    """Convenience wrapper — crawl one URL, return its markdown."""
    results = await _crawl_pages([url])
    return results.get(url, "")


# ---------------------------------------------------------------------------
# Source 1: Patch.com Great Neck Calendar (Crawl4AI)
# ---------------------------------------------------------------------------

async def scrape_patch(limit: int = 40) -> list[ScrapedEvent]:
    """Scrape upcoming events from Patch.com Great Neck calendar via Crawl4AI.
    Crawls today through next Sunday to capture the full week ahead.
    """
    events: list[ScrapedEvent] = []

    today = datetime.now()
    today_str = today.strftime("%Y-%m-%d")
    # Build list of date-specific URLs: today through next Sunday
    days_until_sunday = (6 - today.weekday()) % 7 or 7  # at least 1 day ahead
    urls = []
    for offset in range(days_until_sunday + 1):
        d = today + timedelta(days=offset)
        urls.append(f"https://patch.com/new-york/greatneck/calendar?date={d.strftime('%Y-%m-%d')}")

    pages = await _crawl_pages(urls)
    # Merge all pages' markdown
    markdown = "\n".join(md for md in pages.values() if md)
    if not markdown:
        logger.warning("[events:patch] No content from Crawl4AI")
        return events

    # Patch markdown renders calendar events as list items:
    #   * [**Title**](https://patch.com/.../calendar/event/YYYYMMDD/...) 7:00 pm
    # Only match lines starting with list bullet (* ) to avoid header/image dups.
    event_re = re.compile(
        r"^\s*\*\s+"                                   # list bullet prefix
        r"\[(?:\*\*)?(.+?)(?:\*\*)?\]"                 # [**Title**] or [Title]
        r"\((https://patch\.com[^)]*?/calendar/event/(\d{8})/[^)]*)\)"  # (url with date)
        r"(?:\s+(\d{1,2}:\d{2}\s*[aApP][mM]))?"       # optional time
    )

    seen: set[str] = set()
    for line in markdown.split("\n"):
        if len(events) >= limit:
            break

        m = event_re.search(line)
        if not m:
            continue

        title = m.group(1).strip()
        href = m.group(2)
        raw_date = m.group(3)
        event_time = m.group(4) or ""

        if not title or len(title) < 3:
            continue

        event_date = f"{raw_date[:4]}-{raw_date[4:6]}-{raw_date[6:8]}"
        if event_date < today_str:
            continue

        # Deduplicate (Patch lists some events twice — list view + card view)
        key = title.lower()
        if key in seen:
            continue
        seen.add(key)

        # Look ahead for description/venue on next lines
        description = ""
        idx = markdown.find(line)
        if idx >= 0:
            after = markdown[idx + len(line):idx + len(line) + 300]
            for after_line in after.split("\n"):
                after_line = after_line.strip()
                if (after_line and len(after_line) > 5
                        and not after_line.startswith("[")
                        and not after_line.startswith("#")
                        and not after_line.startswith("*")):
                    description = after_line[:200]
                    break

        events.append(ScrapedEvent(
            title=title,
            description=description,
            event_date=event_date,
            event_time=event_time,
            venue=description if description else "",
            url=href,
            category=_categorize(title, description),
            scope="area",
            source="patch",
            source_id=_make_source_id("patch", title + event_date),
        ))

    logger.info(f"[events:patch] Found {len(events)} events")
    return events


# ---------------------------------------------------------------------------
# Source 2: events.longisland.com (Crawl4AI)
# ---------------------------------------------------------------------------

async def scrape_longisland_events(limit: int = 20) -> list[ScrapedEvent]:
    """Scrape upcoming events from events.longisland.com via Crawl4AI."""
    events: list[ScrapedEvent] = []
    url = "https://events.longisland.com/"

    markdown = await _crawl_single(url)
    if not markdown:
        logger.warning("[events:longisland] No content from Crawl4AI")
        return events

    # Parse event blocks from markdown — typically structured as:
    # ## Event Title
    # Date / Time / Venue info
    # Description
    today_str = datetime.now().strftime("%Y-%m-%d")

    # Look for date patterns near titles
    lines = markdown.split("\n")
    i = 0
    while i < len(lines) and len(events) < limit:
        line = lines[i].strip()
        i += 1

        # Skip empty/short lines
        if len(line) < 5:
            continue

        # Check if this line looks like a title (heading or bold or linked text)
        title = ""
        link = ""
        title_match = re.match(r"#{1,4}\s+(.+)", line)
        if title_match:
            title = title_match.group(1).strip()
        link_match = re.match(r"\[([^\]]+)\]\(([^)]+)\)", line)
        if link_match:
            title = link_match.group(1).strip()
            link = link_match.group(2).strip()

        if not title or len(title) < 5:
            continue

        # Look ahead for date/time/venue
        event_date = ""
        event_time = ""
        venue = ""
        description = ""
        for j in range(i, min(i + 5, len(lines))):
            ahead = lines[j].strip()
            if not ahead:
                continue

            # Date patterns
            if not event_date:
                dm = re.search(
                    r"((?:January|February|March|April|May|June|July|August|"
                    r"September|October|November|December)\s+\d{1,2},?\s*\d{4})",
                    ahead, re.IGNORECASE,
                )
                if dm:
                    event_date = _parse_date_flexible(dm.group(1)) or ""
                # ISO date
                if not event_date:
                    dm = re.search(r"(\d{4}-\d{2}-\d{2})", ahead)
                    if dm:
                        event_date = dm.group(1)

            # Time
            if not event_time:
                tm = re.search(r"(\d{1,2}:\d{2}\s*[AaPp][Mm])", ahead)
                if tm:
                    event_time = tm.group(1)

            # Description (first substantial line that's not date/time)
            if not description and len(ahead) > 20 and not re.match(r"^[\d/\-]", ahead):
                description = ahead[:300]

        if not event_date or event_date < today_str:
            continue

        events.append(ScrapedEvent(
            title=title,
            description=description[:500],
            event_date=event_date,
            event_time=event_time,
            venue=venue,
            url=link if link.startswith("http") else url,
            category=_categorize(title, description),
            scope="longisland",
            source="longisland",
            source_id=_make_source_id("longisland", title + event_date),
        ))

    logger.info(f"[events:longisland] Found {len(events)} events")
    return events


# ---------------------------------------------------------------------------
# Source 3: Eventbrite API (Long Island) — httpx (JSON API, no browser needed)
# ---------------------------------------------------------------------------

async def scrape_eventbrite(limit: int = 20) -> list[ScrapedEvent]:
    """Fetch upcoming Long Island events from Eventbrite API.
    Degrades gracefully if EVENTBRITE_API_KEY not set.
    """
    from config import settings

    events: list[ScrapedEvent] = []

    if not settings.eventbrite_api_key:
        logger.info("[events:eventbrite] No EVENTBRITE_API_KEY set, skipping")
        return events

    api_url = "https://www.eventbriteapi.com/v3/events/search/"
    params = {
        "location.address": "Great Neck, NY",
        "location.within": "25mi",
        "start_date.keyword": "this_month",
        "sort_by": "date",
        "expand": "venue",
        "page_size": min(limit, 50),
    }
    headers = {
        "Authorization": f"Bearer {settings.eventbrite_api_key}",
    }

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            resp = await client.get(api_url, params=params, headers=headers)
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        logger.warning(f"[events:eventbrite] API request failed: {e}")
        return events

    for ev in data.get("events", [])[:limit]:
        try:
            title = ev.get("name", {}).get("text", "")
            if not title:
                continue

            description = ev.get("description", {}).get("text", "")[:500] or ""
            start = ev.get("start", {})
            event_date = start.get("local", "")[:10] if start.get("local") else ""

            event_time = ""
            if start.get("local") and len(start["local"]) > 10:
                try:
                    dt = datetime.fromisoformat(start["local"])
                    event_time = dt.strftime("%-I:%M %p")
                except Exception:
                    pass

            end = ev.get("end", {})
            end_date = end.get("local", "")[:10] if end.get("local") else None

            venue_data = ev.get("venue", {})
            venue = venue_data.get("name", "") if venue_data else ""
            location = ""
            if venue_data and venue_data.get("address"):
                addr = venue_data["address"]
                location = addr.get("localized_address_display", "")

            url = ev.get("url", "")
            image_url = ""
            if ev.get("logo") and ev["logo"].get("url"):
                image_url = ev["logo"]["url"]

            if not event_date:
                continue

            events.append(ScrapedEvent(
                title=title,
                description=description,
                event_date=event_date,
                event_time=event_time,
                end_date=end_date,
                location=location,
                venue=venue,
                url=url,
                image_url=image_url,
                category=_categorize(title, description),
                scope="longisland",
                source="eventbrite",
                source_id=_make_source_id("eventbrite", str(ev.get("id", title))),
            ))
        except Exception as e:
            logger.debug(f"[events:eventbrite] Failed to parse event: {e}")
            continue

    logger.info(f"[events:eventbrite] Found {len(events)} events")
    return events


# ---------------------------------------------------------------------------
# Source 4: The Island Now (Crawl4AI)
# ---------------------------------------------------------------------------

async def scrape_island_now(limit: int = 20) -> list[ScrapedEvent]:
    """Scrape upcoming events from The Island Now via Crawl4AI."""
    events: list[ScrapedEvent] = []
    url = "https://theislandnow.com/events/"

    markdown = await _crawl_single(url)
    if not markdown:
        logger.warning("[events:islandnow] No content from Crawl4AI")
        return events

    today_str = datetime.now().strftime("%Y-%m-%d")

    # Parse event-like blocks from rendered markdown
    lines = markdown.split("\n")
    i = 0
    while i < len(lines) and len(events) < limit:
        line = lines[i].strip()
        i += 1

        if len(line) < 5:
            continue

        # Skip nav/footer/junk
        if any(w in line.lower() for w in ("subscribe", "newsletter", "advertise", "cookie")):
            continue

        title = ""
        link = ""
        title_match = re.match(r"#{1,4}\s+(.+)", line)
        if title_match:
            title = title_match.group(1).strip()
        link_match = re.match(r"\[([^\]]+)\]\(([^)]+)\)", line)
        if link_match:
            title = link_match.group(1).strip()
            link = link_match.group(2).strip()

        if not title or len(title) < 5:
            continue

        event_date = ""
        event_time = ""
        venue = ""
        description = ""

        for j in range(i, min(i + 5, len(lines))):
            ahead = lines[j].strip()
            if not ahead:
                continue

            if not event_date:
                dm = re.search(
                    r"((?:January|February|March|April|May|June|July|August|"
                    r"September|October|November|December)\s+\d{1,2},?\s*\d{4})",
                    ahead, re.IGNORECASE,
                )
                if dm:
                    event_date = _parse_date_flexible(dm.group(1)) or ""

            if not event_time:
                tm = re.search(r"(\d{1,2}:\d{2}\s*[AaPp][Mm])", ahead)
                if tm:
                    event_time = tm.group(1)

            if not description and len(ahead) > 20:
                description = ahead[:300]

        if not event_date or event_date < today_str:
            continue

        events.append(ScrapedEvent(
            title=title,
            description=description[:500],
            event_date=event_date,
            event_time=event_time,
            venue=venue,
            url=link if link.startswith("http") else url,
            category=_categorize(title, description),
            scope="area",
            source="islandnow",
            source_id=_make_source_id("islandnow", title + event_date),
        ))

    logger.info(f"[events:islandnow] Found {len(events)} events")
    return events


# ---------------------------------------------------------------------------
# Source 5: Great Neck Library (LibCal) — httpx (JSON API, no browser needed)
# ---------------------------------------------------------------------------

LIBCAL_AJAX_URL = "https://greatnecklibrary.libcal.com/ajax/calendar/list"
LIBCAL_CAL_ID = "20029"


async def scrape_library(limit: int = 40) -> list[ScrapedEvent]:
    """Scrape upcoming events from Great Neck Library via LibCal AJAX API."""
    events: list[ScrapedEvent] = []

    try:
        async with httpx.AsyncClient(
            headers={**HEADERS, "X-Requested-With": "XMLHttpRequest"},
            timeout=TIMEOUT,
            follow_redirects=True,
        ) as client:
            # Fetch today through next Sunday to cover the week ahead
            today = datetime.now()
            days_until_sunday = (6 - today.weekday()) % 7 or 7
            end_date = today + timedelta(days=days_until_sunday)
            resp = await client.get(LIBCAL_AJAX_URL, params={
                "c": LIBCAL_CAL_ID,
                "date": today.strftime("%Y-%m-%d"),
                "end": end_date.strftime("%Y-%m-%d"),
            })
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        logger.warning(f"[events:library] Failed to fetch LibCal: {e}")
        return events

    for ev in data.get("results", [])[:limit]:
        try:
            title = ev.get("title", "").strip()
            if not title:
                continue

            startdt = ev.get("startdt", "")
            event_date = startdt[:10] if startdt else ""
            event_time = ev.get("start", "")  # "10:00 AM"
            enddt = ev.get("enddt", "")
            end_date = enddt[:10] if enddt and enddt[:10] != event_date else None

            raw_desc = ev.get("shortdesc", "") or ev.get("description", "")
            desc_soup = BeautifulSoup(raw_desc, "html.parser")
            description = desc_soup.get_text(strip=True)[:500]

            location = ev.get("location", "")
            campus = ev.get("campus", "")
            venue = f"{location}, {campus}" if location and campus else (location or campus)

            url = ev.get("url", "")
            image_url = ev.get("featured_image", "")

            categories = ev.get("categories", "")
            category = _categorize(title, f"{description} {categories}")

            if not event_date:
                continue

            # Skip all-day month-long events (exhibitions, trading cards, etc.)
            if ev.get("all_day") and end_date:
                start_d = datetime.strptime(event_date, "%Y-%m-%d")
                end_d = datetime.strptime(end_date, "%Y-%m-%d")
                if (end_d - start_d).days > 7:
                    continue

            events.append(ScrapedEvent(
                title=title,
                description=description,
                event_date=event_date,
                event_time=event_time,
                end_date=end_date,
                location=location,
                venue=venue,
                url=url,
                image_url=image_url,
                category=category,
                scope="area",
                source="library",
                source_id=_make_source_id("library", str(ev.get("id", title))),
            ))
        except Exception as e:
            logger.debug(f"[events:library] Failed to parse event: {e}")
            continue

    logger.info(f"[events:library] Found {len(events)} events")
    return events


# ---------------------------------------------------------------------------
# Source 6: Great Neck School District (Finalsite calendar grid) — httpx
# Finalsite is server-rendered HTML, httpx works fine here.
# ---------------------------------------------------------------------------

SCHOOL_CALENDAR_URL = "https://www.greatneck.k12.ny.us/calendars/calendar"

# School prefix → full name mapping
SCHOOL_PREFIXES: dict[str, str] = {
    "SH": "South High School",
    "NH": "North High School",
    "SM": "South Middle School",
    "NM": "North Middle School",
    "EMB": "E.M. Baker Elementary",
    "PARK": "Parkville Elementary",
    "LAK": "Lakeville Elementary",
    "JFK": "JFK Elementary",
    "SR": "Saddle Rock Elementary",
    "KEN": "Kensington Elementary",
    "AH": "Arrandale Elementary",
}


async def scrape_school(limit: int = 30) -> list[ScrapedEvent]:
    """Scrape upcoming events from GN school district Finalsite calendar."""
    events: list[ScrapedEvent] = []

    try:
        async with httpx.AsyncClient(headers=HEADERS, timeout=TIMEOUT, follow_redirects=True) as client:
            resp = await client.get(SCHOOL_CALENDAR_URL)
            resp.raise_for_status()
    except Exception as e:
        logger.warning(f"[events:school] Failed to fetch {SCHOOL_CALENDAR_URL}: {e}")
        return events

    soup = BeautifulSoup(resp.text, "html.parser")

    # Finalsite calendar: each day is a fsCalendarDaybox containing fsCalendarInfo items
    dayboxes = soup.select(".fsCalendarDaybox.fsStateHasEvents")

    for daybox in dayboxes:
        date_el = daybox.select_one(".fsCalendarDate")
        if not date_el:
            continue

        day_text = date_el.get_text(strip=True)  # "Thursday,March5"
        match = re.match(r"(\w+),(\w+)(\d+)", day_text.replace(" ", ""))
        if not match:
            continue

        month_name = match.group(2)
        day_num = match.group(3)
        year = datetime.now().year

        event_date = _parse_date_flexible(f"{month_name} {day_num}, {year}")
        if not event_date:
            continue

        info_items = daybox.select(".fsCalendarInfo")
        for info in info_items:
            if len(events) >= limit:
                break

            title_el = info.select_one(".fsCalendarEventTitle")
            title = title_el.get_text(strip=True) if title_el else ""
            if not title or len(title) < 3:
                continue

            full_text = info.get_text(strip=True)

            event_time = ""
            time_match = re.search(r"(\d{1,2}:\d{2}\s*[AP]M)", full_text)
            if time_match:
                event_time = time_match.group(1)

            venue = ""
            venue_match = re.search(r"\d{1,2}:\d{2}\s*[AP]M\s*-\s*\d{1,2}:\d{2}\s*[AP]M\s*(.*)", full_text)
            if venue_match:
                venue = venue_match.group(1).strip()

            school_name = ""
            for prefix, name in SCHOOL_PREFIXES.items():
                if title.startswith(f"{prefix} ") or title.startswith(f"{prefix}-"):
                    school_name = name
                    break

            events.append(ScrapedEvent(
                title=title,
                event_date=event_date,
                event_time=event_time,
                venue=school_name or venue,
                url=SCHOOL_CALENDAR_URL,
                category=_categorize(title, full_text),
                scope="area",
                source="school",
                source_id=_make_source_id("school", title + event_date),
            ))

    logger.info(f"[events:school] Found {len(events)} events")
    return events


# ---------------------------------------------------------------------------
# Source 7: Village websites — meetings, hearings, public notices (Crawl4AI)
# ---------------------------------------------------------------------------

# All Great Neck area village websites
VILLAGE_SITES: list[tuple[str, str, list[str]]] = [
    # (base_url, village_name, pages_to_crawl)
    ("https://www.greatneckvillage.org", "Great Neck", [
        "/government/legal_notices.php",
        "/calendar.php",
    ]),
    ("https://greatneckplaza.net", "Great Neck Plaza", [
        "/notices",
        "/agendas",
    ]),
    ("https://www.greatneckestates.org", "Great Neck Estates", ["", "/calendar"]),
    ("https://www.villageofkensington.org", "Kensington", [""]),
    ("https://www.thomastonvillage.org", "Thomaston", [""]),
    ("https://www.russellgardens.us", "Russell Gardens", [""]),
    ("https://www.villagesaddlerock.org", "Saddle Rock", [""]),
    ("https://www.kingspointny.gov", "Kings Point", [""]),
    ("https://www.lakesuccess.org", "Lake Success", [""]),
]


_VILLAGE_KEYWORDS = (
    "meeting", "hearing", "board", "trustee",
    "zoning", "planning", "session", "public notice",
    "legal notice", "agenda", "workshop", "notice:",
)

_DATE_RE = re.compile(
    r"((?:January|February|March|April|May|June|July|August|"
    r"September|October|November|December)\s+\d{1,2},?\s*\d{4})",
    re.IGNORECASE,
)
_TIME_RE = re.compile(r"(\d{1,2}:\d{2}\s*[AaPp]\.?[Mm]\.?)")
_MD_LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")


def _extract_village_events_from_markdown(
    markdown: str,
    village_name: str,
    page_url: str,
) -> list[ScrapedEvent]:
    """Parse meeting/hearing/notice events from rendered markdown of a village page.

    Handles two common patterns in Crawl4AI output:
      1. Title and date on the same line
      2. Title on one line (## heading or [link]), date on the next line
    """
    events: list[ScrapedEvent] = []
    today_str = datetime.now().strftime("%Y-%m-%d")
    lines = markdown.split("\n")

    i = 0
    while i < len(lines):
        line = lines[i].strip()
        i += 1

        if len(line) < 10:
            continue

        text_lower = line.lower()

        # Must mention meeting/hearing/notice keywords
        if not any(w in text_lower for w in _VILLAGE_KEYWORDS):
            continue

        # Combine this line + next few lines for date/time extraction
        context = line
        for j in range(i, min(i + 3, len(lines))):
            context += " " + lines[j].strip()

        # Must contain a parseable date
        date_match = _DATE_RE.search(context)
        if not date_match:
            # Try MM/DD/YYYY
            mm_match = re.search(r"(\d{1,2}/\d{1,2}/\d{4})", context)
            if mm_match:
                date_match = mm_match
        if not date_match:
            continue

        event_date = _parse_date_flexible(date_match.group(1))
        if not event_date or event_date < today_str:
            continue

        # Extract time
        event_time = ""
        time_match = _TIME_RE.search(context)
        if time_match:
            event_time = time_match.group(1).upper().replace(".", "")

        # Extract link if present
        link_match = _MD_LINK_RE.search(line)
        link = link_match.group(2) if link_match else page_url

        # Clean title: strip markdown formatting
        title = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", line)  # [text](url) → text
        title = re.sub(r"[#*_`]", "", title).strip()
        title = title[:150]

        if not title or len(title) < 5:
            continue

        events.append(ScrapedEvent(
            title=title,
            event_date=event_date,
            event_time=event_time,
            venue=f"{village_name} Village Hall",
            url=link,
            category="community",
            scope="village",
            village=village_name,
            source="village",
            source_id=_make_source_id(f"village-{village_name[:8]}", title[:80] + event_date),
        ))

    return events


async def scrape_village_meetings(limit: int = 30) -> list[ScrapedEvent]:
    """Scrape meeting notices and hearings from all village websites via Crawl4AI."""
    # Build list of all URLs to crawl
    url_to_village: dict[str, str] = {}
    urls: list[str] = []
    for base_url, village_name, paths in VILLAGE_SITES:
        for path in paths:
            full_url = f"{base_url}{path}"
            urls.append(full_url)
            url_to_village[full_url] = village_name

    logger.info(f"[events:village] Crawling {len(urls)} village pages...")

    # Crawl all village pages in parallel with Crawl4AI
    page_results = await _crawl_pages(urls)

    all_events: list[ScrapedEvent] = []
    for page_url, markdown in page_results.items():
        if not markdown:
            continue
        village_name = url_to_village.get(page_url, "")
        events = _extract_village_events_from_markdown(markdown, village_name, page_url)
        all_events.extend(events)
        if events:
            logger.info(f"[events:village] {village_name}: {len(events)} events from {page_url}")

    # Deduplicate by title prefix
    seen: set[str] = set()
    unique: list[ScrapedEvent] = []
    for ev in all_events:
        key = ev.title.lower().strip()[:60]
        if key not in seen:
            seen.add(key)
            unique.append(ev)

    logger.info(f"[events:village] Found {len(unique)} total village events")
    return unique[:limit]


# ---------------------------------------------------------------------------
# Source 8: Great Neck Park District (CivicPlus calendar) — httpx
# ---------------------------------------------------------------------------

GNPD_CALENDAR_URL = "https://www.gnparksny.gov/calendar.aspx"

# Recurring maintenance/internal/practice events to skip (noise for residents)
_GNPD_SKIP_EXACT = {"ice maintenance", "gnfsc"}
_GNPD_SKIP_PREFIXES = (
    "ice maintenance", "gnfsc",
    "bruins ", "freestyle ",
    "open play @ playscape",  # daily recurring
    "public session ",  # multiple daily ice sessions — RAG has the schedule
    "skate school ",  # multiple weekly sessions — RAG has the schedule
    "nyr ",  # NYR Rookie League / Learn-to-Play recurring weekly
)
# Substrings to skip anywhere in the title
_GNPD_SKIP_CONTAINS = (
    "spring hockey w/ besa",  # recurring weekly practice by age group
)
# Keep only first occurrence of recurring titled events per date
_GNPD_DEDUP_PREFIXES = (
    "ping pong",
)


async def scrape_park_district_events(limit: int = 40) -> list[ScrapedEvent]:
    """Scrape upcoming events from Great Neck Park District CivicPlus calendar."""
    events: list[ScrapedEvent] = []

    try:
        async with httpx.AsyncClient(
            headers=HEADERS, timeout=TIMEOUT, follow_redirects=True,
        ) as client:
            resp = await client.get(GNPD_CALENDAR_URL)
            resp.raise_for_status()
    except Exception as e:
        logger.warning(f"[events:parkdistrict] Failed to fetch calendar: {e}")
        return events

    soup = BeautifulSoup(resp.text, "html.parser")
    today_str = datetime.now().strftime("%Y-%m-%d")

    calendars_div = soup.find("div", class_="calendars")
    if not calendars_div:
        logger.warning("[events:parkdistrict] No calendars div found")
        return events

    seen_recurring: set[str] = set()  # track "prefix:date" for dedup

    for cal_div in calendars_div.find_all("div", class_="calendar", recursive=False):
        # Category from the <h2> title
        h2 = cal_div.find("h2")
        cal_category = h2.get_text(strip=True) if h2 else ""

        for li in cal_div.find_all("li"):
            if len(events) >= limit:
                break

            # Title from <h3>
            h3 = li.find("h3")
            title = h3.get_text(strip=True) if h3 else ""
            if not title or len(title) < 3:
                continue

            # Skip recurring maintenance/practice/internal events
            title_lower = title.lower().strip()
            if title_lower in _GNPD_SKIP_EXACT or any(
                title_lower.startswith(s) for s in _GNPD_SKIP_PREFIXES
            ) or any(s in title_lower for s in _GNPD_SKIP_CONTAINS):
                continue

            # ISO datetime from hidden span
            hidden_div = li.find("div", class_="hidden")
            event_date = ""
            event_time = ""
            if hidden_div:
                iso_span = hidden_div.find("span", class_="hidden")
                if iso_span:
                    iso_text = iso_span.get_text(strip=True)  # 2026-03-09T10:00:00
                    if len(iso_text) >= 10:
                        event_date = iso_text[:10]
                    if "T" in iso_text:
                        try:
                            dt = datetime.fromisoformat(iso_text)
                            event_time = dt.strftime("%-I:%M %p")
                        except Exception:
                            pass

            if not event_date or event_date < today_str:
                continue

            # Dedup recurring sessions — keep only one per date
            for prefix in _GNPD_DEDUP_PREFIXES:
                if title_lower.startswith(prefix):
                    key = f"{prefix}:{event_date}"
                    if key in seen_recurring:
                        title = ""  # mark for skip
                        break
                    seen_recurring.add(key)
            if not title:
                continue

            # Venue from eventLocation div
            venue = ""
            loc_div = li.find("div", class_="eventLocation")
            if loc_div:
                venue = loc_div.get_text(strip=True).lstrip("@").strip()

            # Description from <p> inside hidden div
            description = ""
            if hidden_div:
                p = hidden_div.find("p")
                if p:
                    description = p.get_text(strip=True)[:500]

            # Detail link
            detail_link = li.find("a", href=True, string=re.compile(r"More Details", re.I))
            url = f"https://www.gnparksny.gov{detail_link['href']}" if detail_link else GNPD_CALENDAR_URL

            # Build a richer title if the calendar category adds context
            full_title = title
            if cal_category and cal_category.lower() not in title.lower():
                full_title = f"{title} ({cal_category})"

            events.append(ScrapedEvent(
                title=full_title,
                description=description,
                event_date=event_date,
                event_time=event_time,
                venue=venue or "Great Neck Park District",
                url=url,
                category=_categorize(full_title, f"{description} {cal_category}"),
                scope="area",
                source="parkdistrict",
                source_id=_make_source_id("parkdistrict", title + event_date),
            ))

    logger.info(f"[events:parkdistrict] Found {len(events)} events")
    return events


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

async def scrape_all_events() -> list[ScrapedEvent]:
    """Run all event scrapers and deduplicate by lowercase title."""
    all_events: list[ScrapedEvent] = []
    seen_titles: set[str] = set()

    for scraper_fn in (
        scrape_patch, scrape_library, scrape_school,
        scrape_village_meetings, scrape_longisland_events,
        scrape_eventbrite, scrape_island_now,
        scrape_park_district_events,
    ):
        try:
            results = await scraper_fn()
            for event in results:
                # Sanitize text fields
                event.title = _sanitize(event.title)
                event.description = _sanitize(event.description)
                event.venue = _sanitize(event.venue)

                if not event.title or len(event.title) < 3:
                    continue

                key = event.title.lower().strip()
                if key not in seen_titles:
                    seen_titles.add(key)
                    all_events.append(event)
        except Exception as e:
            logger.error(f"[events] Scraper {scraper_fn.__name__} failed: {e}")
            continue

    logger.info(f"[events] Total unique events scraped: {len(all_events)}")
    return all_events
