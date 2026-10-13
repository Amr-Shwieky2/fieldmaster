/**
 * Signed URLs (report files, identity documents) come from an API call made
 * after the click. A `window.open` made only when the answer arrives can be
 * refused by the popup blocker (Safari in particular), so these helpers keep
 * to what browsers allow after an await.
 */

/**
 * Downloads a file whose signed URL answers `Content-Disposition: attachment`:
 * following a link to it starts the download and the page stays where it is.
 * A navigation of this tab is never blocked, unlike a new window.
 */
export function downloadSignedUrl(url: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.rel = "noopener noreferrer";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/**
 * Opens a tab during the click (allowed then) and sends it to the signed URL
 * once the API returns it; `opener` is cleared, so the tab cannot reach this
 * page. Call `show` with the URL, or `cancel` when the request failed. If the
 * browser refused even that tab, `show` falls back to a plain `window.open`.
 */
export function openTabForSignedUrl(): { show: (url: string) => void; cancel: () => void } {
  const tab = window.open("", "_blank");
  if (tab) tab.opener = null;
  return {
    show: (url) => {
      if (tab && !tab.closed) tab.location.href = url;
      else window.open(url, "_blank", "noopener,noreferrer");
    },
    cancel: () => tab?.close(),
  };
}
