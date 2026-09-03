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


# ---- Legal pages (fr/en; other languages fall back to en). {company} / {email} are filled from env at request time. ----
LEGAL = {
    "fr": {
        "terms": ("Conditions générales de vente", [
            ("1. Objet", "{company} met en relation des clients avec des chauffeurs professionnels (VTC) pour des prestations de transport de personnes : transferts aéroport, trajets privés, mise à disposition, visites, événements et longue distance."),
            ("2. Réservation", "La réservation est confirmée à réception du numéro de réservation (RG-XXXXXX). Le prix affiché avant confirmation est ferme et TTC ; il inclut les péages et frais d'approche. Les prix fixes (aéroports, Disneyland, Versailles…) ne varient pas en cas de trafic."),
            ("3. Prix et paiement", "Le paiement s'effectue par carte bancaire (Visa, Mastercard, American Express, Apple Pay, Google Pay) via notre prestataire sécurisé Stripe, en espèces auprès du chauffeur, ou avec le crédit du portefeuille. Un reçu est disponible dans l'application."),
            ("4. Attente et modifications", "Aéroports : 60 minutes d'attente incluses après l'atterrissage réel. Autres adresses : 15 minutes. Au-delà, l'attente est facturée au tarif horaire de la catégorie. Toute modification est possible via l'application ou le support."),
            ("5. Responsabilités", "Les chauffeurs sont des professionnels détenteurs d'une carte VTC, d'une assurance responsabilité civile professionnelle et de documents contrôlés régulièrement par {company}. Le client s'engage à respecter le véhicule et le chauffeur."),
            ("6. Réclamations", "Toute réclamation est à adresser à {email} avec le numéro de réservation. Litiges : droit français ; le client peut recourir gratuitement à un médiateur de la consommation."),
        ]),
        "privacy": ("Politique de confidentialité", [
            ("Données collectées", "Nom, email, téléphone, adresses de prise en charge, position GPS pendant la course, informations de vol, historique des courses et paiements (les données de carte sont traitées uniquement par Stripe)."),
            ("Utilisation", "Exécution des courses, sécurité (partage de la position avec le chauffeur), notifications, facturation, prévention de la fraude et amélioration du service. Aucune vente de données à des tiers."),
            ("Conservation", "Données de compte conservées pendant la durée de la relation puis 3 ans ; documents comptables 10 ans conformément à la loi."),
            ("Vos droits (RGPD)", "Accès, rectification, suppression, portabilité et opposition : écrivez à {email}. Vous pouvez supprimer votre compte depuis le support."),
            ("Sous-traitants", "Stripe (paiement), Twilio (SMS), hébergement cloud sécurisé en Europe, service de notifications push."),
        ]),
        "cancellation": ("Conditions d'annulation", [
            ("Avant acceptation", "Annulation gratuite tant qu'aucun chauffeur n'a accepté la course."),
            ("Après acceptation", "Frais fixes de 3 € reversés au chauffeur déjà en route. Pour une course programmée, l'annulation reste gratuite jusqu'à 2 heures avant l'heure de prise en charge."),
            ("Course en cours", "Une course démarrée ne peut pas être annulée ; le prix total est dû."),
            ("Retard de vol", "Si vous avez renseigné votre numéro de vol, la prise en charge est décalée automatiquement sans frais, même en cas de retard important."),
            ("Remboursements", "Les paiements par carte ou portefeuille sont remboursés automatiquement, déduction faite des frais éventuels, sous 5 à 10 jours ouvrés."),
        ]),
    },
    "en": {
        "terms": ("Terms of Service", [
            ("1. Purpose", "{company} connects customers with professional licensed private drivers for airport transfers, private rides, hourly hire, city tours, events and long-distance trips."),
            ("2. Booking", "A booking is confirmed once you receive a booking number (RG-XXXXXX). The price shown before confirmation is final and includes taxes, tolls and approach fees. Fixed prices (airports, Disneyland, Versailles…) never change because of traffic."),
            ("3. Prices and payment", "Pay by card (Visa, Mastercard, American Express, Apple Pay, Google Pay) through our secure provider Stripe, in cash to the driver, or with your wallet credit. A receipt is available in the app."),
            ("4. Waiting time and changes", "Airports: 60 minutes of waiting included after actual landing. Other addresses: 15 minutes. Beyond that, waiting is charged at the hourly rate of the category. Changes can be made in the app or via support."),
            ("5. Liability", "Drivers are licensed professionals with professional liability insurance and documents regularly checked by {company}. Customers agree to respect the vehicle and the driver."),
            ("6. Claims", "Send any claim to {email} with your booking number. Disputes are governed by French law; consumers may use a free consumer mediator."),
        ]),
        "privacy": ("Privacy Policy", [
            ("Data we collect", "Name, email, phone, pickup addresses, GPS position during the ride, flight information, ride and payment history (card data is processed only by Stripe)."),
            ("How we use it", "Performing rides, safety (sharing your position with the driver), notifications, invoicing, fraud prevention and service improvement. We never sell your data."),
            ("Retention", "Account data is kept for the duration of the relationship plus 3 years; accounting records for 10 years as required by law."),
            ("Your rights (GDPR)", "Access, rectification, deletion, portability and objection: write to {email}. You can delete your account through support."),
            ("Processors", "Stripe (payments), Twilio (SMS), secure cloud hosting in Europe, push notification service."),
        ]),
        "cancellation": ("Cancellation Policy", [
            ("Before acceptance", "Free cancellation as long as no driver has accepted the ride."),
            ("After acceptance", "A fixed €3 fee paid to the driver already on the way. For scheduled rides, cancellation stays free until 2 hours before pickup."),
            ("Ride in progress", "A started ride cannot be cancelled; the full price is due."),
            ("Flight delays", "If you entered your flight number, the pickup is shifted automatically at no cost, even for long delays."),
            ("Refunds", "Card and wallet payments are refunded automatically, minus any applicable fee, within 5 to 10 business days."),
        ]),
    },
}

# ---- Localized push/SMS notification templates by type (fr is written inline by the routes) ----
NOTIF_I18N = {
    "accepted": {"en": ("Driver found", "{driver} is on the way"), "es": ("Chófer encontrado", "{driver} está en camino"), "ar": ("تم العثور على سائق", "{driver} في الطريق"), "zh": ("已找到司机", "{driver} 正在赶来"), "pt": ("Motorista encontrado", "{driver} está a caminho")},
    "started": {"en": ("Ride started", "Heading to your destination"), "es": ("Viaje iniciado", "Hacia su destino"), "ar": ("بدأت الرحلة", "في الطريق إلى وجهتك"), "zh": ("行程已开始", "正前往您的目的地"), "pt": ("Viagem iniciada", "A caminho do seu destino")},
    "completed": {"en": ("Ride completed", "Thank you for riding with us – rate your driver!"), "es": ("Viaje finalizado", "Gracias por viajar con nosotros – ¡valore a su chófer!"), "ar": ("انتهت الرحلة", "شكراً لاختيارك لنا – قيّم سائقك!"), "zh": ("行程已完成", "感谢您的乘坐，请为司机评分！"), "pt": ("Viagem concluída", "Obrigado por viajar connosco – avalie o seu motorista!")},
    "cancelled": {"en": ("Ride cancelled", "Your ride has been cancelled"), "es": ("Viaje cancelado", "Su viaje ha sido cancelado"), "ar": ("تم إلغاء الرحلة", "تم إلغاء رحلتك"), "zh": ("行程已取消", "您的行程已被取消"), "pt": ("Viagem cancelada", "A sua viagem foi cancelada")},
    "arriving": {"en": ("Your driver is arriving", "Less than 2 minutes away – please be ready"), "es": ("Su chófer está llegando", "A menos de 2 minutos – esté listo"), "ar": ("سائقك يقترب", "أقل من دقيقتين – كن مستعداً"), "zh": ("司机即将到达", "不到 2 分钟 – 请准备好"), "pt": ("O seu motorista está a chegar", "A menos de 2 minutos – esteja pronto")},
    "reminder": {"en": ("Upcoming ride", "Your scheduled ride starts soon"), "es": ("Próximo viaje", "Su viaje programado empieza pronto"), "ar": ("رحلة قادمة", "رحلتك المجدولة تبدأ قريباً"), "zh": ("即将开始的行程", "您预约的行程即将开始"), "pt": ("Viagem a chegar", "A sua viagem agendada começa em breve")},
    "flight": {"en": ("Flight update", "Your driver is monitoring your flight"), "es": ("Actualización del vuelo", "Su chófer sigue su vuelo"), "ar": ("تحديث الرحلة الجوية", "سائقك يتابع رحلتك"), "zh": ("航班更新", "司机正在跟踪您的航班"), "pt": ("Atualização do voo", "O seu motorista acompanha o seu voo")},
}


def localize_notification(lang: str, type_: str, title: str, body: str, driver: str = "") -> tuple[str, str]:
    """Return (title, body) in the user's language when a template exists; French text is kept otherwise."""
    tpl = NOTIF_I18N.get(type_, {}).get(lang)
    if not lang or lang == "fr" or not tpl:
        return title, body
    return tpl[0], tpl[1].replace("{driver}", driver or "")
