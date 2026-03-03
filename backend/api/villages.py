"""Villages endpoint: returns supported villages and metadata."""

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class VillageInfo(BaseModel):
    id: str
    name: str
    full_name: str
    ecode360_code: str
    website: str
    building_dept_phone: str


# Great Neck area villages and their metadata
VILLAGES: list[VillageInfo] = [
    VillageInfo(
        id="great_neck",
        name="Great Neck",
        full_name="Village of Great Neck",
        ecode360_code="GR0590",
        website="https://www.greatneckvillage.org",
        building_dept_phone="(516) 482-4500",
    ),
    VillageInfo(
        id="great_neck_estates",
        name="Great Neck Estates",
        full_name="Village of Great Neck Estates",
        ecode360_code="GR0594",
        website="https://www.greatneckestates.org",
        building_dept_phone="(516) 482-9441",
    ),
    VillageInfo(
        id="great_neck_plaza",
        name="Great Neck Plaza",
        full_name="Village of Great Neck Plaza",
        ecode360_code="GR0598",
        website="https://www.greatneckplaza.net",
        building_dept_phone="(516) 482-4500",
    ),
    VillageInfo(
        id="kensington",
        name="Kensington",
        full_name="Village of Kensington",
        ecode360_code="KE0352",
        website="https://www.villageofkensington.org",
        building_dept_phone="(516) 482-3890",
    ),
    VillageInfo(
        id="thomaston",
        name="Thomaston",
        full_name="Village of Thomaston",
        ecode360_code="TH0370",
        website="https://www.thomastonvillage.org",
        building_dept_phone="(516) 482-4346",
    ),
    VillageInfo(
        id="russell_gardens",
        name="Russell Gardens",
        full_name="Village of Russell Gardens",
        ecode360_code="RU0330",
        website="https://www.russellgardens.us",
        building_dept_phone="(516) 482-4706",
    ),
    VillageInfo(
        id="saddle_rock",
        name="Saddle Rock",
        full_name="Village of Saddle Rock",
        ecode360_code="SA0090",
        website="https://www.villagesaddlerock.org",
        building_dept_phone="(516) 482-6266",
    ),
    VillageInfo(
        id="kings_point",
        name="Kings Point",
        full_name="Village of Kings Point",
        ecode360_code="KI0424",
        website="https://www.kingspointny.gov",
        building_dept_phone="(516) 482-5762",
    ),
    VillageInfo(
        id="lake_success",
        name="Lake Success",
        full_name="Village of Lake Success",
        ecode360_code="LA0120",
        website="https://www.lakesuccess.org",
        building_dept_phone="(516) 482-4411",
    ),
]


@router.get("/villages", response_model=list[VillageInfo])
async def list_villages() -> list[VillageInfo]:
    """Return the list of supported Great Neck area villages with metadata."""
    return VILLAGES


@router.get("/villages/{village_id}", response_model=VillageInfo)
async def get_village(village_id: str) -> VillageInfo:
    """Return metadata for a specific village."""
    for v in VILLAGES:
        if v.id == village_id:
            return v
    from fastapi import HTTPException
    raise HTTPException(status_code=404, detail=f"Village '{village_id}' not found.")
