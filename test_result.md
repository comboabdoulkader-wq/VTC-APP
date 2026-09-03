#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================
## Iteration 2 – Feature expansion (main agent)
user_problem_statement: "Ajoute tout : commandes multiples, rallonge 1,20 €/km (centre = Châtelet), courses privées + commission 15 %, gestion d'équipe multi-chauffeurs, GPS live chauffeur, paiement Stripe (clé rk_test fournie), alerte in-app 'chauffeur à 2 min' (SMS via Twilio prêt à brancher), courses programmées."
backend:
  - task: "Estimate with surcharge, ride create/batch w/ options, scheduled rides, available filtering incl. assigned_driver_id"
    file: "/app/backend/routes/rides.py"
    needs_retesting: true
  - task: "Driver location ping + 2-min arrival notification, earnings split, private rides CRUD w/ 15% commission"
    file: "/app/backend/routes/driver.py"
    needs_retesting: true
  - task: "Team: members CRUD, assign, overview, deactivated member login 403"
    file: "/app/backend/routes/team.py"
    needs_retesting: true
  - task: "Stripe checkout session + status verification"
    file: "/app/backend/routes/payments.py"
    needs_retesting: true
  - task: "Notifications list/read"
    file: "/app/backend/routes/notifications.py"
    needs_retesting: true
frontend:
  - task: "Passenger home: pickup change, options (surcharge/schedule/label/payment/notes), cart multi-orders"
    file: "/app/frontend/app/(passenger)/index.tsx, src/components/passenger/RideOptions.tsx"
    needs_retesting: true
  - task: "Ride detail: ETA, driver marker, price breakdown, pay by card, rating"
    file: "/app/frontend/app/(passenger)/ride/[id].tsx"
    needs_retesting: true
  - task: "Driver home: GPS permission card, tags, 'Je suis sur place', accept/start/complete"
    file: "/app/frontend/app/(driver)/index.tsx"
    needs_retesting: true
  - task: "Driver private rides tab + form"
    file: "/app/frontend/app/(driver)/private.tsx"
    needs_retesting: true
  - task: "Driver team tab: add member, detail, assign, toggle active"
    file: "/app/frontend/app/(driver)/team.tsx"
    needs_retesting: true
  - task: "Notifications banner (both roles)"
    file: "/app/frontend/src/components/NotificationsBanner.tsx"
    needs_retesting: true
agent_communication:
  - agent: "main"
    message: "Backend restructured into routes/*. Smoke script /app/backend/tests/smoke_new_features.py passes end-to-end (estimate→batch→checkout→accept→location→alert→complete, private ride + commission, team add/assign/deactivate). Stripe checkout URL generation verified with the user's rk_test key."

## Iteration 4 – GPS, autocomplete, reminders, exports, business accounts, cities (main agent)
backend: routes/company.py, routes/geo_routes.py, geo.py, reports.py, team exports, reminder loop in server.py, city-aware surcharge in core.py — smoke script tests/smoke_business.py passes.
frontend: passenger GPS pickup + Photon autocomplete + business toggle; profile company join + cities moderation; (company) group (dashboard, employees, profile); AccountingExport in team tab and company dashboard; register has Entreprise role.
agent_communication:
  - agent: "main"
    message: "All new endpoints smoke-tested. Please run pytest for new endpoints and UI flows listed in the task."

## Iteration 6 – Driver documents / blocking / selfie / navigation (main agent)
backend: routes/documents.py (+storage.py), working_driver dependency (423 when docs_blocked) on /rides/available, /rides/accept, /driver/status online; hourly compliance_loop; /geo/route (OSRM). Smoke-tested manually: upload, N/A, block/unblock, selfie request+review, file download, reject→block.
frontend: (driver)/documents.tsx tab, admin console src/components/admin/DriversAdmin.tsx (profiles), driver home blocked banner + navigate-button + route polyline, driver profile nav-preference.

## Iteration 8 – Chat, promos, pricing zones, tips (main agent)
backend: routes/extras.py (chat + promos), price_multiplier on cities applied in estimate/build_ride, promo_code in RideCreateIn, tip checkout kind in payments. Smoke tested manually (all OK).
frontend: RideChat + ChatButton (passenger ride detail, driver home), PromosManager (profiles), promo input in RideOptions, tip chips in rating box, city multiplier field in CitiesModeration.

## Iteration 10 – Twilio SMS + phone OTP, wallet UI, security hardening (main agent)
backend: core.py (send_sms w/ Twilio REST, normalize_phone, rate_limit, notify(sms=True)), routes/auth.py (register/login limits, PATCH /auth/me, POST /auth/password, /auth/phone/status|send-code|verify), server.py security headers. Twilio keys NOT configured → send-code returns dev_code. Manually tested with python requests: OTP flow, wrong code 400, sms toggle, password wrong 401, brute force 429.
frontend: PhoneVerifyCard, AccountSection/AccountSettings, WalletCard in 3 profiles, wallet toggle in RideOptions + payload use_wallet, ride detail wallet rows, (auth)/verify-phone, register referral code + eye toggle, root layout wide-screen frame.
agent_communication:
  - agent: "main"
    message: "Please test: phone OTP flow E2E (send code → dev code displayed → verify → badge), SMS switch, account settings (name edit, password change + login with new pwd then revert), register with phone → verify-phone screen, wallet toggle in booking when balance>0 (credit a wallet via a referral chain or directly in DB), ride creation with use_wallet and detail breakdown."

## Iteration 11 – Forgot password (SMS OTP), push notifications relay, tracking-link SMS (main agent)
backend: push.py (POST /api/register-push auth-protected, send_push/push_safe relay – key placeholder → skipped with log), core.notify() now pushes (action_url by role) + send_tracking_link(ride) on accept (rides.py, team.py), push_new_rides_to_drivers on POST /rides & /rides/batch (online, non-blocked drivers). auth.py: POST /auth/forgot-password {identifier: email|phone} → masked_phone + dev_code (test mode), POST /auth/reset-password {identifier, code, new_password} → TokenOut (auto-login). Manually verified via python requests.
frontend: (auth)/forgot-password.tsx + "Mot de passe oublié ?" link on login (testID forgot-password), _layout.tsx push handlers (native only), PushRegistrar component, expo-notifications plugin in app.json.

## Iteration 12 – Phase 2 booking premium (main agent)
backend: catalog.py (8 SERVICES, 5 VEHICLES with capacity/photo/hourly rate, fixed routes seeded ×12 in db.fixed_routes, CANCELLATION_POLICY, booking_ref), flights.py (AviationStack lookup + cache + refresh loop; key empty → 503 / manual entry), routes/booking.py (GET /catalog, GET /fixed-routes, moderator CRUD /admin/fixed-routes, GET /flights/{number}). rides.py: estimate & build_ride accept service_type/hours/passengers/children/child_seats/luggage/flight_number/airline; hourly pricing (min hours), fixed price match by zones, capacity check 422, booking_ref, flight stored; rate accepts comment + punctuality/cleanliness/driving/vehicle → ride.review. Verified manually with python requests.
frontend: ServicePicker, TripDetails (steppers, hours, flight), VehicleCard (photo, capacity, fixed badge), ReviewForm, RideSummary (booking ref, pax/luggage, flight card), "Réserver à nouveau" (rides list + detail → home ?rebook=id prefills), driver tags (service, pax/bag, flight, fixed).

## Iteration 13 – Bug fix: Expo Go crash "expo-notifications ... removed from Expo Go" (main agent)
Root cause: static `import * as Notifications from "expo-notifications"` in app/_layout.tsx and PushRegistrar → module side-effect (DevicePushTokenAutoRegistration) throws on Android Expo Go SDK 53+.
Fix: src/utils/push.ts lazy `require("expo-notifications")` only when Platform !== web AND executionEnvironment !== StoreClient; _layout.tsx & PushRegistrar use getNotifications() (null in Expo Go/web). No static import of expo-notifications remains in app/ or src/.
