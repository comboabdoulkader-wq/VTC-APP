// Mock Paris locations for demo
export type Place = { id: string; name: string; address: string; lat: number; lng: number };

export const POPULAR_PLACES: Place[] = [
  { id: "1", name: "Tour Eiffel", address: "Champ de Mars, 5 Av. Anatole France, Paris", lat: 48.8584, lng: 2.2945 },
  { id: "2", name: "Musée du Louvre", address: "Rue de Rivoli, 75001 Paris", lat: 48.8606, lng: 2.3376 },
  { id: "3", name: "Gare de Lyon", address: "20 Bd Diderot, 75012 Paris", lat: 48.8443, lng: 2.3743 },
  { id: "4", name: "Aéroport CDG T2", address: "95700 Roissy-en-France", lat: 49.0034, lng: 2.5730 },
  { id: "5", name: "Aéroport Orly", address: "94390 Orly", lat: 48.7262, lng: 2.3652 },
  { id: "6", name: "Arc de Triomphe", address: "Pl. Charles de Gaulle, 75008 Paris", lat: 48.8738, lng: 2.2950 },
  { id: "7", name: "Montmartre", address: "Place du Tertre, 75018 Paris", lat: 48.8867, lng: 2.3431 },
  { id: "8", name: "La Défense", address: "92800 Puteaux", lat: 48.8918, lng: 2.2381 },
];

export const DEFAULT_PICKUP: Place = {
  id: "current",
  name: "Position actuelle",
  address: "Châtelet, 75001 Paris",
  lat: 48.8583,
  lng: 2.3477,
};
