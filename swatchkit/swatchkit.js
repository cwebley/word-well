// SwatchKit client script
//
// Powers cross-document View Transitions between the main SwatchKit UI and a
// swatch's full-screen preview page.

let lastPreviewSlug = null;

function parsePreviewTarget(url) {
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.at(-1) === "index.html") segments.pop();

  const previewIndex = segments.lastIndexOf("preview");
  if (previewIndex === -1) return { isPreview: false, slug: null };

  const previewSegments = segments.slice(previewIndex + 1);
  if (previewSegments.length < 1 || previewSegments.length > 2) {
    return { isPreview: false, slug: null };
  }

  return { isPreview: true, slug: previewSegments.at(-1) };
}

function findPreviewIframe(slug) {
  return document.getElementById(slug)?.querySelector("iframe") || null;
}

function resetAfterTransition(viewTransition, element) {
  viewTransition.finished.then(
    () => {
      element.style.viewTransitionName = "none";
    },
    () => {
      element.style.viewTransitionName = "none";
    },
  );
}

window.addEventListener("pageswap", (event) => {
  if (!event.viewTransition || !event.activation?.entry?.url) return;

  const targetUrl = new URL(event.activation.entry.url);
  const { isPreview, slug } = parsePreviewTarget(targetUrl);
  if (!isPreview) return;

  lastPreviewSlug = slug;

  const iframe = findPreviewIframe(slug);
  if (!iframe) return;

  iframe.style.viewTransitionName = "preview";
  resetAfterTransition(event.viewTransition, iframe);
});

window.addEventListener("pagereveal", (event) => {
  if (!event.viewTransition) return;

  const fromUrl = event.activation?.from?.url
    ? new URL(event.activation.from.url)
    : null;
  const fromTarget = fromUrl
    ? parsePreviewTarget(fromUrl)
    : { isPreview: false, slug: null };
  const slug = fromTarget.isPreview ? fromTarget.slug : lastPreviewSlug;
  if (!slug) return;

  const iframe = findPreviewIframe(slug);
  if (!iframe) return;

  iframe.style.viewTransitionName = "preview";
  resetAfterTransition(event.viewTransition, iframe);
  lastPreviewSlug = null;
});
