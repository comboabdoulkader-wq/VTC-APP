export const money = (n: number | undefined | null) => `${(n ?? 0).toFixed(2)} €`;

export const fmtDateTime = (iso: string | Date | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }) +
    " · " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
};

export const fmtTime = (iso: string | Date | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "";

export const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  requested: { label: "En attente", color: "#D97736" },
  accepted: { label: "Accepté", color: "#2D8C50" },
  in_progress: { label: "En cours", color: "#2D8C50" },
  completed: { label: "Terminée", color: "#4A4A4A" },
  cancelled: { label: "Annulée", color: "#D32F2F" },
};

export const VEHICLE_ICON: Record<string, string> = { standard: "car", premium: "car-sports", van: "van-passenger", van_premium: "van-utility", group: "bus" };
