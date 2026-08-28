# CSS-native collapsing header: what actually ships in August 2026

Research date: 2026-08-27. Question: how do you turn a big page hero into a
small pinned header as the user scrolls, using the platform rather than a
framework, and is a JavaScript-driven View Transition worth it on top?

WordWell context that shapes the answer: vanilla JS and CSS with cascade
layers, no framework, no build-time CSS processing beyond the SwatchKit build,
and the document root is the scroller. The target hero goes from a big display
headword plus label to a small pinned bar holding the headword and its
dictionary metadata (pronunciation, part of speech).

Every claim below is tagged. VERIFIED means I read it in a primary source and
the URL is given. INFERRED means I reasoned from verified facts and said so.

## Reference points for the version numbers

Browser versions current on the research date, from the MDN browser-compat-data
release tables (VERIFIED):

- Chrome 152, released 2026-08-25.
  <https://github.com/mdn/browser-compat-data/blob/main/browsers/chrome.json>
- Safari 26.6, released 2026-07-27.
  <https://github.com/mdn/browser-compat-data/blob/main/browsers/safari.json>
- Firefox 154, released 2026-08-18.
  <https://github.com/mdn/browser-compat-data/blob/main/browsers/firefox.json>

## Support matrix

| Feature | Chrome | Safari | Firefox | Source |
| --- | --- | --- | --- | --- |
| `container-type: scroll-state`, `scroll-state(stuck/snapped/scrollable)` | Shipped 133 (2025-02-04) | Not shipped. In tree behind `CSSScrollStateContainerQueriesEnabled`, status `testable`, default false | Not shipped. Pref `layout.css.scroll-state.enabled` default false, bug 1931980 unassigned | [BCD](https://github.com/mdn/browser-compat-data/blob/main/css/at-rules/container.json), [chromestatus 5072263730167808](https://chromestatus.com/feature/5072263730167808), [WebKit prefs](https://github.com/WebKit/WebKit/blob/main/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml), [Gecko prefs](https://github.com/mozilla-firefox/firefox/blob/main/modules/libpref/init/StaticPrefList.yaml), [bug 1931980](https://bugzilla.mozilla.org/show_bug.cgi?id=1931980) |
| `scroll-state(scrolled:)` | Shipped 144 (2026-01-13) | No | No | [BCD](https://github.com/mdn/browser-compat-data/blob/main/css/at-rules/container.json) |
| `animation-timeline`, `scroll-timeline`, `view-timeline`, `animation-range` | Shipped 115 (2023-07-18) | Shipped 26 (2025-09-15) | Nightly only since 136, pref `layout.css.scroll-driven-animations.enabled`, ship bug 1324602 open | [BCD](https://github.com/mdn/browser-compat-data/blob/main/css/properties/animation-timeline.json), [WebKit Safari 26.0 notes](https://webkit.org/blog/17333/webkit-in-safari-26-0/), [MDN Firefox experimental features](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Experimental_features), [bug 1324602](https://bugzilla.mozilla.org/show_bug.cgi?id=1324602) |
| `timeline-scope` | Shipped 116 (2023-08-15); the `all` value was removed in 138 | Shipped 26 (2025-09-15) | Nightly only | [BCD](https://github.com/mdn/browser-compat-data/blob/main/css/properties/timeline-scope.json) |
| `interpolate-size: allow-keywords` | Shipped 129 (2024-09-17) | No implementation, no feature flag in tree | No implementation, no pref | [BCD](https://github.com/mdn/browser-compat-data/blob/main/css/properties/interpolate-size.json), [chromestatus 5196713071738880](https://chromestatus.com/feature/5196713071738880) |
| `calc-size()` | Shipped 129 (2024-09-17) | No | No | [BCD](https://github.com/mdn/browser-compat-data/blob/main/css/types/calc-size.json) |
| `grid-template-rows` animation (the `0fr` to `1fr` collapse) | Shipped 107 (2022-10-25) | Shipped 16 (2022-09-12) | Shipped 66 (2019-03-19) | [BCD](https://github.com/mdn/browser-compat-data/blob/main/css/properties/grid-template-rows.json) |
| `IntersectionObserver` | Shipped 51 (2016-05-25) | Shipped 12.1 (2019-03-25) | Shipped 55 (2017-08-08) | [BCD](https://github.com/mdn/browser-compat-data/blob/main/api/IntersectionObserver.json) |
| `IntersectionObserver.scrollMargin` | Shipped 120 (2023-12-05) | Shipped 26 (2025-09-15) | Shipped 141 (2025-07-22) | [BCD](https://github.com/mdn/browser-compat-data/blob/main/api/IntersectionObserver.json) |
| `position: sticky` | Shipped 56 (2017-01-25) | Shipped 13 (2019-09-19), prefixed from 7 | Shipped 32 (2014-09-02) | [BCD](https://github.com/mdn/browser-compat-data/blob/main/css/properties/position.json) |
| Same-document View Transitions (`document.startViewTransition`) | Shipped 111 (2023-03-07) | Shipped 18 (2024-09-16) | Shipped 144 (2025-10-14) | [BCD](https://github.com/mdn/browser-compat-data/blob/main/api/ViewTransition.json) |
| `ViewTransition.types` | Shipped 125 (2024-05-14) | Shipped 18.2 (2024-12-11) | Shipped 147 (2026-01-13) | [BCD](https://github.com/mdn/browser-compat-data/blob/main/api/ViewTransition.json) |
| `scroll-margin-top` | Shipped 69 (2018-09-04) | Shipped 14.1 (2021-04-26) | Shipped 68 (2019-07-09) | [BCD](https://github.com/mdn/browser-compat-data/blob/main/css/properties/scroll-margin-top.json) |
| `prefers-reduced-motion` | Shipped 74 | Shipped 10.1 | Shipped 63 | [BCD](https://github.com/mdn/browser-compat-data/blob/main/css/at-rules/media.json) |

Two of these rows decide the whole question. Scroll-state queries are a Chrome
feature and nothing more. Scroll-driven animations have two engines out of
three, and Firefox is the holdout.

## 1. Scroll-state container queries

The syntax, from the MDN guide (VERIFIED,
<https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Conditional_rules/Container_scroll-state_queries>):

```css
header {
  position: sticky;
  top: 0;
  container-type: scroll-state;
  container-name: sticky-heading;
}

@container sticky-heading scroll-state(stuck: top) {
  h2, p { background: #cccccc; box-shadow: 0 5px 2px #00000077; }
}
```

Four descriptors exist (VERIFIED,
<https://developer.mozilla.org/en-US/docs/Web/CSS/@container>):

- `stuck: none | top | right | bottom | left | block-start | block-end |
  inline-start | inline-end`. The element must have `position: sticky` and sit
  inside a scroll container. Adjacent axes can both match, opposite edges
  never can.
- `snapped: none | x | y | block | inline | both`. Needs a scroll container
  ancestor with `scroll-snap-type` other than `none`.
- `scrollable: none | top | right | bottom | left | x | y | block | inline |
  block-start | block-end | inline-start | inline-end`, meaning the container
  can still be scrolled that way by the user.
- `scrolled:`, same value space, meaning the container was most recently
  scrolled that way. Chrome 144 and later only.

### The markup constraint, which is the interesting part

MDN states it flatly (VERIFIED, same guide): "container queries enable styling
a container's descendants, not the container itself". The `container-type:
scroll-state` has to go on the sticky element, because that is the element
whose stuck state is being asked about. So the sticky element is exactly the
one element you cannot restyle from the query.

For WordWell that means the collapse cannot be written as "shrink the sticky
header". It has to be written as "the sticky header is a shell whose height
follows its contents, and the query shrinks the contents". A sticky shell with
no padding of its own, wrapping a hero block that loses its display size and
gains a metadata row, gives the right result. The shell's own background,
border and shadow have to come from an inner layer too, since the shell itself
is off limits (INFERRED from the descendants-only rule).

Scroll-state containers do not apply size or style containment (VERIFIED,
css-conditional-5 section 5.1,
<https://drafts.csswg.org/css-conditional-5/#container-type>), so unlike
`container-type: size` this does not force you to give the header a fixed
height.

### Support, degradation, detection

Chrome 133, stable 2025-02-04, enabled by default on desktop, Android and
WebView (VERIFIED, chromestatus feature 5072263730167808 reports status
"Enabled by default" at milestone 133).

Safari has an implementation in tree that is off everywhere.
`CSSScrollStateContainerQueriesEnabled` has `status: testable` and
`default: false` for WebKit, WebKitLegacy and WebCore (VERIFIED,
<https://github.com/WebKit/WebKit/blob/main/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml>).
The same file documents what `testable` means: "Feature in active development.
Stable enough for testing, but not ready to ship. OFF by default. Enabled in
test infrastructure only." So it is not in Safari, and it is not in Safari
Technology Preview either.

Firefox has the pref `layout.css.scroll-state.enabled` with `value: false`
(VERIFIED,
<https://github.com/mozilla-firefox/firefox/blob/main/modules/libpref/init/StaticPrefList.yaml>).
The tracking bug, 1931980 "[css-conditional-5] Support scroll-state container
queries", is NEW, assigned to nobody, last touched 2026-07-07 (VERIFIED,
Bugzilla REST). Both standards-position issues are still open with no position
label: mozilla/standards-positions#896 and WebKit/standards-positions#261
(VERIFIED, GitHub API). Scroll-state queries are not an Interop 2026 focus area
(VERIFIED,
<https://github.com/web-platform-tests/interop/blob/main/2026/README.md>).

Feature detection works with a plain property test, and MDN's own example uses
it (VERIFIED, MDN guide):

```css
@supports not (container-type: scroll-state) { /* fallback */ }
```

In JS: `CSS.supports('container-type', 'scroll-state')`.

Degradation is the best of any option here. A browser that does not understand
`container-type: scroll-state` drops that declaration and ignores the
`@container` block, so the header stays sticky and stays big. Nothing breaks,
nothing jumps, you just do not get the collapse (INFERRED from CSS error
handling plus the fact that `position: sticky` is independent).

### Performance

The stuck state is binary, so the visual change is one class-flip-equivalent
restyle plus one transition, not per-frame work. Compared to animating a size
across a scroll range, this is the cheap shape of the problem. Chrome has to
evaluate the stuck state during layout on scrolled frames, but style
invalidation only happens when the answer changes (INFERRED; the spec defines
the query result, it does not describe an implementation's invalidation
strategy, and I found no primary source stating Chrome's cost).

### Accessibility

Nothing moves in the DOM, so heading semantics, accessible name and focus order
survive by construction. The transition on the descendants should be wrapped in
`@media (prefers-reduced-motion: no-preference)`, which the query itself does
nothing about. Sticky headers also raise WCAG 2.2 SC 2.4.11 Focus Not Obscured
(Minimum), Level AA: "When a user interface component receives keyboard focus,
the component is not entirely hidden due to author-created content." The
Understanding document names the exact hazard: "Typical types of content that
can overlap focused items are sticky footers, sticky headers, and non-modal
dialogs", and it names the fix, "using scroll padding so the banner does not
overlap other content" (VERIFIED,
<https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html>).

## 2. Scroll-driven animations

`animation-timeline: scroll()` and `view()`, the `scroll-timeline` and
`view-timeline` named-timeline properties, `animation-range`, and
`timeline-scope` to let a non-descendant see a named timeline (VERIFIED,
<https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll-driven_animations>
and <https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/timeline-scope>).
`scroll()` takes a scroller keyword (`nearest`, `root`, `self`) and an axis;
`view()` takes an axis and an inset. For WordWell the document root is the
scroller, so `scroll(root block)` addresses it directly and no named timeline
is needed.

### Support

Chrome 115 on 2023-07-18 for `animation-timeline`, `scroll-timeline`,
`view-timeline` and `animation-range`; `timeline-scope` in Chrome 116 on
2023-08-15, with the `timeline-scope: all` value removed again in Chrome 138
(VERIFIED, BCD). MDN still documents `all`; do not use it.

Safari 26 on 2025-09-15, all of the above. The WebKit release note has a
"Scroll-driven animations" section: "Scroll-driven animations lets you tie CSS
animations to either the timeline of just how far the user has scrolled, or to
how far particular content has moved through the viewport, in and out of view."
(VERIFIED, <https://webkit.org/blog/17333/webkit-in-safari-26-0/>.)

Firefox has not shipped it, and this is the one I most expected to be wrong.
The Gecko pref is `layout.css.scroll-driven-animations.enabled` with
`value: @IS_NIGHTLY_BUILD@`, which is Nightly-only (VERIFIED, StaticPrefList.yaml).
MDN's experimental features page gives Nightly 136 (VERIFIED,
<https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Experimental_features>).
Bug 1324602, "Ship the scroll-driven animations API (i.e. let
`layout.css.scroll-driven-animations.enabled` ride the trains to release)", is
in state REOPENED as of 2026-07-06, whiteboard
`[platform-feature][webcompat:risk-moderate]` (VERIFIED, Bugzilla REST). So as
of Firefox 154 this is still Nightly.

The encouraging part: scroll-driven animations is an Interop 2026 focus area,
described as "The `animation-timeline`, `scroll-timeline`, and `view-timeline`
CSS properties advance animations based on the user's scroll position."
(VERIFIED,
<https://github.com/web-platform-tests/interop/blob/main/2026/README.md>). That
is three engines committing to test-pass parity this year, which usually
precedes a Firefox ship. It has not happened yet.

### Compositor or main thread

This is where the technique earns or loses its reputation, and the honest
answer is "it depends entirely on which property you animate".

Blink's own documentation (VERIFIED,
<https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/animation/README.md>):
"A subset of style properties (currently transform, opacity, filter, and
backdrop-filter) can be mutated on the compositor thread. Animations that
mutate only these properties are candidates for being accelerated and run on
the compositor thread which ensures they are isolated from Blink's main thread
work."

The source agrees. `kCompositableProperties` in `compositor_animations.cc` is
`backdrop-filter`, `filter`, `opacity`, `rotate`, `scale`, `transform`,
`translate`, plus `background-color` and `clip-path` which go through native
paint worklets (VERIFIED,
<https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/animation/compositor_animations.cc>).
`width`, `height`, `font-size` and `padding` are not on that list, so animating
them across a scroll range is main-thread style plus layout plus paint on every
scrolled frame.

There is a second gate specific to scroll timelines.
`CompositorAnimations::CanStartScrollTimelineOnCompositor` returns
`properties->Scroll() && properties->Scroll()->UserScrollable()` (VERIFIED,
same file). The scroll source has to be a real user-scrollable scroll node. A
programmatically-scrolled-only container will not get a composited scroll
timeline.

WebKit gates the same thing behind `ThreadedScrollDrivenAnimationsEnabled`,
status `stable`, default true, described as "Run qualifying scroll-driven
animations on a separate thread" (VERIFIED, UnifiedWebPreferences.yaml). The
word "qualifying" is doing the same work as Blink's allow-list.

Chrome's developer documentation sells the feature as "silky smooth animations,
driven by scroll, running off the main thread", and its own progress-bar demo
quietly obeys the constraint: "To leverage composited animations, not the
`width` is being animated but the element is scaled down on the x-axis using a
`transform`." (VERIFIED,
<https://developer.chrome.com/docs/css-ui/scroll-driven-animations>.)

So: a hero that continuously shrinks its `height` and `font-size` across a
scroll range is a main-thread animation with layout on every frame, in every
engine. A hero that fades and scales with `opacity` and `transform` is
composited. That distinction, not browser support, is the real cost driver.

### Degradation and detection

Detection is `@supports (animation-timeline: scroll())` or
`@supports (scroll-timeline: --main-timeline)`, which is the form MDN's own
fallback example uses (VERIFIED, MDN scroll-driven animations guide).

The failure mode in a non-supporting browser is nastier than for scroll-state
queries. `animation-timeline` has an initial value of `auto`, meaning the
document timeline. If the unsupported `animation-timeline: scroll()`
declaration is dropped but `animation-name` and `animation-duration` survive,
the keyframes play once on load, on a timer. Your collapsed header appears by
itself two seconds after page load in Firefox (INFERRED from CSS error handling
plus the `auto` initial value in
<https://drafts.csswg.org/css-animations-2/#animation-timeline>; I did not test
it). The mitigation is to declare the animation only inside
`@supports (animation-timeline: scroll())`, never outside it.

### Accessibility

Same DOM, same semantics, same focus order, so nothing structural breaks. The
motion is continuous and scroll-linked, which is the category most likely to
bother a vestibular-sensitive reader, and the spec has no automatic
`prefers-reduced-motion` behaviour. Wrap the whole `@supports` block in
`@media (prefers-reduced-motion: no-preference)` and let reduced-motion readers
get a discrete state change or none at all.

## 3. Animating to and from intrinsic sizes

`interpolate-size: allow-keywords` is inherited, so `:root { interpolate-size:
allow-keywords; }` turns on interpolation between a `<length-percentage>` and
`auto`, `min-content`, `max-content`, `fit-content` or `content` document-wide.
It does not let you interpolate between two intrinsic keywords. `calc-size()`
covers the cases where you need arithmetic on an intrinsic size and implies
`allow-keywords` for its own result (VERIFIED,
<https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/interpolate-size>).

Chrome 129 on 2024-09-17 for both, marked experimental, and MDN's own baseline
banner says "This feature is not Baseline because it does not work in some of
the most widely-used browsers" (VERIFIED, BCD and MDN). Chromestatus lists
Firefox as "Positive" and Safari as "No signal" (VERIFIED, chromestatus feature
5196713071738880). Mozilla's position issue is closed with the label
`position: positive` (VERIFIED,
<https://github.com/mozilla/standards-positions/issues/1022>). WebKit's is
still open with no position label
(<https://github.com/WebKit/standards-positions/issues/348>), and I found no
matching feature flag anywhere in WebKit's preferences file, which is decent
evidence that no implementation exists yet (VERIFIED absence, though absence of
a flag is not proof of absence of code).

Would it help here? Yes, if it existed everywhere. The compact bar's height is
whatever the headword plus metadata row needs, and `height: auto` to
`height: 3.5rem` is exactly the transition you want to write. Since it is
Chrome-only, do not build on it.

The cross-browser substitute is the `grid-template-rows: 0fr` to `1fr`
transition, which has animation support in Chrome 107, Safari 16 and Firefox 66
(VERIFIED, BCD). Put the collapsible part in a one-row grid, animate the track,
and the child needs `overflow: hidden` plus `min-height: 0`. It gets you a
content-height collapse without knowing the height in advance. Note that the
`overflow: hidden` on that child is safe only because the child is not an
ancestor of anything sticky, see section 5.

## 4. IntersectionObserver plus a sentinel

The old approach: put a zero-height sentinel where the header would stop being
big, observe it against the root, and toggle a class on the header when it
leaves.

```js
const sentinel = document.querySelector('.hero-sentinel');
const header = document.querySelector('.word-hero');
new IntersectionObserver(
  ([entry]) => header.classList.toggle('is-pinned', !entry.isIntersecting),
  { threshold: 0 }
).observe(sentinel);
```

Support is total: Chrome 51 (2016-05-25), Safari 12.1 (2019-03-25), Firefox 55
(2017-08-08) (VERIFIED, BCD). `scrollMargin`, useful when you want the trigger
offset relative to a nested scroller, is much newer: Chrome 120, Safari 26,
Firefox 141 (VERIFIED, BCD). `rootMargin` covers the common offset case and has
been there since the start.

What it still buys you, in order of importance:

1. It works in every browser your readers actually have, today, including
   Firefox 154.
2. The state is a class in the DOM, so any styling technique can key off it,
   including ones no CSS query can express (for example "collapsed and the
   audio button is playing").
3. It is one code path. Feature-detecting scroll-state queries to skip the JS
   in Chrome means maintaining two behaviours that drift.

What it costs:

- Extra DOM. A sentinel element with no accessible role, which needs
  `aria-hidden="true"` and zero height so it never lands in the accessibility
  tree or the focus order.
- Main-thread callbacks. They fire on threshold crossings, not per frame, so
  the cost is trivial next to a per-frame size animation.
- A one-frame lag. Observations are queued as a task during "update the
  rendering", so the class lands after that frame's layout and the visual
  change paints on the following frame (INFERRED from the delivery model in
  <https://w3c.github.io/IntersectionObserver/>; I did not measure it). In
  practice a 200ms transition swallows it. If the class change were driving an
  instant snap, you would see it.
- Nothing arrives before JS runs. If the page loads mid-scroll (a restored
  scroll position, a fragment link), the header renders big for one frame until
  the observer fires. Setting the initial state during the first observer
  callback rather than on `DOMContentLoaded` is the usual fix.

Accessibility is good precisely because the technique is boring. One class on
one element, no DOM movement, no focus disruption, and reduced motion is a
media query around the transition.

## 5. position: sticky, and the ways it silently dies

The normative behaviour, from css-position-3 section 3.4 (VERIFIED,
<https://drafts.csswg.org/css-position-3/>): "Sticky positioning is similar to
relative positioning except the offsets are automatically calculated in
reference to the nearest scrollport." The insets "represent insets from the
respective edges of the scrollport of the nearest scroll container with a
matching scrollable axis, defining the sticky view rectangle used to constrain
the box's position", and the box is shifted "insofar as it can while its
position box remains contained within its containing block".

Two clauses in there cause every sticky bug I have seen. "Nearest scroll
container" decides which thing the header sticks to. "Contained within its
containing block" decides how far it can travel.

### Failure mode 1: an ancestor with overflow hidden, scroll, or auto

css-overflow-3 (VERIFIED, <https://drafts.csswg.org/css-overflow-3/>): "The
scroll, auto, and hidden values are known as the scrollable values of overflow.
They cause the box to be a scroll container and the affected axis to be a
scrollable axis."

MDN says the consequence out loud (VERIFIED,
<https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/position>):
"Note that a sticky element 'sticks' to its nearest ancestor that has a
'scrolling mechanism' (created when `overflow` is `hidden`, `scroll`, `auto`,
or `overlay`), even if that ancestor isn't the nearest actually scrolling
ancestor."

So one `overflow: hidden` on a wrapper, added months later to clip a decorative
shape, reparents the header onto a scrollport that never scrolls. The header
stops sticking and there is no error anywhere. This matters more than usual for
WordWell because the document root is the scroller: everything between `<html>`
and the header must keep `overflow: visible`.

`overflow: clip` is not in the list of scrollable values, so it clips without
creating a scroll container and without breaking sticky (VERIFIED by the same
spec sentence, which enumerates scroll, auto and hidden only). When you need
clipping above a sticky element, `clip` is the value to reach for.

### Failure mode 2: a stretched grid or flex item

A grid item's containing block is its grid area (VERIFIED, css-grid-2 section
3.3, <https://drafts.csswg.org/css-grid-2/>: "A grid item's grid area forms the
containing block into which it is laid out"), and by default grid items stretch
to fill that area. A sticky header that fills its grid area exactly has zero
room to move inside its containing block, so the spec's "insofar as it can"
clause resolves to "not at all" and it never appears to stick (INFERRED, but
directly from the two verified spec sentences). The fix is `align-self: start`
on the sticky item, which shrinks it to content height and leaves the rest of
the grid area as travel room. The same reasoning applies to a stretched flex
item in a column flex container.

The related trap: sticky travel is bounded by the containing block, so a sticky
header inside a short section unsticks when that section scrolls past. For a
page-level pinned bar, the header should be a child of a tall container, ideally
`<body>` itself.

### Failure mode 3: anchor targets under the pinned bar

Once a bar is pinned, `#fragment` navigation and `scrollIntoView()` land content
underneath it. Fix it with `scroll-margin-top` on the targets, or
`scroll-padding-top` on the scroller (here, the root). Support is old enough to
rely on: `scroll-margin-top` in Chrome 69, Safari 14.1, Firefox 68 (VERIFIED,
BCD). Watch the Safari note in BCD: before 14.1, scroll margin was not applied
for scrolls to a fragment target or `scrollIntoView()`
(<https://webkit.org/b/189265>), which is exactly the case that matters.

This is also the WCAG 2.4.11 fix quoted in section 1. If the pinned bar is
64px tall, the root needs `scroll-padding-top: 64px` or every focusable target
near a section boundary risks landing under it.

## 6. What View Transitions actually add

Same-document view transitions are widely available now: Chrome 111, Safari 18,
Firefox 144 (2025-10-14), with `ViewTransition.types` in Chrome 125, Safari
18.2, Firefox 147 (VERIFIED, BCD). View transitions are an Interop 2026 focus
area (VERIFIED, Interop 2026 README).

The mechanics matter more than the support here, and they come from
css-view-transitions-1 (VERIFIED,
<https://drafts.csswg.org/css-view-transitions-1/>):

- The transition starts from JS, `document.startViewTransition(callback)`.
  There is no scroll-linked entry point.
- Setup sets "document's rendering suppression for view transitions to true",
  so there is a frame where the page does not render while old and new states
  are captured.
- The old state is captured as "a visual snapshot of the 'old' state as a
  replaced element". It is a static image. It does not scroll, reflow, or
  update.
- During the animating phase, captured elements "are not painted (as if they
  had `opacity: 0`) and do not respond to hit-testing (as if they had
  `pointer-events: none`)".
- The default `::view-transition-group(*)` animation runs 0.25s with
  `animation-fill-mode: both`.
- Transitions are skipped when the document is hidden, when another transition
  is active, when two elements share a `view-transition-name`, and when the
  snapshot containing block size changes.

Now apply that to a scroll collapse. The user is, by definition, scrolling when
the state flips. For a quarter of a second the real header is replaced by a
static image of the old header while the page keeps scrolling underneath, and
the captured region does not respond to taps (INFERRED from the four verified
bullets above; the visible result is a snapshot that lags the scroll). A user
who flicks past the threshold and back triggers a second transition while the
first is running, and the spec skips it. On mobile, the URL bar collapsing
mid-scroll changes the snapshot containing block size, which is one of the
listed skip conditions.

The spec has no `prefers-reduced-motion` handling at all. Skipping the
transition for those users is entirely the author's job (VERIFIED by absence: I
searched the spec text and found no reference).

There is also an accessibility desync worth naming. The DOM is already updated
when the animation plays over the snapshots, so a screen reader sees the new
state while the screen still shows a quarter second of the old one (INFERRED
from the update-callback ordering in the spec).

I looked at whether you could drive the transition's pseudo-element animations
with a scroll timeline to get a scroll-linked morph. The transition ends when
the animations on its pseudo-element tree finish, and a scroll-driven animation
does not finish until the scroll range is exhausted, so at best you would be
holding the page in a rendering-suppressed, non-hit-testable state for as long
as the user scrolls (INFERRED; I could not retrieve the exact "handle transition
frame" algorithm text from the spec render, so treat this as an untested
hypothesis rather than a fact).

What View Transitions genuinely buy: a morph between two states whose DOM
differs, where an element moves from one place in the layout to another and you
want the browser to work out the tween. For WordWell that describes navigating
from a lesson list to a word lesson page, with the headword flying from the
list row into the hero. It does not describe a header that shrinks in place
while staying in the same DOM.

## Recommendation for the WordWell hero

Default: `position: sticky` plus an IntersectionObserver sentinel plus a
discrete CSS transition. It is the only option that works in Chrome, Safari and
Firefox today, the state change is discrete so the expensive layout work
happens twice per collapse rather than sixty times a second, and the semantics
of the headword never move.

Concretely:

- The hero is a sticky shell at `top: 0`, a direct child of `<body>`, with
  nothing between it and `<html>` carrying `overflow: hidden`, `auto` or
  `scroll`. Use `overflow: clip` if something up there needs clipping.
- One `<h1>` holds the headword in both states. Do not render two copies. The
  metadata row (pronunciation, part of speech) lives in the same subtree and is
  revealed by the collapsed state, using `grid-template-rows: 0fr` to `1fr` so
  the height follows content without `interpolate-size`.
- The class toggle drives `font-size`, `padding` and the grid track. These are
  layout properties and are not composited in any engine, which is fine for a
  200ms transition and would not be fine for a per-frame scroll animation.
- `scroll-padding-top` on `:root` matching the collapsed bar height, for WCAG
  2.4.11 and for fragment links.
- Wrap the transitions in `@media (prefers-reduced-motion: no-preference)` and
  let the states swap instantly otherwise.

Progressive enhancement, optional: add the same rules under
`@container scroll-state(stuck: top)` so Chrome gets the collapse without JS.
I would not bother yet. The JS has to exist for Safari and Firefox anyway, so
the query removes no code, and the descendants-only rule forces the shell and
inner-layer split on the markup for the benefit of one engine. Revisit when
WebKit's flag flips or Firefox's bug gets an owner.

Where scroll-driven animations do earn their place: continuous, decorative,
composited effects that are fine to lose in Firefox. A shadow or background
fading in under the pinned bar as `opacity` on a pseudo-element, or a reading
progress bar as `transform: scaleX()`. Declare them only inside
`@supports (animation-timeline: scroll())` so Firefox does not play them once
on load. Do not use them to animate the hero's height.

View Transitions on top of this buy nothing. The collapse is a size and type
change on elements that stay in the same layout position, which a CSS
transition already handles, and in exchange you would take on a
rendering-suppressed frame, a static snapshot that lags live scrolling, a
non-hit-testable region for 250ms, skip conditions that fire on exactly the
mobile gesture that triggers the collapse, and reduced-motion handling you have
to write yourself. Save the API for the lesson-list to lesson-page navigation,
where the headword actually moves and there is no scroll in flight.

## Open questions I could not settle from primary sources

- Chrome's style invalidation cost for scroll-state containers on scrolled
  frames. The spec defines the query result, not the invalidation strategy, and
  I found no Chromium design doc describing it.
- The exact "handle transition frame" algorithm text in css-view-transitions-1,
  which I wanted for the scroll-timeline-on-pseudo-elements question. The spec
  render truncated before that section.
- Whether Safari 26's scroll-driven animation support has behavioural gaps
  against Chrome's. BCD records no partial-implementation flags, but BCD's
  granularity is per property, not per behaviour. The Interop 2026 dashboard at
  <https://wpt.fyi/interop-2026> would answer this properly.
- Whether Firefox has any implementation of `interpolate-size` outside the pref
  system. I verified there is no pref and no BCD entry, which is strong but not
  conclusive.
