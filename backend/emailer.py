"""Ride receipts: PDF generation + transactional email through the Emergent managed email proxy (Resend)."""
import hashlib
import hmac
import io
import ipaddress
import logging
import os
import re
from html import escape
from html.parser import HTMLParser
from urllib.parse import urlparse

import httpx
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from core import JWT_SECRET, db, now_utc

logger = logging.getLogger("email")

# Emergent managed email proxy. CONSTANT — never read from the environment.
EMAIL_BASE_URL = "https://integrations.emergentagent.com"


def _email_key() -> str:
    return os.environ.get("EMERGENT_EMAIL_KEY", "")


def _from_name() -> str:
    return os.environ.get("EMAIL_FROM_NAME") or os.environ.get("COMPANY_NAME") or "RideGo"


def _frontend() -> str:
    return os.environ.get("FRONTEND_URL", "").strip('"').rstrip("/")


# ---------- Guardrail gate (G2/G3) — call on every send ----------
_SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "goo.gl", "rebrand.ly")
_CRED_ASK = ("reply with your password", "reply with the code", "send your password", "cvv",
             "send us your password", "enter your password below", "confirm your card number",
             "your full card number", "seed phrase", "recovery phrase", "verify your card",
             "social security number", "confirm your bank details")
_HOSTISH = re.compile(r"\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})", re.I)


def _host_ok(host: str) -> bool:
    if not host or "xn--" in host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return not any(host == s or host.endswith("." + s) for s in _SHORTENERS)


def _same_site(shown: str, real: str) -> bool:
    return shown == real or real.endswith("." + shown) or shown.endswith("." + real)


class _EmailScan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags, self.urls, self.anchors = set(), [], []
        self._href, self._text = None, []

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())
        self.urls += [v for k, v in attrs if k.lower() in ("href", "src") and v]
        if tag.lower() == "a":
            self._href = dict((k.lower(), v) for k, v in attrs).get("href")
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href is not None:
            self.anchors.append((self._href, "".join(self._text)))
            self._href, self._text = None, []


def _assert_safe_email(subject: str, html: str) -> None:
    scan = _EmailScan(); scan.feed(html)
    if scan.tags & {"form", "input", "textarea", "select"}:
        raise ValueError("No forms or input fields in email (G2)")
    body = f"{subject}\n{html}".lower()
    for p in _CRED_ASK:
        if p in body:
            raise ValueError(f"Email asks the recipient for credentials: {p!r} (G2)")
    for url in scan.urls:
        low = url.strip().lower()
        if low.startswith(("mailto:", "tel:", "cid:", "#")):
            continue
        if not low.startswith("https://"):
            raise ValueError(f"Email links/assets must be absolute https: {url!r} (G3)")
        host = urlparse(low).hostname or ""
        if not _host_ok(host) or urlparse(low).username is not None:
            raise ValueError(f"Shortened, numeric-host or credential-bearing URL: {url!r} (G3)")
    for href, text in scan.anchors:
        real = urlparse(href.strip().lower()).hostname or ""
        if not real:
            continue
        for m in _HOSTISH.finditer(text):
            if not _same_site(m.group(1).lower(), real):
                raise ValueError(f"Anchor text {m.group(1)!r} ≠ real link host {real!r} (G3)")


async def send_email(*, to: str, subject: str, html: str) -> str | None:
    """Server-side templates only (G4). Returns the provider id, or None when the key is not configured."""
    _assert_safe_email(subject, html)
    if not _email_key():
        logger.info("Email (non envoyé, EMERGENT_EMAIL_KEY manquante) -> %s: %s", to, subject)
        return None
    payload = {"to": [to], "subject": subject, "html": html, "from_name": _from_name()}
    reply_to = os.environ.get("EMAIL_REPLY_TO") or os.environ.get("SUPPORT_EMAIL")
    if reply_to:
        payload["contact_email"] = reply_to
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(f"{EMAIL_BASE_URL}/api/v1/email/send", headers={"X-Email-Key": _email_key()}, json=payload)
    resp.raise_for_status()
    return resp.json().get("id")


# ---------- Receipt data ----------
def receipt_sig(ride_id: str) -> str:
    return hmac.new(JWT_SECRET.encode(), f"receipt:{ride_id}".encode(), hashlib.sha256).hexdigest()[:32]


def _lines(r: dict, lang: str) -> list[tuple[str, str]]:
    en = lang != "fr"
    pm = {"card": "Carte bancaire" if not en else "Card", "cash": "Espèces" if not en else "Cash"}.get(r.get("payment_method"), r.get("payment_method", ""))
    when = r.get("completed_at") or r.get("created_at")
    rows = [
        ("Réservation" if not en else "Booking", r.get("booking_ref") or r["id"][:8].upper()),
        ("Date", when.strftime("%d/%m/%Y %H:%M") if hasattr(when, "strftime") else str(when)),
        ("Service", r.get("service_type", "private")),
        ("Départ" if not en else "Pickup", r["pickup"]["address"]),
        ("Arrivée" if not en else "Drop-off", r["dropoff"]["address"]),
        ("Véhicule" if not en else "Vehicle", f"{r.get('vehicle_type', '')} · {r.get('driver_vehicle') or ''} {r.get('driver_plate') or ''}".strip(" ·")),
        ("Chauffeur" if not en else "Driver", r.get("driver_name") or "-"),
        ("Distance", f"{r.get('distance_km', 0):.1f} km · {r.get('duration_min', 0)} min"),
    ]
    if r.get("surcharge_amount"):
        rows.append(("Supplément" if not en else "Surcharge", f"{r['surcharge_amount']:.2f} €"))
    if r.get("discount_amount"):
        rows.append(("Réduction" if not en else "Discount", f"-{r['discount_amount']:.2f} €"))
    if r.get("wallet_amount"):
        rows.append(("Portefeuille" if not en else "Wallet credit", f"-{r['wallet_amount']:.2f} €"))
    if r.get("tip"):
        rows.append(("Pourboire" if not en else "Tip", f"{r['tip']:.2f} €"))
    rows.append(("Paiement" if not en else "Payment", pm))
    rows.append(("TOTAL TTC" if not en else "TOTAL (taxes incl.)", f"{r['price']:.2f} €"))
    return rows


def build_receipt_pdf(r: dict, lang: str = "fr") -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm, topMargin=16 * mm, bottomMargin=16 * mm)
    st = getSampleStyleSheet()
    brand = _from_name()
    title = "Reçu de course" if lang == "fr" else "Ride receipt"
    story = [Paragraph(f"{escape(brand)} — {title}", st["Title"]),
             Paragraph(("Merci d'avoir voyagé avec nous." if lang == "fr" else "Thank you for riding with us."), st["Normal"]), Spacer(1, 6 * mm)]
    t = Table([[k, v] for k, v in _lines(r, lang)], hAlign="LEFT", colWidths=[50 * mm, 120 * mm])
    t.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"), ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#F0F0F0")), ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#CCCCCC")),
        ("FONTSIZE", (0, 0), (-1, -1), 9), ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story += [t, Spacer(1, 8 * mm), Paragraph(f"{escape(brand)} · {escape(os.environ.get('SUPPORT_EMAIL') or '')}", st["Normal"])]
    doc.build(story)
    return buf.getvalue()


async def send_ride_receipt(ride: dict) -> bool:
    """Email the passenger an HTML receipt with a signed link to the PDF. Idempotent per ride. Never raises."""
    try:
        if not ride.get("passenger_id") or ride.get("receipt_sent_at") or ride.get("payment_status") != "paid":
            return False
        u = await db.users.find_one({"id": ride["passenger_id"]}, {"_id": 0, "email": 1, "full_name": 1, "language": 1})
        if not u or not u.get("email"):
            return False
        lang = "fr" if u.get("language", "fr") == "fr" else "en"
        brand = escape(_from_name())
        pdf_url = f"{_frontend()}/api/receipts/{ride['id']}.pdf?sig={receipt_sig(ride['id'])}"
        rows = "".join(f'<tr><td style="padding:6px 8px;color:#666">{escape(k)}</td><td style="padding:6px 8px;font-weight:600">{escape(str(v))}</td></tr>' for k, v in _lines(ride, lang))
        subject = (f"Votre reçu {brand} · {ride.get('booking_ref', '')} · {ride['price']:.2f} €" if lang == "fr"
                   else f"Your {brand} receipt · {ride.get('booking_ref', '')} · €{ride['price']:.2f}")
        hello = f"Bonjour {escape(u['full_name'])}, merci d'avoir voyagé avec {brand}. Voici le reçu de votre course." if lang == "fr" \
            else f"Hi {escape(u['full_name'])}, thank you for riding with {brand}. Here is your ride receipt."
        link_txt = "Télécharger le reçu PDF" if lang == "fr" else "Download PDF receipt"
        footer = (f"Envoyé par {brand}. Nous ne demandons jamais votre mot de passe ni vos données bancaires par email."
                  if lang == "fr" else f"Sent by {brand}. We never ask for your password or card details by email.")
        html = (f'<table role="presentation" width="100%"><tr><td style="padding:24px;font-family:Arial,sans-serif;color:#141414">'
                f'<h2 style="margin:0 0 12px">{brand}</h2><p>{hello}</p>'
                f'<table role="presentation" style="border-collapse:collapse;border:1px solid #eee;width:100%">{rows}</table>'
                + (f'<p style="margin:20px 0"><a href="{pdf_url}" style="background:#141414;color:#fff;padding:12px 18px;border-radius:24px;text-decoration:none">{link_txt}</a></p>' if _frontend().startswith("https://") else "")
                + f'<p style="font-size:12px;color:#888">{footer}</p></td></tr></table>')
        email_id = await send_email(to=u["email"], subject=subject, html=html)
        await db.rides.update_one({"id": ride["id"]}, {"$set": {"receipt_sent_at": now_utc(), "receipt_email_id": email_id}})
        return True
    except Exception as e:
        logger.warning("Receipt email failed (non-blocking): %s", e)
        return False
