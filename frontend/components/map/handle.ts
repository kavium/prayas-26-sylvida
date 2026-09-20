/**
 * The live Leaflet instance.
 *
 * Map controls sit outside the map element so they can be styled with the rest
 * of the chrome, which means they need a way to reach the instance. A module
 * handle is narrower than putting a Leaflet object into React state, where it
 * would be compared on every render and never change.
 */

import type L from "leaflet";

let instance: L.Map | null = null;

export function setMap(map: L.Map | null): void {
  instance = map;
}

export function getMap(): L.Map | null {
  return instance;
}
