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

# Service labels in the 6 supported languages (fr is the default `label`)
SERVICE_LABELS = {
    "private": {"en": "Private Driver", "es": "Chófer privado", "ar": "سائق خاص", "zh": "私人司机", "pt": "Motorista particular"},
    "airport": {"en": "Airport Transfer", "es": "Traslado aeropuerto", "ar": "نقل من/إلى المطار", "zh": "机场接送", "pt": "Transfer aeroporto"},
    "hourly": {"en": "Hourly Chauffeur", "es": "Chófer por horas", "ar": "سائق بالساعة", "zh": "包时司机", "pt": "Motorista por hora"},
    "business": {"en": "Business Travel", "es": "Viaje de negocios", "ar": "رحلات عمل", "zh": "商务出行", "pt": "Viagem de negócios"},
    "city_tour": {"en": "City Tour", "es": "Tour por París", "ar": "جولة في باريس", "zh": "巴黎城市观光", "pt": "Tour por Paris"},
    "events": {"en": "Events", "es": "Eventos y ferias", "ar": "فعاليات ومعارض", "zh": "活动与展会", "pt": "Eventos e feiras"},
    "long_distance": {"en": "Long Distance", "es": "Larga distancia", "ar": "مسافات طويلة", "zh": "长途出行", "pt": "Longa distância"},
    "special": {"en": "Special Occasions", "es": "Ocasiones especiales", "ar": "مناسبات خاصة", "zh": "特殊场合", "pt": "Ocasiões especiais"},
}

FAQ = {
    "fr": [
        ("Comment modifier ma réservation ?", "Depuis « Mes courses », ouvrez la course puis annulez-la (gratuit tant qu'aucun chauffeur n'a accepté) et réservez à nouveau avec les bons horaires. Vous pouvez aussi écrire au chauffeur via le chat."),
        ("Comment annuler ?", "Ouvrez la course et touchez « Annuler la course ». Gratuit avant acceptation, 3 € de frais après acceptation. Une course en cours ne peut pas être annulée."),
        ("Où retrouver mon chauffeur ?", "Vous recevez son nom, sa photo, son véhicule et sa plaque dès l'acceptation. Suivez-le en direct sur la carte ; à l'aéroport il vous attend à la sortie des arrivées avec une pancarte à votre nom."),
        ("Que faire si mon vol est retardé ?", "Indiquez votre numéro de vol lors de la réservation : nous suivons le vol et décalons la prise en charge automatiquement, sans frais."),
        ("Comment fonctionne le paiement ?", "Payez par carte (Visa, Mastercard, Amex, Apple Pay, Google Pay via paiement sécurisé Stripe), en espèces, ou avec votre crédit parrainage. Le reçu est disponible dans le détail de la course."),
        ("J'ai oublié un objet dans le véhicule", "Contactez le chauffeur via le chat de la course ou notre support WhatsApp avec votre numéro de réservation (RG-…) : nous organisons la restitution."),
    ],
    "en": [
        ("How do I change my booking?", "Open the ride in “My rides”, cancel it (free until a driver accepts) and book again with the right time. You can also message the driver in the ride chat."),
        ("How do I cancel?", "Open the ride and tap “Cancel ride”. Free before acceptance, €3 fee after a driver accepted. A ride in progress cannot be cancelled."),
        ("Where do I meet my driver?", "You receive the driver's name, photo, car and plate as soon as they accept. Track them live on the map; at the airport they wait at the arrivals exit with a name sign."),
        ("What if my flight is delayed?", "Enter your flight number when booking: we monitor the flight and shift the pickup automatically, free of charge."),
        ("How does payment work?", "Pay by card (Visa, Mastercard, Amex, Apple Pay, Google Pay through secure Stripe checkout), in cash, or with your referral credit. The receipt is available in the ride details."),
        ("I left something in the car", "Contact the driver through the ride chat or our WhatsApp support with your booking number (RG-…): we will arrange the return."),
    ],
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
