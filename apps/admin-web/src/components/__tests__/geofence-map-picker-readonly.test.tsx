import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/render-with-intl";
import { GeofenceMapPicker, type MapCircle, type MapPoint } from "../geofence-map-picker";

// Leaflet decides at import time whether SVG is supported (via createSVGRect,
// which jsdom lacks); without it the circles and dots have no renderer.
vi.hoisted(() => {
  const proto = typeof SVGSVGElement === "undefined" ? undefined : (SVGSVGElement.prototype as unknown as Record<string, unknown>);
  if (proto && !proto.createSVGRect) proto.createSVGRect = () => ({ x: 0, y: 0, width: 0, height: 0 });
});

// Step 5 evidence map (the attendance page): names from ar.json `attendance.detail.map`.
const EVIDENCE_LABEL = "خريطة إثباتات الموقع لهذا الحضور";
const EVIDENCE_HELP =
  "الدائرة الزرقاء نطاق الموقع، والخضراء نقطة تسجيل مؤقتة. النقطة الخضراء الداكنة بدء الدوام، والبنفسجية إنهاء الدوام، والحمراء محاولة مرفوضة. الدائرة المتقطعة حول كل نقطة بحجم دقة GPS.";

const GEOFENCE: MapCircle = { key: "geofence", latitude: 32.0853, longitude: 34.7818, radiusMeters: 150, color: "#2563eb" };

const CLOCK_IN: MapPoint = { key: "ce-in", latitude: 32.0858, longitude: 34.7818, accuracyMeters: 10, color: "#059669", label: "بدء الدوام" };
const CLOCK_OUT: MapPoint = { key: "ce-out", latitude: 32.0856, longitude: 34.7819, accuracyMeters: 12, color: "#4f46e5", label: "إنهاء الدوام" };
/** A refused attempt whose accuracy is unknown: a dot without an accuracy circle. */
const ATTEMPT: MapPoint = { key: "ra-1", latitude: 32.0875, longitude: 34.7818, accuracyMeters: null, color: "#dc2626", label: "محاولة مرفوضة" };
const POINTS = [CLOCK_IN, CLOCK_OUT, ATTEMPT];

function renderEvidenceMap(onChange = vi.fn()) {
  const view = renderWithIntl(
    <GeofenceMapPicker
      readOnly
      latitude={CLOCK_IN.latitude}
      longitude={CLOCK_IN.longitude}
      radiusMeters={1}
      circles={[GEOFENCE]}
      points={POINTS}
      ariaLabel={EVIDENCE_LABEL}
      help={EVIDENCE_HELP}
      onChange={onChange}
    />,
  );
  return { ...view, onChange };
}

function renderEditablePicker(onChange = vi.fn()) {
  const view = renderWithIntl(<GeofenceMapPicker latitude={32.0853} longitude={34.7818} radiusMeters={150} onChange={onChange} />);
  return { ...view, onChange };
}

/** Every vector shape Leaflet drew (circles, accuracy circles and dots). */
function shapes(container: HTMLElement): SVGPathElement[] {
  return Array.from(container.querySelectorAll<SVGPathElement>("path.leaflet-interactive"));
}

function mapElement(container: HTMLElement): HTMLElement {
  const map = container.querySelector<HTMLElement>(".leaflet-container");
  if (!map) throw new Error("no Leaflet map");
  return map;
}

describe("GeofenceMapPicker: read-only evidence mode", () => {
  it("has no draggable marker and is named by ariaLabel, described by the help text", () => {
    const { container } = renderEvidenceMap();
    expect(container.querySelector("img.leaflet-marker-icon")).toBeNull();
    expect(container.querySelector(".leaflet-marker-draggable")).toBeNull();

    const group = screen.getByRole("group", { name: EVIDENCE_LABEL });
    expect(group.getAttribute("aria-labelledby")).toBeNull();
    expect(group.getAttribute("dir")).toBe("ltr");
    expect(document.getElementById(group.getAttribute("aria-describedby") ?? "")?.textContent).toBe(EVIDENCE_HELP);
    // The geofence editor's own name and help are not used.
    expect(screen.queryByRole("group", { name: "خريطة نطاق الموقع" })).toBeNull();
  });

  it("draws the circles, one dot per point and a dashed accuracy circle for each point with a GPS accuracy", () => {
    const { container } = renderEvidenceMap();
    // 1 geofence + 3 dots + 2 accuracy circles; no circle around a marker.
    expect(shapes(container)).toHaveLength(6);

    for (const point of POINTS) {
      const dots = shapes(container).filter((path) => path.getAttribute("fill") === point.color && path.getAttribute("stroke") === "#ffffff");
      expect(dots, point.key).toHaveLength(1);
    }

    const dashed = shapes(container).filter((path) => path.getAttribute("stroke-dasharray") === "4 4");
    expect(dashed.map((path) => path.getAttribute("stroke")).sort()).toEqual([CLOCK_IN.color, CLOCK_OUT.color].sort());

    const geofence = shapes(container).filter((path) => path.getAttribute("stroke") === GEOFENCE.color);
    expect(geofence).toHaveLength(1);
    expect(geofence[0].getAttribute("stroke-dasharray")).toBeNull();
  });

  it("does nothing when the map is clicked", () => {
    const { container, onChange } = renderEvidenceMap();
    fireEvent.click(mapElement(container));
    expect(onChange).not.toHaveBeenCalled();
    expect(container.querySelector("img.leaflet-marker-icon")).toBeNull();
  });
});

describe("GeofenceMapPicker: geofence editor (default mode, regression)", () => {
  it("still renders its draggable marker with the geofence circle around it", () => {
    const { container } = renderEditablePicker();
    const marker = container.querySelector("img.leaflet-marker-icon");
    expect(marker).not.toBeNull();
    expect(marker?.classList.contains("leaflet-marker-draggable")).toBe(true);
    expect(marker?.getAttribute("alt")).toBe("دبوس مركز نطاق الموقع");
    expect(screen.getByRole("group", { name: "خريطة نطاق الموقع" })).toBeTruthy();

    const circles = shapes(container);
    expect(circles).toHaveLength(1);
    expect(circles[0].getAttribute("stroke")).toBe("#2563eb");
    expect(circles[0].getAttribute("stroke-dasharray")).toBeNull();
  });

  it("still moves the center when the map is clicked", () => {
    const { container, onChange } = renderEditablePicker();
    fireEvent.click(mapElement(container));
    expect(onChange).toHaveBeenCalledTimes(1);
    const [lat, lng] = onChange.mock.calls[0];
    expect(Number.isFinite(lat)).toBe(true);
    expect(Number.isFinite(lng)).toBe(true);
  });
});
