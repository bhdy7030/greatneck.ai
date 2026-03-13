"""Village department contacts and issue-to-department routing."""
from __future__ import annotations

# Department contacts per village.
# email=None means no publicly listed email — agent should fall back to phone.
CONTACTS: dict[str, dict[str, dict]] = {
    "great_neck": {
        "building": {"name": "Building Department", "email": "building@greatneckvillage.org", "phone": "(516) 482-4500"},
        "clerk": {"name": "Village Clerk", "email": "clerk@greatneckvillage.org", "phone": "(516) 482-4500"},
        "dpw": {"name": "Dept of Public Works", "email": "dpw@greatneckvillage.org", "phone": "(516) 482-4500"},
        "police": {"name": "Police Department", "email": None, "phone": "(516) 482-4500"},
    },
    "great_neck_estates": {
        "building": {"name": "Building Department", "email": None, "phone": "(516) 482-9441"},
        "clerk": {"name": "Village Clerk", "email": None, "phone": "(516) 482-9441"},
        "dpw": {"name": "Dept of Public Works", "email": None, "phone": "(516) 482-9441"},
        "police": {"name": "Police Department", "email": None, "phone": "(516) 482-9441"},
    },
    "great_neck_plaza": {
        "building": {"name": "Building Department", "email": None, "phone": "(516) 482-4500"},
        "clerk": {"name": "Village Clerk", "email": "clerk@greatneckplaza.net", "phone": "(516) 482-4500"},
        "dpw": {"name": "Dept of Public Works", "email": None, "phone": "(516) 482-4500"},
        "police": {"name": "Police Department", "email": None, "phone": "(516) 482-4500"},
    },
    "kensington": {
        "building": {"name": "Building Department", "email": None, "phone": "(516) 482-3890"},
        "clerk": {"name": "Village Clerk", "email": None, "phone": "(516) 482-3890"},
        "dpw": {"name": "Dept of Public Works", "email": None, "phone": "(516) 482-3890"},
        "police": {"name": "Police Department", "email": None, "phone": "(516) 482-3890"},
    },
    "thomaston": {
        "building": {"name": "Building Department", "email": None, "phone": "(516) 482-4346"},
        "clerk": {"name": "Village Clerk", "email": None, "phone": "(516) 482-4346"},
        "dpw": {"name": "Dept of Public Works", "email": None, "phone": "(516) 482-4346"},
        "police": {"name": "Police Department", "email": None, "phone": "(516) 482-4346"},
    },
    "russell_gardens": {
        "building": {"name": "Building Department", "email": None, "phone": "(516) 482-4706"},
        "clerk": {"name": "Village Clerk", "email": None, "phone": "(516) 482-4706"},
        "dpw": {"name": "Dept of Public Works", "email": None, "phone": "(516) 482-4706"},
        "police": {"name": "Police Department", "email": None, "phone": "(516) 482-4706"},
    },
    "saddle_rock": {
        "building": {"name": "Building Department", "email": None, "phone": "(516) 482-6266"},
        "clerk": {"name": "Village Clerk", "email": None, "phone": "(516) 482-6266"},
        "dpw": {"name": "Dept of Public Works", "email": None, "phone": "(516) 482-6266"},
        "police": {"name": "Police Department", "email": None, "phone": "(516) 482-6266"},
    },
    "kings_point": {
        "building": {"name": "Building Department", "email": None, "phone": "(516) 482-5762"},
        "clerk": {"name": "Village Clerk", "email": None, "phone": "(516) 482-5762"},
        "dpw": {"name": "Dept of Public Works", "email": None, "phone": "(516) 482-5762"},
        "police": {"name": "Police Department", "email": None, "phone": "(516) 482-5762"},
    },
    "lake_success": {
        "building": {"name": "Building Department", "email": None, "phone": "(516) 482-4411"},
        "clerk": {"name": "Village Clerk", "email": None, "phone": "(516) 482-4411"},
        "dpw": {"name": "Dept of Public Works", "email": None, "phone": "(516) 482-4411"},
        "police": {"name": "Police Department", "email": None, "phone": "(516) 482-4411"},
    },
}

# Map issue types to the responsible department key.
ISSUE_ROUTING: dict[str, str] = {
    "pothole": "dpw",
    "fallen_tree": "dpw",
    "streetlight": "dpw",
    "road": "dpw",
    "sidewalk": "dpw",
    "water": "dpw",
    "sewer": "dpw",
    "trash": "dpw",
    "snow": "dpw",
    "noise": "police",
    "parking": "police",
    "safety": "police",
    "building": "building",
    "permit": "building",
    "construction": "building",
    "zoning": "building",
    "general": "clerk",
}
