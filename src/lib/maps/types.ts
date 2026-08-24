export type Place = {
  id?: string;
  lat: number;
  lng: number;
  title: string;
  subtitle: string;
  source: "pin" | "search";
};

export type RouteOption = {
  id: string;
  label: string;
  coords: [number, number][];
  distanceKm: number;
  durationMin: number;
};

export type BaseLayer = "map" | "satellite" | "hybrid";
export type GpsMode = "off" | "follow";
export type HeadingMode = "north" | "heading";

export type NominatimHit = {
  place_id: number;
  lat: string;
  lon: string;
  display_name: string;
};

export type Arterial = {
  name: string;
  ref: string;
  kind: string;
  cls: number;
  coords: [number, number][];
};

export const HORSHAM_CENTER: [number, number] = [-36.717, 142.2];
export const POZI_URL = "https://horsham.pozi.com/#/x[142.20000]/y[-36.71700]/z[11]";
export const VIEWBOX = "141.55,-36.38,142.65,-37.28";

export const MAP_COLORS = {
  primary: "#1a73e8",
  shire: "#0b57d0",
  grade: "#c45c12",
  gradeHybrid: "#f5d000",
  routeMuted: "#5f6368",
  gps: "#1a73e8",
  road: "#8d8880",
  roadHybrid: "#e11d2e",
  roadEarth: "#8b4a1a",
  roadSat: "#efe8d8",
} as const;

export const SHIRE_BOUNDS = {
  west: 141.6015,
  south: -37.2695,
  east: 142.6275,
  north: -36.3876,
};
