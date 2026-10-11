import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/render-with-intl";
import { GeofenceMapPicker } from "../geofence-map-picker";

// Leaflet decides at import time whether SVG is supported (via createSVGRect,
// which jsdom lacks); without it the geofence Circle has no renderer.
vi.hoisted(() => {
  const proto = typeof SVGSVGElement === "undefined" ? undefined : (SVGSVGElement.prototype as unknown as Record<string, unknown>);
  if (proto && !proto.createSVGRect) proto.createSVGRect = () => ({ x: 0, y: 0, width: 0, height: 0 });
});

function renderPicker(props: { labelId?: string } = {}) {
  const onChange = vi.fn();
  const view = renderWithIntl(<GeofenceMapPicker latitude={32.0853} longitude={34.7818} radiusMeters={1500} onChange={onChange} {...props} />);
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
  it("keeps the Leaflet map LTR but puts the zoom control on the inline-start side of the RTL page (top-right) and the attribution opposite", () => {
    const { container } = renderPicker();
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
    // No English control titles leak through.
    expect(container.querySelector('[title="Zoom in"], [title="Zoom out"]')).toBeNull();
  });

  it("keeps the OpenStreetMap and Leaflet credits, in Arabic, in the relocated attribution control", () => {
    const { container } = renderPicker();
    // Only one attribution control: the default one is disabled.
    expect(container.querySelectorAll(".leaflet-control-attribution")).toHaveLength(1);
    const attribution = container.querySelector(".leaflet-control-attribution");
    expect(attribution?.textContent).toBe("Leaflet | © مساهمو OpenStreetMap");
    expect(attribution?.querySelector('a[href="https://www.openstreetmap.org/copyright"]')?.textContent).toBe("مساهمو OpenStreetMap");
    expect(attribution?.querySelector('a[href="https://leafletjs.com"]')).not.toBeNull();
    // Leaflet's default prefix (with its English tooltip) is turned off.
    expect(attribution?.textContent).not.toContain("contributors");
    expect(attribution?.querySelector("[title]")).toBeNull();
  });

  it("describes the map with translated help text that includes the radius in Western digits", () => {
    renderPicker();
    const group = screen.getByRole("group");
    const help = document.getElementById(group.getAttribute("aria-describedby") ?? "");
    expect(help?.textContent).toContain("1,500 م");
    expect(help?.textContent).toContain("بدء الدوام");
  });

  it("gives the draggable marker a translated alt text", () => {
    const { container } = renderPicker();
    const marker = container.querySelector("img.leaflet-marker-icon");
    expect(marker?.getAttribute("alt")).toBe("دبوس مركز نطاق الموقع");
    expect(marker?.getAttribute("title")).toBe("اسحب الدبوس لتغيير المركز");
  });

  it("uses an external visible label when labelId is given", () => {
    renderPicker({ labelId: "my-label" });
    const group = screen.getByRole("group");
    expect(group.getAttribute("aria-labelledby")).toBe("my-label");
    expect(group.getAttribute("aria-label")).toBeNull();
  });
});
