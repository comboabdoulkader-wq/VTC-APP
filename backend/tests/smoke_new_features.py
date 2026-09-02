import json, sys, urllib.request

BASE = "http://localhost:8001/api"

def call(method, path, body=None, token=None):
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None)
    req.add_header("Content-Type", "application/json")
    if token: req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")

def login(email, pw, role, extra={}):
    s, d = call("POST", "/auth/login", {"email": email, "password": pw})
    if s != 200:
        s, d = call("POST", "/auth/register", {"email": email, "password": pw, "full_name": email.split("@")[0].title(), "role": role, "phone": "+33600000000", **extra})
    assert s == 200, d
    return d["access_token"], d["user"]

pt, pu = login("passager@test.com", "password123", "passenger")
dt, du = login("chauffeur@test.com", "password123", "driver", {"vehicle_model": "Peugeot 508", "license_plate": "AB-123-CD"})

pickup = {"lat": 48.95, "lng": 2.45, "address": "Loin du centre"}
drop = {"lat": 48.8584, "lng": 2.2945, "address": "Tour Eiffel"}
s, est = call("POST", "/rides/estimate", {"pickup": pickup, "dropoff": drop})
print("estimate", s, est["surcharge"], est["options"][0]["price"])

s, batch = call("POST", "/rides/batch", {"rides": [
    {"pickup": pickup, "dropoff": drop, "vehicle_type": "standard", "surcharge_enabled": True, "passenger_label": "Maman", "payment_method": "card"},
    {"pickup": pickup, "dropoff": drop, "vehicle_type": "van", "scheduled_at": "2026-06-20T10:00:00Z"},
]}, pt)
print("batch", s, [(r["price"], r["surcharge_amount"], r["scheduled_at"]) for r in batch])
ride = batch[0]

s, d = call("POST", f"/payments/checkout/{ride['id']}", {"return_url": "https://vtc-platform-18.preview.emergentagent.com/payment-result"}, pt)
print("checkout", s, str(d)[:120])
s, d = call("GET", f"/payments/status/{ride['id']}", None, pt)
print("pay status", s, d)

s, d = call("GET", "/rides/available", None, dt); print("available", s, len(d))
s, d = call("POST", f"/rides/{ride['id']}/accept", None, dt); print("accept", s, d.get("status"))
s, d = call("POST", "/driver/location", {"lat": 48.949, "lng": 2.449}, dt); print("location", s, d)
s, d = call("GET", "/notifications", None, pt); print("notifs", s, [n["type"] for n in d])
s, d = call("GET", f"/rides/{ride['id']}", None, pt); print("ride eta", d.get("driver_eta_min"), d.get("driver_location"))
s, d = call("POST", f"/rides/{ride['id']}/start", None, dt); s, d = call("POST", f"/rides/{ride['id']}/complete", None, dt); print("complete", s, d.get("status"), d.get("payment_status"))
s, d = call("POST", f"/rides/{batch[1]['id']}/cancel", None, pt); print("cancel scheduled", s)

s, pr = call("POST", "/driver/private-rides", {"client_name": "M. Martin", "client_phone": "+336", "pickup_address": "Gare du Nord", "dropoff_address": "Orly", "scheduled_at": "2026-06-18T08:00:00Z", "price": 60}, dt)
print("private", s, pr.get("status"))
s, d = call("PATCH", f"/driver/private-rides/{pr['id']}", {"status": "completed"}, dt); print("private complete", s, d.get("commission_amount"))
s, d = call("GET", "/driver/earnings", None, dt); print("earnings", s, d)

s, m = call("POST", "/team/members", {"email": "equipier@test.com", "password": "password123", "full_name": "Karim Équipier", "vehicle_model": "Tesla 3", "license_plate": "EQ-001-AA"}, dt)
if s == 409:
    s, ms = call("GET", "/team/members", None, dt); m = ms[0]
print("member", s, m.get("full_name"), m.get("manager_id") == du["id"])
s, r2 = call("POST", "/rides", {"pickup": pickup, "dropoff": drop, "vehicle_type": "standard"}, pt)
s, d = call("POST", "/team/assign", {"ride_id": r2["id"], "driver_id": m["id"]}, dt); print("assign", s, d.get("driver_name"), d.get("status"))
s, d = call("GET", "/team/overview", None, dt); print("overview", s, d)
s, d = call("PATCH", f"/team/members/{m['id']}", {"is_active": False}, dt); print("deactivate", s, d.get("is_active"))
s, d = call("POST", "/auth/login", {"email": "equipier@test.com", "password": "password123"}); print("login disabled", s, d)
s, d = call("PATCH", f"/team/members/{m['id']}", {"is_active": True}, dt)
s, d = call("POST", f"/rides/{r2['id']}/cancel", None, pt)
