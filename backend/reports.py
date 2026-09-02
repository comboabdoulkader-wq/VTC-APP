"""Monthly accounting exports (CSV + PDF) shared by team managers and companies."""
import csv
import io
from datetime import datetime, timezone
from typing import List, Tuple

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from core import db

MONTHS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]


def month_bounds(month: str) -> Tuple[datetime, datetime]:
    """'YYYY-MM' -> (start, end) UTC."""
    y, m = [int(x) for x in month.split("-")]
    start = datetime(y, m, 1, tzinfo=timezone.utc)
    end = datetime(y + (m == 12), 1 if m == 12 else m + 1, 1, tzinfo=timezone.utc)
    return start, end


def month_label(month: str) -> str:
    y, m = month.split("-")
    return f"{MONTHS_FR[int(m) - 1]} {y}"


async def rides_for(query: dict, month: str) -> List[dict]:
    start, end = month_bounds(month)
    q = {**query, "status": "completed", "completed_at": {"$gte": start, "$lt": end}}
    return [r async for r in db.rides.find(q, {"_id": 0}).sort("completed_at", 1)]


def group_rides(rides: List[dict], key: str, label_key: str) -> List[dict]:
    groups: dict = {}
    for r in rides:
        g = groups.setdefault(r.get(key) or "—", {"id": r.get(key), "label": r.get(label_key) or "—", "rides": [], "count": 0, "gross": 0.0, "commission": 0.0})
        g["rides"].append(r)
        g["count"] += 1
        g["gross"] += r.get("price", 0) + (r.get("tip") or 0)
        g["commission"] += r.get("commission_amount", 0)
    out = []
    for g in groups.values():
        g["net"] = round(g["gross"] - g["commission"], 2)
        g["gross"] = round(g["gross"], 2)
        g["commission"] = round(g["commission"], 2)
        out.append(g)
    return sorted(out, key=lambda g: -g["gross"])


def _row(r: dict) -> list:
    d = r.get("completed_at") or r.get("created_at")
    return [
        d.strftime("%d/%m/%Y %H:%M") if d else "",
        r.get("id", "")[:8].upper(),
        r.get("driver_name") or "",
        r.get("passenger_label") or r.get("passenger_name") or "",
        r.get("pickup", {}).get("address", ""),
        r.get("dropoff", {}).get("address", ""),
        "Privée" if r.get("source") == "private" else ("Pro" if r.get("business") else "Plateforme"),
        "Carte" if r.get("payment_method") == "card" else "Espèces",
        f"{r.get('price', 0):.2f}",
        f"{r.get('commission_amount', 0):.2f}",
    ]


HEADERS = ["Date", "N° course", "Chauffeur", "Passager", "Départ", "Arrivée", "Type", "Paiement", "Montant €", "Commission €"]


def build_csv(rides: List[dict]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";")
    w.writerow(HEADERS)
    for r in rides:
        w.writerow(_row(r))
    return buf.getvalue()


def build_pdf(title: str, subtitle: str, groups: List[dict], group_title: str) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=12 * mm, rightMargin=12 * mm, topMargin=14 * mm, bottomMargin=14 * mm)
    st = getSampleStyleSheet()
    story = [Paragraph(title, st["Title"]), Paragraph(subtitle, st["Normal"]), Spacer(1, 6 * mm)]
    total_gross = sum(g["gross"] for g in groups)
    total_comm = sum(g["commission"] for g in groups)
    total_count = sum(g["count"] for g in groups)
    summary = [["", "Courses", "Montant €", "Commission €", "Net €"]]
    for g in groups:
        summary.append([g["label"], g["count"], f"{g['gross']:.2f}", f"{g['commission']:.2f}", f"{g['net']:.2f}"])
    summary.append(["TOTAL", total_count, f"{total_gross:.2f}", f"{total_comm:.2f}", f"{total_gross - total_comm:.2f}"])
    t = Table(summary, hAlign="LEFT", colWidths=[70 * mm, 25 * mm, 30 * mm, 30 * mm, 30 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#141414")), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#F0F0F0")), ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#CCCCCC")),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
    ]))
    story += [Paragraph(f"Récapitulatif par {group_title}", st["Heading2"]), t, Spacer(1, 8 * mm)]
    small = st["Normal"].clone("small"); small.fontSize = 7; small.leading = 9
    for g in groups:
        story.append(Paragraph(f"{g['label']} — {g['count']} course(s) · {g['gross']:.2f} € · commission {g['commission']:.2f} €", st["Heading3"]))
        data = [HEADERS] + [[Paragraph(str(c), small) for c in _row(r)] for r in g["rides"]]
        tt = Table(data, repeatRows=1, colWidths=[20 * mm, 14 * mm, 20 * mm, 20 * mm, 32 * mm, 32 * mm, 14 * mm, 14 * mm, 14 * mm, 16 * mm])
        tt.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#EAEAEA")), ("FONTSIZE", (0, 0), (-1, 0), 7),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#DDDDDD")), ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ]))
        story += [tt, Spacer(1, 5 * mm)]
    doc.build(story)
    return buf.getvalue()
