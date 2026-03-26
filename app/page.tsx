"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import * as turf from "@turf/turf";
import "mapbox-gl/dist/mapbox-gl.css";

const MB_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;

const EVENT_ICONS = {
  march:      { symbol: "→", color: "#94a3b8" },
  combat:     { symbol: "⭐", color: "#facc15" },
  encamp:     { symbol: "🔥", color: "#f97316" },
  retreat:    { symbol: "↩", color: "#818cf8" },
  casualties: { symbol: "💀", color: "#ef4444" },
};

export default function Home() {
  const mapRef        = useRef(null);
  const mapInstance   = useRef<mapboxgl.Map | null>(null);
  const routeCacheRef = useRef<Record<string, any>>({});
  const playIntervalRef = useRef<any>(null);
  const eventMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const encampCircleRef = useRef<string[]>([]);

  const [status, setStatus]           = useState("OGI System: Ready");
  const [nearby, setNearby]           = useState<any>(null);
  const [activeYear, setActiveYear]   = useState("ALL");
  const [locationIntel, setLocationIntel] = useState<any>(null);
  const [activeBattle, setActiveBattle]   = useState<string | null>(null);
  const [timelineHour, setTimelineHour]   = useState(0);
  const [timelineData, setTimelineData]   = useState<any[]>([]);
  const [isPlaying, setIsPlaying]         = useState(false);
  const [theaterMode, setTheaterMode]     = useState(false);
  const [narration, setNarration]         = useState<string | null>(null);
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null);

  // ── Route fetcher with cache ──────────────────────────────────────────────
  const getRoute = useCallback(async (from: number[], to: number[]) => {
    if (!from || !to) return null;
    if (from[0] === to[0] && from[1] === to[1]) return null;
    const key = `${from.join(",")}->${to.join(",")}`;
    if (routeCacheRef.current[key]) return routeCacheRef.current[key];
    try {
      const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${from[0]},${from[1]};${to[0]},${to[1]}?geometries=geojson&access_token=${MB_TOKEN}`;
      const res  = await fetch(url);
      const json = await res.json();
      if (!json.routes?.length) throw new Error("no route");
      routeCacheRef.current[key] = json.routes[0].geometry;
      return json.routes[0].geometry;
    } catch {
      const fallback = { type: "LineString", coordinates: [from, to] };
      routeCacheRef.current[key] = fallback;
      return fallback;
    }
  }, []);

  // ── Clear event markers & encampment circles ──────────────────────────────
  const clearEventLayers = useCallback(() => {
    eventMarkersRef.current.forEach((m) => m.remove());
    eventMarkersRef.current = [];
    const map = mapInstance.current;
    if (!map) return;
    encampCircleRef.current.forEach((id) => {
      if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(id)) map.removeSource(id);
    });
    encampCircleRef.current = [];
  }, []);

  // ── Add a symbol marker at a coordinate ──────────────────────────────────
    }, []);  // clearEventLayers

  const addEventMarker = useCallback((coords: number[], move: any) => {
    const map = mapInstance.current;
    if (!map) return;
    const info = EVENT_ICONS[move.event_type] ?? EVENT_ICONS.march;
    const el = document.createElement("div");
    el.style.cssText = `
      font-size: 22px;
      filter: drop-shadow(0 0 6px ${info.color});
      cursor: default;
    `;
    el.textContent = info.symbol;
    const marker = new mapboxgl.Marker({ element: el, anchor: "center" })
      .setLngLat(coords as [number, number])
      .addTo(map);
    eventMarkersRef.current.push(marker);
  }, []);  // addEventMarker

  // ── Draw encampment radius circle ─────────────────────────────────────────
  const drawEncampment = useCallback((coords: number[], acres: number, color: string) => {
    const map = mapInstance.current;
    if (!map) return;
    const radiusKm = Math.sqrt((acres * 0.00404686) / Math.PI);
    const circle   = turf.circle(coords, radiusKm, { steps: 64 });
    const id       = `encamp-${Date.now()}`;
    map.addSource(id, { type: "geojson", data: circle });
    map.addLayer({
      id,
      type: "fill",
      source: id,
      paint: { "fill-color": color, "fill-opacity": 0.25 },
    });
    encampCircleRef.current.push(id);
  }, []);

  // ── Render timeline up to a given hour ───────────────────────────────────
  const renderTimelineAt = useCallback(async (hour: number, timeline: any[]) => {
    const map = mapInstance.current;
    if (!map) return;
    clearEventLayers();

    const features: any[] = [];

    for (const move of timeline) {
      if (move.hour_index > hour) continue;

      // Encampment circle
      if (move.event_type === "encamp" && move.acres) {
        const pos = move.to ?? move.from;
        drawEncampment(pos, move.acres, "#f97316");
        addEventMarker(pos, move);
        continue;
      }

      // Combat flash marker
      if (move.event_type === "combat") {
        addEventMarker(move.to ?? move.from, move);
      }

      // Casualties marker
      if (move.event_type === "casualties") {
        addEventMarker(move.from, move);
        continue;
      }

      const geom = await getRoute(move.from, move.to);
      if (!geom?.coordinates?.length || geom.coordinates.length < 2) continue;

      let finalGeom = geom;
      if (move.hour_index === hour) {
        try {
          const line    = turf.lineString(geom.coordinates);
          const len     = turf.length(line);
          if (len > 0) {
            const progress = move.hour_progress ?? 1.0;
            const sliced   = turf.lineSliceAlong(line, 0, len * progress);
            if (sliced?.geometry?.coordinates?.length >= 2) {
              finalGeom = sliced.geometry;
            }
          }
        } catch { /* use full geom */ }
      }

      const isDash = move.event_type === "retreat";
      features.push({
        type: "Feature",
        properties: {
          color:  move.side === "confederate" ? "#ef4444" : "#3b82f6",
          width:  Math.max(3, Math.min(16, Math.floor(move.strength / 1400))),
          dashed: isDash,
        },
        geometry: finalGeom,
      });
    }

    map.getSource("maneuvers")?.setData({ type: "FeatureCollection", features });

    // Narration
    const current = timeline.find((t) => t.hour_index === hour);
    if (current) {
      setNarration(`${current.hour_label} · ${current.date} — ${current.action}`);
    }
  }, [getRoute, clearEventLayers, addEventMarker, drawEncampment]);

  // ── Toggle theater mode ───────────────────────────────────────────────────
  const enterTheaterMode = useCallback((battle: any, timeline: any[]) => {
    const map = mapInstance.current;
    if (!map) return;
    setTheaterMode(true);

    // Hide all normal layers
    ["battle-points", "zone-fills", "zone-borders", "corridor-lines"].forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
    });

    // Fly to battle center
    if (battle.geometry?.coordinates) {
      map.flyTo({ center: battle.geometry.coordinates, zoom: 12, pitch: 50, duration: 1500 });
    }

    // Reset and auto-play
    setTimelineHour(0);
    renderTimelineAt(0, timeline);
  }, [renderTimelineAt]);

  const exitTheaterMode = useCallback(() => {
    const map = mapInstance.current;
    if (!map) return;
    setTheaterMode(false);
    setNarration(null);
    clearInterval(playIntervalRef.current);
    setIsPlaying(false);
    clearEventLayers();
    map.getSource("maneuvers")?.setData({ type: "FeatureCollection", features: [] });
    ["battle-points", "zone-fills", "zone-borders", "corridor-lines"].forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "visible");
    });
  }, [clearEventLayers]);

  // ── Map init ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current) return;
    mapboxgl.accessToken = MB_TOKEN;

    const map = new mapboxgl.Map({
      container: mapRef.current,
      style: "mapbox://styles/mapbox/satellite-streets-v12",
      center: [-77.345, 37.592],
      zoom: 13,
      pitch: 45,
    });
    mapInstance.current = map;

    const geolocate = new mapboxgl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
      showUserHeading: true,
    });
    map.addControl(geolocate, "top-right");

    map.on("load", () => {
      geolocate.trigger();

      fetch(`/data/civil_war_events.json?v=${Date.now()}`)
        .then((r) => r.json())
        .then((data) => {
          map.addSource("battles", { type: "geojson", data });
          map.addSource("maneuvers", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          });
          map.addSource("zones", {
            type: "geojson",
            data: {
              type: "FeatureCollection",
              features: data.features.filter(
                (f: any) => f.geometry.type === "Polygon" || f.geometry.type === "LineString"
              ),
            },
          });

          map.addLayer({
            id: "zone-fills",
            type: "fill",
            source: "zones",
            filter: ["==", "$type", "Polygon"],
            paint: {
              "fill-color": [
                "match", ["get", "zone_type"],
                "confederate_advance", "#ef4444",
                "union_defense",       "#3b82f6",
                "encampment",          "#a855f7",
                "battlefield",         "#f59e0b",
                "#9ca3af",
              ],
              "fill-opacity": 0.18,
            },
          });

          map.addLayer({
            id: "zone-borders",
            type: "line",
            source: "zones",
            filter: ["==", "$type", "Polygon"],
            paint: {
              "line-color": [
                "match", ["get", "zone_type"],
                "confederate_advance", "#ef4444",
                "union_defense",       "#3b82f6",
                "encampment",          "#a855f7",
                "battlefield",         "#f59e0b",
                "#9ca3af",
              ],
              "line-width": 2,
              "line-opacity": 0.55,
            },
          });

          map.addLayer({
            id: "corridor-lines",
            type: "line",
            source: "zones",
            filter: ["==", "$type", "LineString"],
            layout: { "line-join": "round", "line-cap": "round" },
            paint: {
              "line-color": ["get", "color"],
              "line-width": ["get", "width"],
              "line-opacity": 0.45,
              "line-dasharray": [2, 1],
            },
          });

          map.addLayer({
            id: "maneuver-lines",
            type: "line",
            source: "maneuvers",
            layout: { "line-join": "round", "line-cap": "round" },
            paint: {
              "line-color": ["get", "color"],
              "line-width": ["get", "width"],
              "line-opacity": 0.92,
            },
          });

          map.addLayer({
            id: "battle-points",
            type: "circle",
            source: "battles",
            filter: ["==", "$type", "Point"],
            paint: {
              "circle-radius": [
                "interpolate", ["linear"], ["zoom"],
                7, 3, 11, 7, 14, 11,
              ],
              "circle-stroke-width": 2,
              "circle-stroke-color": "#ffffff",
              "circle-color": [
                "case",
                ["==", ["get", "type"], "artillery"], "#facc15",
                ["==", ["get", "type"], "hospital"],  "#22c55e",
                ["==", ["get", "type"], "logistics"],  "#a855f7",
                ["==", ["get", "result"], "Union"],    "#3b82f6",
                ["==", ["get", "result"], "Confederate"], "#ef4444",
                "#9ca3af",
              ],
            },
          });

          map.on("click", "battle-points", (e) => {
            if (!e.features?.length) return;
            const props = e.features[0].properties;
            setNearby(props);
            if (props.timeline) {
              try {
                const tl = typeof props.timeline === "string"
                  ? JSON.parse(props.timeline) : props.timeline;
                setTimelineData(tl);
                setActiveBattle(props.name);
                setTimelineHour(0);
                renderTimelineAt(0, tl);
              } catch {}
            } else {
              setTimelineData([]);
              setActiveBattle(null);
            }
          });

          map.on("click", "zone-fills", (e) => {
            if (e.features?.length) setNearby(e.features[0].properties);
          });

          map.on("click", (e) => {
            const hits = map.queryRenderedFeatures(e.point, {
              layers: ["battle-points", "zone-fills"],
            });
            if (!hits.length) analyzeLocation([e.lngLat.lng, e.lngLat.lat], data);
          });

          setStatus("OGI System: Ready");
        });

      geolocate.on("geolocate", (e: any) => {
        const coords = [e.coords.longitude, e.coords.latitude];
        userMarkerRef.current?.remove();
        const el = document.createElement("div");
        el.style.cssText = `
          width:20px;height:20px;background:#facc15;
          border:3px solid #fff;border-radius:50%;
          box-shadow:0 0 12px #facc15;
        `;
        userMarkerRef.current = new mapboxgl.Marker({ element: el })
          .setLngLat(coords as [number, number])
          .addTo(map);
        fetch(`/data/civil_war_events.json?v=${Date.now()}`)
          .then((r) => r.json())
          .then((data) => analyzeLocation(coords, data));
      });
    });

    return () => map.remove();
  }, []);

  const analyzeLocation = (coords: number[], data: any) => {
    const point = turf.point(coords);
    const zones: any[] = [];
    const nearbyEvents: any[] = [];
    data.features.forEach((f: any) => {
      if (f.geometry.type === "Polygon") {
        if (turf.booleanPointInPolygon(point, turf.polygon(f.geometry.coordinates)))
          zones.push(f.properties);
      }
      if (f.geometry.type === "Point") {
        const dist = turf.distance(point, turf.point(f.geometry.coordinates), { units: "miles" });
        if (dist < 1.5) nearbyEvents.push({ ...f.properties, distance_miles: dist.toFixed(2) });
      }
    });
    nearbyEvents.sort((a, b) => a.distance_miles - b.distance_miles);
    setLocationIntel({ coords, zones, nearbyEvents: nearbyEvents.slice(0, 5) });
    setStatus(zones.length > 0 ? "⚔ HALLOWED GROUND DETECTED" : "Location analyzed");
  };

  const filterYear = (year: string) => {
    setActiveYear(year);
    const map = mapInstance.current;
    if (!map?.getLayer("battle-points")) return;
    if (year === "ALL") {
      ["battle-points","zone-fills","zone-borders","corridor-lines"]
        .forEach((id) => map.setFilter(id, null));
    } else {
      const yr = parseInt(year);
      map.setFilter("battle-points",  ["==", "year", yr]);
      map.setFilter("zone-fills",     ["==", "year", yr]);
      map.setFilter("zone-borders",   ["==", "year", yr]);
      map.setFilter("corridor-lines", ["==", "year", yr]);
    }
  };

  const playTimeline = () => {
    if (!timelineData.length) return;
    const maxHour = Math.max(...timelineData.map((t) => t.hour_index));
    setIsPlaying(true);
    let current = timelineHour;
    playIntervalRef.current = setInterval(async () => {
      current++;
      setTimelineHour(current);
      await renderTimelineAt(current, timelineData);
      if (current >= maxHour) {
        clearInterval(playIntervalRef.current);
        setIsPlaying(false);
      }
    }, 1500);
  };

  const pauseTimeline = () => {
    clearInterval(playIntervalRef.current);
    setIsPlaying(false);
  };

  const resetTimeline = () => {
    clearInterval(playIntervalRef.current);
    setIsPlaying(false);
    setTimelineHour(0);
    clearEventLayers();
    mapInstance.current?.getSource("maneuvers")?.setData({
      type: "FeatureCollection", features: [],
    });
    setNarration(null);
  };

  const maxHour      = timelineData.length ? Math.max(...timelineData.map((t) => t.hour_index)) : 0;
  const currentMoves = timelineData.filter((t) => t.hour_index <= timelineHour);

  return (
    <div className="relative w-full h-screen bg-black">
      <div ref={mapRef} className="w-full h-full" />

      {/* ── HEADER ── */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 py-2 bg-black/70 border-b border-blue-900">
        <span className="text-white font-mono text-sm font-bold tracking-widest">
          OGI Tactical Tracker
        </span>
        <span className={`font-mono text-xs ${status.includes("HALLOWED") ? "text-yellow-400 animate-pulse" : "text-blue-400"}`}>
          {status}
        </span>
      </div>

      {/* ── YEAR FILTER — hidden in theater mode ── */}
      {!theaterMode && (
        <div className="absolute top-12 left-4 z-10 flex gap-2 flex-wrap">
          {["ALL","1861","1862","1863","1864","1865"].map((y) => (
            <button
              key={y}
              onClick={() => filterYear(y)}
              className={`px-3 py-1 rounded text-[10px] font-mono border transition-all ${
                activeYear === y
                  ? "bg-blue-600 border-white text-white"
                  : "bg-black/80 border-blue-900 text-blue-400"
              }`}
            >
              {y}
            </button>
          ))}
        </div>
      )}

      {/* ── TIMELINE PANEL ── */}
      {activeBattle && timelineData.length > 0 && (
        <div className={`absolute top-24 left-1/2 -translate-x-1/2 z-20 w-[500px] bg-black/92 border rounded p-3 font-mono text-xs text-white space-y-2 ${theaterMode ? "border-yellow-500" : "border-yellow-700"}`}>
          <div className="flex justify-between items-center">
            <span className="text-yellow-400 font-bold tracking-wide">
              ⚔ {activeBattle} — TACTICAL TIMELINE
            </span>
            <div className="flex gap-2">
              {!theaterMode ? (
                <button
                  onClick={() => {
                    const battleFeature = { geometry: { coordinates: timelineData[0]?.from } };
                    enterTheaterMode(battleFeature, timelineData);
                  }}
                  className="px-2 py-0.5 bg-yellow-900 border border-yellow-600 rounded text-yellow-300 hover:bg-yellow-700 text-[10px]"
                >
                  🎬 Theater Mode
                </button>
              ) : (
                <button
                  onClick={exitTheaterMode}
                  className="px-2 py-0.5 bg-gray-900 border border-gray-600 rounded text-gray-300 hover:bg-gray-700 text-[10px]"
                >
                  Exit Theater
                </button>
              )}
              <button
                onClick={() => { setActiveBattle(null); resetTimeline(); exitTheaterMode(); }}
                className="text-gray-500 hover:text-white"
              >✕</button>
            </div>
          </div>

          {/* Slider */}
          <div className="flex items-center gap-2">
            <span className="text-gray-500 text-[9px] w-8">
              {timelineData[0]?.hour_label}
            </span>
            <input
              type="range" min={0} max={maxHour} value={timelineHour}
              onChange={(e) => {
                const h = parseInt(e.target.value);
                setTimelineHour(h);
                renderTimelineAt(h, timelineData);
              }}
              className="flex-1 accent-yellow-400"
            />
            <span className="text-gray-500 text-[9px] w-10 text-right">
              {timelineData.find((t) => t.hour_index === maxHour)?.hour_label}
            </span>
          </div>

          {/* Current timestamp */}
          <div className="text-center text-yellow-200 font-bold">
            {timelineData.find((t) => t.hour_index === timelineHour)?.hour_label}
            {" · "}
            {timelineData.find((t) => t.hour_index === timelineHour)?.date}
          </div>

          {/* Movement log */}
          <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
            {currentMoves.map((m, i) => {
              const icon = EVENT_ICONS[m.event_type] ?? EVENT_ICONS.march;
              return (
                <div key={i} className="flex items-start gap-2 leading-snug">
                  <span className="text-base flex-shrink-0">{icon.symbol}</span>
                  <div>
                    <span className={m.side === "confederate" ? "text-red-400" : "text-blue-400"}>
                      {m.unit}
                    </span>
                    <span className="text-gray-400"> — {m.action}</span>
                    {m.strength && (
                      <span className="text-gray-600 ml-1">
                        (~{Number(m.strength).toLocaleString()} men)
                      </span>
                    )}
                    {m.casualties && (
                      <span className="text-red-500 ml-1">💀 {m.casualties.toLocaleString()} cas.</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Controls */}
          <div className="flex gap-2 justify-center pt-1 border-t border-gray-800">
            <button
              onClick={resetTimeline}
              className="px-3 py-1 bg-gray-900 border border-gray-700 rounded text-gray-400 hover:text-white"
            >↩ Reset</button>
            {isPlaying ? (
              <button
                onClick={pauseTimeline}
                className="px-4 py-1 bg-yellow-900 border border-yellow-500 rounded text-yellow-300 hover:bg-yellow-700"
              >⏸ Pause</button>
            ) : (
              <button
                onClick={playTimeline}
                className="px-4 py-1 bg-blue-900 border border-blue-500 rounded text-blue-300 hover:bg-blue-700"
              >▶ Play</button>
            )}
          </div>
        </div>
      )}

      {/* ── NARRATION BAR (theater mode) ── */}
      {theaterMode && narration && (
        <div className="absolute bottom-0 left-0 right-0 z-20 px-6 py-3 bg-black/85 border-t border-yellow-800 font-mono text-xs text-yellow-200 text-center tracking-wide animate-pulse">
          {narration}
        </div>
      )}

      {/* ── LEGEND — hidden in theater mode ── */}
      {!theaterMode && (
        <div className="absolute bottom-8 left-4 z-10 bg-black/70 border border-blue-900 rounded p-2 font-mono text-[10px] space-y-1">
          <div className="text-blue-300 font-bold mb-1">LEGEND</div>
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-[#ef4444] inline-block" /> Confederate Victory / Advance</div>
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-[#3b82f6] inline-block" /> Union Victory / Defense</div>
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-[#9ca3af] inline-block" /> Inconclusive</div>
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-[#facc15] inline-block" /> Artillery / Your Location</div>
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-[#22c55e] inline-block" /> Hospital</div>
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-[#a855f7] inline-block" /> Encampment / Logistics</div>
          <div className="border-t border-gray-700 pt-1 mt-1 space-y-1">
            <div className="text-gray-400 font-bold">THEATER SYMBOLS</div>
            <div>⭐ Combat engagement</div>
            <div>🔥 Overnight encampment</div>
            <div>↩ Retreat / withdrawal</div>
            <div>💀 Casualties</div>
            <div>→ March / movement</div>
          </div>
          <div className="mt-1 text-gray-500 italic">Click anywhere to analyze location</div>
        </div>
      )}

      {/* ── LOCATION INTEL ── */}
      {locationIntel && !theaterMode && (
        <div className="absolute top-24 left-4 z-10 w-80 bg-black/90 border border-yellow-600 rounded p-3 font-mono text-xs text-white space-y-2 max-h-[55vh] overflow-y-auto">
          <div className="flex justify-between items-center">
            <span className="font-bold text-yellow-400 text-sm">📍 LOCATION ANALYSIS</span>
            <button onClick={() => setLocationIntel(null)} className="text-gray-500 hover:text-white">✕</button>
          </div>
          {locationIntel.zones.length > 0 ? (
            <div className="space-y-2">
              <div className="text-yellow-300 font-bold">⚔ YOU ARE ON HALLOWED GROUND</div>
              {locationIntel.zones.map((z: any, i: number) => (
                <div key={i} className="border border-yellow-900 rounded p-2 space-y-1">
                  <div className="text-yellow-200 font-bold">{z.name}</div>
                  {z.unit     && <div className="text-gray-300">Unit: {z.unit}</div>}
                  {z.strength && <div className="text-gray-300">Strength: ~{Number(z.strength).toLocaleString()} men</div>}
                  {z.frontage_miles && <div className="text-gray-300">Front: ~{z.frontage_miles} mi wide</div>}
                  {z.acres    && <div className="text-gray-300">Area: ~{z.acres} acres</div>}
                  <div className="text-gray-400 italic">{z.intel}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-gray-400">No known battlefield zone at this exact location.</div>
          )}
          {locationIntel.nearbyEvents.length > 0 && (
            <div className="space-y-1 mt-2">
              <div className="text-blue-300 font-bold">NEARBY ENGAGEMENTS</div>
              {locationIntel.nearbyEvents.map((e: any, i: number) => (
                <div key={i} className="flex justify-between text-gray-300">
                  <span>{e.name}</span>
                  <span className="text-blue-500">{e.distance_miles} mi</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── BATTLE INTEL PANEL ── */}
      {nearby && !theaterMode && (
        <div className="absolute bottom-8 right-4 z-10 w-72 bg-black/90 border border-blue-700 rounded p-3 font-mono text-xs text-white space-y-2">
          <div className="flex justify-between items-center">
            <span className="font-bold text-blue-300 text-sm">{nearby.name}</span>
            <button onClick={() => setNearby(null)} className="text-gray-500 hover:text-white">✕</button>
          </div>
          <div className="text-gray-300 italic">"{nearby.intel || "No local intel recorded."}"</div>
          {nearby.unit     && <div className="text-gray-400">Unit: {nearby.unit}</div>}
          {nearby.strength && <div className="text-gray-400">Strength: ~{Number(nearby.strength).toLocaleString()} men</div>}
          <div className="flex gap-2 text-[10px]">
            <span className="text-blue-500">YEAR: {nearby.year}</span>
            <span className={
              nearby.result === "Union" ? "text-blue-400" :
              nearby.result === "Confederate" ? "text-red-400" : "text-gray-400"
            }>
              {nearby.result?.toUpperCase() || "—"}
            </span>
          </div>
          {nearby.timeline && (
            <div className="text-yellow-400 text-[10px] mt-1 animate-pulse">
              ⚔ Timeline available — click point to load · then 🎬 Theater Mode
            </div>
          )}
        </div>
      )}
    </div>
  );
}
