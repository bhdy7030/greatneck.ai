"""Seed knowledge base with manual data (permit info, garbage rules, etc.)."""

import asyncio
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from rag.ingest import ingest_document

# ─── Seed Documents ──────────────────────────────────────────────────────────

SEED_DOCS = [
    # ── Garbage Collection ──
    {
        "village": "Great Neck",
        "category": "garbage",
        "source": "Garbage Collection Schedule & Rules",
        "content": """
VILLAGE OF GREAT NECK - GARBAGE AND RECYCLING COLLECTION

Garbage Collection:
- Residential garbage is collected twice weekly (Monday and Thursday).
- Place garbage at the curb by 7:00 AM on collection days.
- Use official 30-gallon or 60-gallon cans with tight-fitting lids, or use clear/transparent bags.
- Maximum weight per container: 50 lbs.
- No loose garbage or construction debris.

Recycling Collection:
- Recycling is collected once weekly on Wednesdays.
- Accepted recyclables: paper, cardboard, glass bottles/jars, metal cans, plastic containers (#1-#7).
- Place recyclables in designated blue bins or clear bags.
- Flatten all cardboard boxes.

Bulk Pickup:
- Scheduled monthly or by appointment. Call Village Hall.
- Large items (furniture, appliances) require advance scheduling.
- No hazardous waste, tires, or electronics in bulk pickup.

Leaf/Yard Waste:
- Collected seasonally (April-November).
- Place in biodegradable paper bags or open containers, separate from regular garbage.
- No plastic bags for yard waste.

Village Hall Contact: (516) 482-0019
""",
    },
    {
        "village": "Great Neck Estates",
        "category": "garbage",
        "source": "Garbage Collection Schedule & Rules",
        "content": """
VILLAGE OF GREAT NECK ESTATES - SANITATION SERVICES

Garbage Collection:
- Collected twice per week: Tuesday and Friday.
- Containers must be placed at curb no earlier than 6:00 PM the night before.
- Containers must be removed from curb by end of collection day.
- Use sturdy containers with lids. Maximum 32-gallon size recommended.

Recycling:
- Single-stream recycling collected every Wednesday.
- All recyclables go in one bin: paper, plastic, glass, metal.
- No plastic bags in recycling.

Yard Waste:
- Collected weekly during growing season.
- Must be in paper bags or open containers.

Contact: (516) 482-6411
""",
    },
    # ── Snow Removal ──
    {
        "village": "Great Neck",
        "category": "codes",
        "source": "Snow Removal Ordinance Summary",
        "content": """
VILLAGE OF GREAT NECK - SNOW AND ICE REMOVAL (Chapter 113)

Property Owner Responsibilities:
- Sidewalks must be cleared of snow and ice within 24 hours after snowfall ends.
- The full width of the sidewalk must be cleared.
- If ice cannot be removed, sand or salt must be applied.
- Corner properties must clear sidewalks on all adjacent street sides.

Prohibited Actions:
- Do NOT push or blow snow into the street or onto neighboring properties.
- Do NOT block fire hydrants with snow.
- Do NOT obstruct crosswalks with snow piles.

Violations:
- First offense: warning.
- Subsequent offenses: fines up to $250 per violation per day.

The Village will clear public roads. Residents are responsible for their own driveways and sidewalks.
""",
    },
    # ── Permits ──
    {
        "village": "Great Neck",
        "category": "permits",
        "source": "Common Permit Types and Requirements",
        "content": """
VILLAGE OF GREAT NECK - BUILDING PERMITS AND REQUIREMENTS

When You Need a Permit:
- Any new construction or structural modification
- Additions or extensions to existing structures
- Fences (any height)
- Decks, patios, and porches
- Swimming pools (in-ground and above-ground)
- HVAC system installation or replacement
- Electrical work (beyond minor repairs)
- Plumbing work (beyond minor repairs)
- Roofing replacement
- Window/door replacements (structural changes)
- Demolition
- Driveway installation or modification
- Retaining walls over 4 feet
- Sheds over 120 sq ft

When You May NOT Need a Permit:
- Interior painting and decorating
- Installing flooring (non-structural)
- Minor plumbing repairs (faucet replacement, etc.)
- Replacing existing fixtures with same type
- Landscaping (non-structural)

How to Apply:
1. Visit Village Hall Building Department
2. Submit application with architectural plans/drawings
3. Pay applicable fees
4. Wait for plan review (typically 2-4 weeks)
5. Schedule inspections at each construction phase

Building Department: (516) 482-0019
Hours: Monday-Friday, 9:00 AM - 4:00 PM
""",
    },
    {
        "village": "Kings Point",
        "category": "permits",
        "source": "Building Permit Information",
        "content": """
VILLAGE OF KINGS POINT - BUILDING DEPARTMENT

The Village of Kings Point requires permits for most construction and renovation projects.

Key Requirements:
- All exterior work requires a building permit.
- Plans must be prepared by a licensed architect or engineer for major projects.
- A survey may be required for additions, pools, and fences.
- Zoning compliance is verified before permit issuance.

Common Permit Types:
- Building Permit: new construction, additions, structural alterations
- Electrical Permit: new circuits, panel upgrades, major electrical work
- Plumbing Permit: new plumbing lines, water heater installation
- Pool Permit: in-ground and above-ground pools, hot tubs
- Fence Permit: all fences regardless of height
- Demolition Permit: full or partial demolition

Zoning Notes:
- Minimum lot sizes and setback requirements vary by zone.
- Floor Area Ratio (FAR) restrictions apply.
- Maximum building height: 35 feet in most residential zones.

Building Department Contact: (516) 482-6044
""",
    },
    # ── Village Contacts ──
    {
        "village": None,  # Shared across all
        "category": "general",
        "source": "Village Contact Information",
        "content": """
GREAT NECK AREA VILLAGE CONTACT DIRECTORY

Village of Great Neck
Address: 61 Baker Hill Road, Great Neck, NY 11023
Phone: (516) 482-0019
Website: www.greatneckvillage.org
Village Hall Hours: Monday-Friday, 9 AM - 4 PM

Village of Great Neck Estates
Address: 176 Cutter Mill Road, Great Neck, NY 11021
Phone: (516) 482-6411
Website: www.greatneckestates.org

Village of Great Neck Plaza
Address: 2 Gussack Plaza, Great Neck, NY 11021
Phone: (516) 482-4500
Website: www.greatneckplaza.net

Village of Kensington
Address: 2 Beverly Road, Great Neck, NY 11021
Phone: (516) 482-3890
Website: www.villagekensington.com

Village of Kings Point
Address: 32 Redbrook Road, Kings Point, NY 11024
Phone: (516) 482-6044
Website: www.kingspointvillage.org

Village of Thomaston
Address: 100 East Shore Road, Great Neck, NY 11023
Phone: (516) 482-4326
Website: www.villagethomastony.com

Emergency Services (all villages): 911
Nassau County Police (non-emergency): (516) 573-8800
""",
    },
    # ── Parking ──
    {
        "village": "Great Neck Plaza",
        "category": "parking",
        "source": "Parking Regulations",
        "content": """
VILLAGE OF GREAT NECK PLAZA - PARKING INFORMATION

Public Parking:
- Multiple municipal parking lots available in the business district.
- Metered street parking on Middle Neck Road and surrounding streets.
- Meter hours: Monday-Saturday, 8 AM - 6 PM. Free on Sundays and holidays.

Resident Parking Permits:
- Annual resident parking permits available at Village Hall.
- Required for overnight street parking.
- Cost: $25/year per vehicle.

Parking Restrictions:
- No parking on any village street between 2 AM - 6 AM without resident permit.
- Alternate side parking rules in effect for street cleaning.
- Snow emergency parking bans: when declared, vehicles must be removed from streets.

Violations:
- Expired meter: $30
- No permit overnight: $50
- Fire hydrant: $100
- Handicap space violation: $250

Contact: (516) 482-4500
""",
    },
]


async def main():
    """Seed the knowledge base with manually curated documents."""
    print("GreatNeck.ai Knowledge Base Seeder")
    print("=" * 60)

    total_chunks = 0

    for doc in SEED_DOCS:
        village = doc["village"]
        source = doc["source"]
        label = f"{village or 'Shared'} / {source}"

        print(f"\nIngesting: {label}")

        result = await ingest_document(
            content=doc["content"],
            source=source,
            village=village,
            category=doc["category"],
        )

        chunks = result.get("chunks", 0)
        total_chunks += chunks
        print(f"  Status: {result['status']}, Chunks: {chunks}")

    print(f"\n{'='*60}")
    print(f"Seeding complete. Total chunks: {total_chunks}")
    print(f"Documents processed: {len(SEED_DOCS)}")


if __name__ == "__main__":
    asyncio.run(main())
