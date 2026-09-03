"""Service catalogue: service types, vehicle categories, hourly rates and fixed-price routes."""
from typing import Optional

from core import db, haversine_km, new_id, now_utc

# ---- Vehicle categories (extends VEHICLE_PRICING in core.py) ----
VEHICLES = {
    "standard": {
        "label": "Berline", "category": "Confort", "passengers": 3, "luggage": 3, "eta": 3, "hourly": 55.0,
        "description": "Berline confortable (Peugeot 508, Skoda Superb…)",
        "image_url": "https://images.unsplash.com/photo-1601362840469-51e4d8d58785?w=640&q=70",
    },
    "premium": {
        "label": "Business Class", "category": "Premium", "passengers": 3, "luggage": 3, "eta": 5, "hourly": 85.0,
        "description": "Mercedes Classe E / BMW Série 5, eau et Wi-Fi à bord",
        "image_url": "https://images.unsplash.com/photo-1617814076367-b759c7d7e738?w=640&q=70",
    },
    "van": {
        "label": "Van", "category": "Groupe", "passengers": 7, "luggage": 7, "eta": 7, "hourly": 75.0,
        "description": "Mercedes Vito / Classe V, idéal familles et bagages",
        "image_url": "",
    },
    "van_premium": {
        "label": "Van Premium", "category": "Premium", "passengers": 6, "luggage": 6, "eta": 10, "hourly": 110.0,
        "description": "Mercedes Classe V VIP, sièges cuir face-à-face",
        "image_url": "",
    },
    "group": {
        "label": "Minibus Groupe", "category": "Groupe", "passengers": 16, "luggage": 16, "eta": 20, "hourly": 130.0,
        "description": "Minibus 16 places pour groupes, séminaires et événements",
        "image_url": "https://images.unsplash.com/photo-1570125909232-eb263c188f7e?w=640&q=70",
    },
}

# ---- Service types ----
SERVICES = {
    "private": {"label": "Chauffeur privé", "label_en": "Private Driver", "icon": "car", "pricing": "distance", "min_hours": 0,
                "description": "Trajet privé de porte à porte"},
    "airport": {"label": "Transfert aéroport", "label_en": "Airport Transfer", "icon": "airplane", "pricing": "distance", "min_hours": 0,
                "description": "Depuis ou vers CDG, Orly, Beauvais – suivi de vol inclus"},
    "hourly": {"label": "Mise à disposition", "label_en": "Hourly Chauffeur", "icon": "clock-outline", "pricing": "hourly", "min_hours": 2,
               "description": "Chauffeur à disposition à l'heure (2 h minimum)"},
    "business": {"label": "Déplacement pro", "label_en": "Business Travel", "icon": "briefcase-outline", "pricing": "distance", "min_hours": 0,
                 "description": "Rendez-vous, sièges sociaux, gares – facture automatique"},
    "city_tour": {"label": "Visite de Paris", "label_en": "City Tour", "icon": "camera-outline", "pricing": "hourly", "min_hours": 3,
                  "description": "Tour de Paris avec chauffeur (3 h minimum)"},
    "events": {"label": "Événements & salons", "label_en": "Events", "icon": "ticket-confirmation-outline", "pricing": "distance", "min_hours": 0,
               "description": "Salons, congrès, soirées, Roland-Garros…"},
    "long_distance": {"label": "Longue distance", "label_en": "Long Distance", "icon": "map-marker-distance", "pricing": "distance", "min_hours": 0,
                      "description": "Paris → autre ville ou région, prix connu à l'avance"},
    "special": {"label": "Occasions spéciales", "label_en": "Special Occasions", "icon": "ring", "pricing": "distance", "min_hours": 0,
                "description": "Mariages, cérémonies, anniversaires – véhicule décoré sur demande"},
}

CANCELLATION_POLICY = {
    "free_until_accept": True,
    "fee_after_accept": 3.0,
    "text": "Annulation gratuite tant qu'aucun chauffeur n'a accepté. Après acceptation : 3 € de frais. Impossible d'annuler une course en cours.",
}

# ---- Fixed-price routes (seeded, editable by moderators) ----
ZONES = {
    "cdg": {"name": "Aéroport Charles-de-Gaulle", "lat": 49.0097, "lng": 2.5479, "radius_km": 4.0},
    "orly": {"name": "Aéroport d'Orly", "lat": 48.7262, "lng": 2.3652, "radius_km": 3.0},
    "beauvais": {"name": "Aéroport de Beauvais", "lat": 49.4544, "lng": 2.1128, "radius_km": 3.0},
    "paris": {"name": "Paris Centre", "lat": 48.8566, "lng": 2.3522, "radius_km": 6.0},
    "disney": {"name": "Disneyland Paris", "lat": 48.8722, "lng": 2.7758, "radius_km": 3.0},
    "versailles": {"name": "Versailles", "lat": 48.8049, "lng": 2.1204, "radius_km": 3.0},
}

DEFAULT_FIXED_ROUTES = [
    ("cdg", "paris", {"standard": 75, "premium": 95, "van": 110, "van_premium": 140, "group": 190}),
    ("paris", "cdg", {"standard": 75, "premium": 95, "van": 110, "van_premium": 140, "group": 190}),
    ("orly", "paris", {"standard": 60, "premium": 80, "van": 90, "van_premium": 120, "group": 170}),
    ("paris", "orly", {"standard": 60, "premium": 80, "van": 90, "van_premium": 120, "group": 170}),
    ("beauvais", "paris", {"standard": 130, "premium": 160, "van": 170, "van_premium": 210, "group": 280}),
    ("paris", "beauvais", {"standard": 130, "premium": 160, "van": 170, "van_premium": 210, "group": 280}),
    ("cdg", "disney", {"standard": 95, "premium": 120, "van": 130, "van_premium": 165, "group": 220}),
    ("disney", "cdg", {"standard": 95, "premium": 120, "van": 130, "van_premium": 165, "group": 220}),
    ("paris", "disney", {"standard": 85, "premium": 110, "van": 120, "van_premium": 150, "group": 210}),
    ("disney", "paris", {"standard": 85, "premium": 110, "van": 120, "van_premium": 150, "group": 210}),
    ("orly", "disney", {"standard": 90, "premium": 115, "van": 125, "van_premium": 160, "group": 215}),
    ("paris", "versailles", {"standard": 65, "premium": 85, "van": 95, "van_premium": 125, "group": 175}),
]


async def seed_fixed_routes():
    if await db.fixed_routes.count_documents({}) > 0:
        return
    docs = []
    for a, b, prices in DEFAULT_FIXED_ROUTES:
        docs.append({
            "id": new_id(), "name": f"{ZONES[a]['name']} → {ZONES[b]['name']}",
            "from_zone": ZONES[a], "to_zone": ZONES[b], "prices": {k: float(v) for k, v in prices.items()},
            "active": True, "created_at": now_utc(),
        })
    await db.fixed_routes.insert_many(docs)


def _in_zone(pt: dict, zone: dict) -> bool:
    return haversine_km(pt["lat"], pt["lng"], zone["lat"], zone["lng"]) <= zone["radius_km"]


async def match_fixed_route(pickup: dict, dropoff: dict) -> Optional[dict]:
    """Return the active fixed route whose zones contain pickup and dropoff (smallest zones first)."""
    routes = [r async for r in db.fixed_routes.find({"active": True}, {"_id": 0})]
    hits = [r for r in routes if _in_zone(pickup, r["from_zone"]) and _in_zone(dropoff, r["to_zone"])]
    if not hits:
        return None
    hits.sort(key=lambda r: r["from_zone"]["radius_km"] + r["to_zone"]["radius_km"])
    return hits[0]


def hourly_price(vehicle_type: str, hours: int) -> float:
    return round(VEHICLES[vehicle_type]["hourly"] * hours, 2)


def fits(vehicle_type: str, passengers: int, luggage: int) -> bool:
    v = VEHICLES[vehicle_type]
    return passengers <= v["passengers"] and luggage <= v["luggage"]


def booking_ref() -> str:
    import secrets
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "RG-" + "".join(secrets.choice(alphabet) for _ in range(6))
