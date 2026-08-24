import "leaflet";

declare module "leaflet" {
  interface MapOptions {
    rotate?: boolean;
    bearing?: number;
    rotateControl?: boolean | { position?: string };
    shiftKeyRotate?: boolean;
    touchRotate?: boolean;
    compassBearing?: boolean;
  }

  interface Handler {
    enable(): this;
    disable(): this;
    enabled(): boolean;
  }

  interface Map {
    setBearing(bearing: number, preserveCenter?: boolean): this;
    getBearing(): number;
    compassBearing: Handler;
    touchRotate: Handler;
    shiftKeyRotate: Handler;
  }
}

declare module "leaflet-rotate";
