# RideGo VTC App - PRD

## Overview
A full-stack VTC (Voiture de Tourisme avec Chauffeur) mobile app built with Expo + FastAPI + MongoDB. Provides Uber-like ride-hailing with two roles: Passenger and Driver.

## Features
- Auth: email/password with JWT (bcrypt hashing), role selection at registration
- Passenger flow: map home with "Where to?" bottom sheet, popular Paris destinations, price estimation across 3 vehicle types (Standard, Premium, Van), ride request, live tracking with polling, driver rating post-trip, ride history
- Driver flow: online/offline toggle, list of available ride requests (polled every 5s), accept/start/complete workflow, earnings dashboard
- Payment: cash only (MVP)
- Map: react-native-maps on native, stylized fallback on web

## Backend Endpoints (/api)
- POST /auth/register, /auth/login, GET /auth/me
- POST /rides/estimate
- POST /rides (passenger)
- GET /rides/mine, /rides/active
- GET /rides/available (driver)
- POST /rides/{id}/accept, /start, /complete, /cancel, /rate
- POST /driver/status, GET /driver/earnings

## Tech Stack
- Frontend: Expo Router, React Native 0.81, @gorhom/bottom-sheet, react-native-maps, MaterialDesignIcons
- Backend: FastAPI, Motor (async MongoDB), PyJWT, bcrypt
- Auth: JWT stored in expo-secure-store (native) / localStorage (web fallback)

## Test Credentials
See /app/memory/test_credentials.md
