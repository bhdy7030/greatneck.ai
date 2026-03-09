"""Scraper for Great Neck Park District website (gnparksny.gov)."""

import logging
from dataclasses import dataclass

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

BASE_URL = "https://www.gnparksny.gov"

# Key pages to scrape — covers facilities, programs, fees, rules
PAGES = [
    # Main landing pages
    ("/101/Parks-Facilities", "Parks & Facilities"),
    ("/31/Programs-Events", "Programs & Events"),
    ("/35/Things-To-Do", "Things To Do"),
    ("/156/Park-Card-Information", "Park Card Information"),
    ("/148/How-Do-I", "How Do I..."),

    # Major facilities
    ("/166/Great-Neck-House", "Great Neck House"),
    ("/747/Steppingstone-Park", "Steppingstone Park"),
    ("/753/Memorial-Field", "Memorial Field"),
    ("/751/Allenwood-Park", "Allenwood Park"),
    ("/749/Kings-Point-Park", "Kings Point Park"),
    ("/752/Village-Green-Rose-Garden", "Village Green & Rose Garden"),

    # Parkwood Sports Complex
    ("/317/Aquatics", "Aquatic Center & Pool"),
    ("/711/Youth-Programs", "Aquatics Youth Programs"),
    ("/710/Adult-Programs", "Aquatics Adult Programs"),
    ("/320/Winter-Swim", "Winter Swim"),
    ("/190/Ice-Rink", "Andrew Stergiopoulos Ice Rink"),
    ("/720/Public-Sessions", "Ice Rink Public Sessions"),
    ("/192/Skate-School", "Skate School"),
    ("/428/Hockey", "Hockey Programs"),
    ("/229/Tennis", "Tennis Center"),
    ("/729/Youth-Classes", "Tennis Youth Classes"),
    ("/730/Adult-Programs", "Tennis Adult Programs"),
    ("/485/Tennis-Camps", "Tennis Camps"),
    ("/616/Recreation-Center", "Recreation Center"),

    # Programs
    ("/160/Camps", "Summer Camps"),
    ("/204/Camp-Parkwood", "Camp Parkwood"),
    ("/812/Soccer-Camp", "Soccer Camp"),
    ("/835/Musical-Theater-Camp", "Musical Theater Camp"),
    ("/350/Youth-Classes", "Great Neck House Youth Classes"),
    ("/351/Adult-Classes", "Great Neck House Adult Classes"),
    ("/332/Live-Performances", "Live Performances"),
    ("/207/Movies", "Movies"),
    ("/421/Summer-Concert-Series", "Summer Concert Series"),
    ("/819/Youth-Soccer", "Youth Soccer"),
    ("/364/Playscape", "Playscape"),
    ("/253/Birthday-Party", "Birthday Parties"),

    # Other facilities
    ("/179/Marina", "Marina"),
    ("/183/Sailing", "Sailing School"),
    ("/475/Kayak-Sailboat-Rentals", "Kayak & Sailboat Rentals"),
    ("/374/Dog-Park", "Dog Park"),
    ("/159/Parking", "Parking Information"),
    ("/231/Athletic-Field-Reservations", "Athletic Field Reservations"),
]


@dataclass
class ParkDistrictPage:
    url: str
    title: str
    text: str


async def scrape_park_district() -> list[ParkDistrictPage]:
    """Scrape all key pages from the Great Neck Park District website."""
    results: list[ParkDistrictPage] = []

    async with httpx.AsyncClient(
        timeout=30.0,
        follow_redirects=True,
        headers={"User-Agent": "GreatNeck.ai/0.1 (community research)"},
    ) as client:
        for path, label in PAGES:
            url = f"{BASE_URL}{path}"
            try:
                resp = await client.get(url)
                resp.raise_for_status()
            except (httpx.HTTPStatusError, httpx.RequestError) as e:
                logger.warning(f"[parkdistrict] Failed to fetch {url}: {e}")
                continue

            soup = BeautifulSoup(resp.text, "html.parser")

            # Remove non-content elements
            for tag in soup(["script", "style", "nav", "footer", "header", "aside", "iframe"]):
                tag.decompose()

            # Get main content area
            main = (
                soup.find("div", {"id": "divContentArea"})
                or soup.find("main")
                or soup.find("article")
                or soup.find("body")
                or soup
            )
            text = main.get_text(separator="\n", strip=True)

            if len(text) < 30:
                logger.warning(f"[parkdistrict] Too little content from {url}, skipping")
                continue

            # Prefix with label for context
            content = f"Great Neck Park District — {label}\nSource: {url}\n\n{text[:15000]}"
            results.append(ParkDistrictPage(url=url, title=label, text=content))
            logger.info(f"[parkdistrict] Scraped {label} ({len(text)} chars)")

    logger.info(f"[parkdistrict] Total pages scraped: {len(results)}")
    return results
