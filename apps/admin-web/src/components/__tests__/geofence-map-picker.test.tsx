import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import type { Locale } from "@/i18n/config";
import { renderWithIntl } from "@/test/render-with-intl";
import { GeofenceMapPicker } from "../geofence-map-picker";

// Leaflet decides at import time whether SVG is supported (via createSVGRect,
// which jsdom lacks); without it the geofence Circle has no renderer.
vi.hoisted(() => {
  const proto = typeof SVGSVGElement === "undefined" ? undefined : (SVGSVGElement.prototype as unknown as Record<string, unknown>);
  if (proto && !proto.createSVGRect) proto.createSVGRect = () => ({ x: 0, y: 0, width: 0, height: 0 });
});

function renderPicker(locale: Locale, props: { labelId?: string } = {}) {
  const onChange = vi.fn();
  const view = renderWithIntl(<GeofenceMapPicker latitude={32.0853} longitude={34.7818} radiusMeters={1500} onChange={onChange} {...props} />, { locale });
  return { ...view, onChange };
}

/** The Leaflet corner ("leaflet-top leaflet-right", ...) a control element was placed in. */
function cornerOf(element: Element | null): string {
  const corner = element?.closest(".leaflet-top, .leaflet-bottom");
  if (!corner) return "none";
  const vertical = corner.classList.contains("leaflet-top") ? "top" : "bottom";
  const horizontal = corner.classList.contains("leaflet-left") ? "left" : "right";
  return `${vertical}${horizontal}`;
}

describe("GeofenceMapPicker", () => {
  it("keeps the Leaflet map LTR but puts the zoom control on the inline-start side in Arabic (top-right) and the attribution opposite", () => {
    const { container } = renderPicker("ar");
    const group = screen.getByRole("group", { name: "خريطة نطاق الموقع" });
    expect(group.getAttribute("dir")).toBe("ltr");

    const zoomIn = container.querySelector(".leaflet-control-zoom-in");
    expect(zoomIn).not.toBeNull();
    expect(cornerOf(zoomIn)).toBe("topright");
    expect(zoomIn?.getAttribute("title")).toBe("تكبير");
    expect(container.querySelector(".leaflet-control-zoom-out")?.getAttribute("title")).toBe("تصغير");
    expect(cornerOf(container.querySelector(".leaflet-control-attribution"))).toBe("bottomleft");
    // Only one zoom control: the default one is disabled.
    expect(container.querySelectorAll(".leaflet-control-zoom")).toHaveLength(1);
  });

  it("uses the default corners in English (zoom top-left, attribution bottom-right)", () => {
    const { container } = renderPicker("en");
    expect(screen.getByRole("group", { name: "Geofence map" })).toBeTruthy();
    expect(cornerOf(container.querySelector(".leaflet-control-zoom-in"))).toBe("topleft");
    expect(container.querySelector(".leaflet-control-zoom-in")?.getAttribute("title")).toBe("Zoom in");
    expect(cornerOf(container.querySelector(".leaflet-control-attribution"))).toBe("bottomright");
    // The tile layer's OpenStreetMap credit still reaches the relocated attribution control.
    expect(container.querySelector(".leaflet-control-attribution")?.textContent).toContain("OpenStreetMap contributors");
  });

  it("describes the map with translated help text that includes the radius in Western digits", () => {
    renderPicker("ar");
    const group = screen.getByRole("group");
    const help = document.getElementById(group.getAttribute("aria-describedby") ?? "");
    expect(help?.textContent).toContain("1,500 م");
    expect(help?.textContent).toContain("بدء الدوام");
  });

  it("gives the draggable marker a translated alt text", () => {
    const { container } = renderPicker("ar");
    const marker = container.querySelector("img.leaflet-marker-icon");
    expect(marker?.getAttribute("alt")).toBe("دبوس مركز نطاق الموقع");
    expect(marker?.getAttribute("title")).toBe("اسحب الدبوس لتغيير المركز");
  });

  it("uses an external visible label when labelId is given", () => {
    renderPicker("en", { labelId: "my-label" });
    const group = screen.getByRole("group");
    expect(group.getAttribute("aria-labelledby")).toBe("my-label");
    expect(group.getAttribute("aria-label")).toBeNull();
  });
});
