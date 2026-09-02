import json, urllib.request, datetime

BASE = "http://localhost:8001/api"

def call(method, path, body=None, token=None, raw=False):
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None)
    req.add_header("Content-Type", "application/json")
    if token: req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req) as r:
            data = r.read()
            return r.status, (data if raw else json.loads(data or b"{}"))
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")

def login(email, pw, role, extra={}):
    s, d = call("POST", "/auth/login", {"email": email, "password": pw})
    if s != 200:
        s, d = call("POST", "/auth/register", {"email": email, "password": pw, "full_name": email.split("@")[0].title(), "role": role, **extra})
    assert s == 200, d
    return d["access_token"], d["user"]

pt, pu = login("passager@test.com", "password123", "passenger")
dt, du = login("chauffeur@test.com", "password123", "driver")
ct, cu = login("entreprise@test.com", "password123", "company", {"company_name": "Acme Conseil"})
print("company", cu["company_name"], cu["invite_code"], "moderator?", pu["is_moderator"])

s, d = call("POST", "/company/join", {"code": cu["invite_code"]}, pt); print("join", s, d)
s, emps = call("GET", "/company/employees", None, ct); emp = [e for e in emps if e["id"] == pu["id"]][0]
s, d = call("PATCH", f"/company/employees/{emp['id']}", {"budget_amount": 60, "budget_period": "month"}, ct); print("budget", s, d["budget_amount"], d["remaining"])
s, d = call("GET", "/company/my-budget", None, pt); print("my-budget", s, d)

pickup = {"lat": 48.8443, "lng": 2.3743, "address": "Gare de Lyon"}; drop = {"lat": 48.8584, "lng": 2.2945, "address": "Tour Eiffel"}
s, r1 = call("POST", "/rides", {"pickup": pickup, "dropoff": drop, "vehicle_type": "standard", "business": True}, pt); print("pro ride", s, r1.get("price"), r1.get("business"))
s, r2 = call("POST", "/rides", {"pickup": pickup, "dropoff": drop, "vehicle_type": "premium", "business": True}, pt); print("pro ride over budget", s, r2.get("detail"))
s, d = call("GET", "/company/overview", None, ct); print("overview", s, d)
s, d = call("GET", "/company/rides", None, ct); print("company rides", s, len(d))

# geo + cities
s, d = call("GET", "/geo/reverse?lat=45.764&lng=4.8357"); print("reverse", s, d.get("address"))
s, d = call("POST", "/rides/estimate", {"pickup": {"lat": 45.78, "lng": 4.80, "address": "Lyon nord"}, "dropoff": drop}); print("estimate lyon", s, d["surcharge"])
s, d = call("POST", "/rides/estimate", {"pickup": {"lat": 43.61, "lng": 3.88, "address": "Montpellier"}, "dropoff": drop}); print("estimate montpellier (auto city)", s, d["surcharge"])
s, cities = call("GET", "/admin/cities", None, pt); print("cities", s, len(cities))
paris = [c for c in cities if c["name"] == "Paris"][0]
s, d = call("PATCH", f"/admin/cities/{paris['id']}", {"lat": 48.8583, "lng": 2.3477}, pt); print("moderate", s, d.get("source"))
s, d = call("PATCH", f"/admin/cities/{paris['id']}", {"lat": 48.8583}, ct); print("non-moderator", s)

# scheduled reminder (45 min)
sched = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=30)).isoformat()
s, r3 = call("POST", "/rides", {"pickup": pickup, "dropoff": drop, "vehicle_type": "standard", "scheduled_at": sched}, pt); print("scheduled", s)

# exports
month = datetime.datetime.now().strftime("%Y-%m")
s, d = call("GET", f"/team/invoices?month={month}", None, dt); print("invoices", s, d.get("count"), d.get("gross"), d.get("commission"))
s, d = call("GET", f"/team/export.csv?month={month}&token={dt}", None, None, raw=True); print("csv", s, d[:60])
s, d = call("GET", f"/team/export.pdf?month={month}&token={dt}", None, None, raw=True); print("pdf", s, d[:8], len(d))
s, d = call("GET", f"/company/report?month={month}", None, ct); print("company report", s, d.get("count"))
s, d = call("GET", f"/company/export.pdf?month={month}", None, ct, raw=True); print("company pdf", s, len(d))
call("POST", f"/rides/{r1['id']}/cancel", None, pt); call("POST", f"/rides/{r3['id']}/cancel", None, pt)
