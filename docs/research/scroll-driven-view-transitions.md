# Scroll-driven view transitions

Researched 2026-08-27. Question: how do you drive a View Transition with scroll position, as demonstrated by Bramus Van Damme?

Every claim below is tagged. **VERIFIED (source)** means I read it in the cited primary source. **VERIFIED (experiment)** means I ran it in Google Chrome 152.0.7977.64 headless on macOS and pasted the output. **INFERRED** means I reasoned from those facts and could be wrong.

## Short answer

The technique does not work the way it is usually described. Nobody in Bramus's demos reassigns `Animation.timeline` to a `ScrollTimeline`. What they do is start a view transition, wait for `ready`, pause every animation on the `::view-transition*` pseudo-elements, and then write `animation.currentTime` by hand on every scroll event. The scroll timeline in the CodePen exists only as a dummy animation used as a progress meter, and its progress is read back into `currentTime`. Pausing is what keeps the transition alive, because a paused animation counts as active in the spec's teardown check.

Reassigning the timeline does work in Chrome, and as of Chrome 144 it is now the better technique, because `ViewTransition.waitUntil()` finally solves the problem that forced the pause-and-scrub workaround in the first place. I verified this end to end. See [The 2026 technique](#the-2026-technique-waituntil--scrolltimeline).

There is still no declarative way to do any of this. No `view-transition-trigger`, no `animation-timeline` on view transition pseudo-elements that the browser wires up for you.

## Correcting the premise

The brief asked me to verify this description:

> after calling `document.startViewTransition()`, you await `transition.ready`, call `document.getAnimations()`, filter for the animations running on the `::view-transition*` pseudo-elements, and reassign their `timeline` to a `ScrollTimeline`/`ViewTimeline` so the transition scrubs with scroll

The first three steps are right. The fourth is not what the demo does. **VERIFIED (source)**: the full source of <https://codepen.io/bramus/pen/BabRVLg> contains no assignment to `.timeline` anywhere. It sets `currentTime`.

I could not fetch codepen.io directly. It returns HTTP 403 to both curl and WebFetch, presumably Cloudflare. The raw sources are reachable at `https://cdpn.io/pen/debug/BabRVLg`, which serves the rendered pen with a `<link rel="canonical" href="https://codepen.io/bramus/pen/BabRVLg">` and the title `View Transitions: Playlist Header: Scroll-Driven View Transition (v3)`. That is the artefact I read, and everything I quote below comes from it.

The pen is also the demo Bramus linked in the CSSWG call where this was discussed, which independently confirms it is the right pen. **VERIFIED (source)**: the IRC log at <https://github.com/w3c/csswg-drafts/issues/9901#issuecomment-2165674531> records `<bramus> On the side: demo of a (hacked together) Scroll-Driven View Transition: https://codepen.io/bramus/pen/BabRVLg`.

One more correction. The YouTube video in the brief, `QA5f2loqtM4`, is not the scroll-driven-animations talk. **VERIFIED (source)**: the oEmbed record at `https://www.youtube.com/oembed?url=...v%3DQA5f2loqtM4` gives the title `Cranking View Transitions up to 11 - Bramus Van Damme - CSS Day 2026`, channel Web Conferences Amsterdam, 3287 seconds, published 2026-06-30. The scroll-driven material is one section of that talk. The talk that is entirely about this is "If View Transitions and Scroll-Driven Animations had a baby", CSS Café, 2024-04-25, and its writeup at <https://www.bram.us/2024/04/29/if-view-transitions-and-scroll-driven-animations-had-a-baby-css-cafe/> links slides at <https://slidr.io/bramus/if-view-transitions-and-scroll-driven-animations-had-a-baby-2024-04-25> and, as the live demo, the same CodePen.

## What the demo actually does

**VERIFIED (source)**, all of this section, from the pen source.

The page is a playlist header. Scrolling down shrinks a large album card into a compact sticky bar. The card is `position: fixed`, and a fake scroll-snapping harness made of `::before` pseudo-elements gives it two snap points.

The pen's own header comment states the design:

```
// This version:
// - Uses a dummy SDA linked to the range
// - Uses trackProgress get the SDA progress and sync it to the VT (when in range)
//
// Note: trackProgress uses rAf … seems like a perfect usecase for Custom Effects and/or progress events
```

### The dummy scroll-driven animation

A no-op animation is attached to `document.documentElement` purely so that something in the page has a `ScrollTimeline` whose progress can be read.

```js
const sda = document.documentElement.animate({
	opacity: [1],
}, {
	fill: "none",
	timeline: new ScrollTimeline({
		source: document.documentElement,
		axis: scrollTimelineAxis,
	}),
	rangeStart: {
		offset: fixCrBug1478624(scrollTimelineStart),
		rangeName: 'none',
	},
	rangeEnd: {
		offset: fixCrBug1478624(scrollTimelineEnd),
		rangeName: 'none',
	},
});
```

`scrollTimelineStart` is `CSS.px(4)`, described in the source as "Some small leeway to not start the VT when at the very top". `scrollTimelineEnd` is the card's full height minus 120px, the target height of the collapsed bar.

### Starting and pausing the transition

```js
const startViewTransition = async (progress) => {
	// Determine if we are going back or not
	const isReverse = document.querySelector('.small') ? true : false;

	activeViewTransition = document.startViewTransition(() => {
		document.querySelector('.card').classList.toggle('small');
	});
	await activeViewTransition.ready;

	// Immediately pause all animations linked to it
	activeAnimations = document.getAnimations().filter((anim) => {
		return anim.effect.target === document.documentElement && anim.effect.pseudoElement?.startsWith("::view-transition")
	});
	for (const anim of activeAnimations) {
		if (isReverse) anim.reverse();
		anim.pause();
	}

	// Make sure animations their currentTime is up-to-date
	updateAnimations(progress);

	// The VT finishes when all the animations have reached 100%,
	// i.e. when having scroll past the scrollTimelineEnd offset.
	await activeViewTransition.finished;

	// Make sure the card has the correct class depending on the scroll offset
	// This can happen when the user started scrolling in one direction but then
	// scrolled back, thereby making the VT a no-op, as it returned to its original
	// state.
	if (document.documentElement.scrollTop >= scrollTimelineEnd.value) {
		document.querySelector('.card:not(.small)')?.classList.add('small');
	} else {
		document.querySelector('.card.small')?.classList.remove('small');
	}

	activeViewTransition = null;
}
```

That filter predicate is the answer to "how are the pseudo-element animations identified". Two conditions: `anim.effect.target === document.documentElement`, because every view transition pseudo-element originates from the document element, and `anim.effect.pseudoElement?.startsWith("::view-transition")`.

### The scrub

```js
const updateAnimations = (progress) => {
	if (!activeAnimations.length) return;

	const currentTime = progress * baseDuration;

	for (const animation of activeAnimations) {
		// Weird that I manually had to check the playbackRate here …
		if (animation.playbackRate === -1) {
			animation.currentTime = baseDuration - currentTime;
		} else {
			animation.currentTime = currentTime;
		}
	}
}
```

`baseDuration` is `1000`, hardcoded to match `--vt-base-duration: 1s` in the CSS. The CSS declares every group animation as `animation-duration: var(--vt-base-duration); animation-timing-function: linear`, and expresses each child's duration and delay as a fraction of that base so the whole choreography fits inside one 1000ms window that JavaScript can address as a single number.

### The driver

```js
trackProgress(sda, async (progress) => {
	// In-range: start or update the VT
	if ((progress > 0) && (progress < 1)) {
		if (!activeViewTransition) {
			startViewTransition(progress);
		} else {
			updateAnimations(progress);
		}
	}

	// Outside of the range: clean up the VT
	else {
		if (activeViewTransition) {
			activeViewTransition.skipTransition();
		}
	}
});
```

The transition only exists while progress is strictly between 0 and 1. Reaching either edge calls `skipTransition()`.

### Why the CSS pauses matter

The CSS sets `::view-transition { pointer-events: none; }` with the comment "Allow cursor to send events to underlying page while a VT is running". Version 1 of the pen (<https://codepen.io/bramus/pen/bGZWwxJ>) documents why:

```
// Problem: Because the VT remains active, nothing in it is clickable (e.g. the back button)
```

## The dependency: @bramus/sda-utilities

**VERIFIED (source)**, <https://registry.npmjs.org/@bramus/sda-utilities> and <https://github.com/bramus/sda-utilities>.

The pen imports `trackProgress` from `https://esm.sh/@bramus/sda-utilities`, unpinned. The package is real: MIT, no dependencies, 21KB unpacked, latest 1.1.2 published 2026-03-18. It has exactly two exports, `runOnce` and `trackProgress`. It is a two-file utility library, not a framework.

There is a live trap here. The pen's own comment says "trackProgress uses rAf". That was true of 1.0.0, published 2023-10-05, which was a bare `requestAnimationFrame` loop. **VERIFIED (source)**: commit `b92e3ccc`, 2026-03-18, is titled "♻️ When a ScrollTimeline is detected, track progress using a scroll listener instead of rAF", and current `src/track-progress.js` reads:

```js
if (animation.timeline instanceof ScrollTimeline) {
	const $scroller = animation.timeline.source == document.documentElement ? document : animation.timeline.source;
	updateProgress();
	$scroller.addEventListener('scroll', updateProgress);
} else {
	const rafUpdateProgress = () => {
		updateProgress();
		requestAnimationFrame(rafUpdateProgress);
	};
	requestAnimationFrame(rafUpdateProgress);
}
```

**INFERRED**: because the pen imports from esm.sh without a version, the pen silently switched from a rAF loop to a scroll listener in March 2026, two years after it was written. Don't copy an unpinned esm.sh import into anything you care about.

## Why pausing keeps the transition alive

This is the load-bearing mechanic and it is worth reading the spec text directly.

**VERIFIED (source)**, <https://drafts.csswg.org/css-view-transitions-1/#handle-transition-frame>, the "handle transition frame" algorithm:

> Let hasActiveAnimations be a boolean, initially false.
> For each element of transition's transition root pseudo-element's inclusive descendants:
> For each animation **whose timeline is a document timeline** associated with document, and contains at least one associated effect whose effect target is element, set hasActiveAnimations to true if any of the following conditions are true:
> - animation's play state is paused or running.
> - document's pending animation event queue has any events associated with animation.
>
> If hasActiveAnimations is false: Set transition's phase to "done". Clear view transition transition. Resolve transition's finished promise. Return.

Emphasis mine. Two things follow.

A paused animation sets `hasActiveAnimations` to true. That is the whole trick. Pause the pseudo-element animations and the browser will hold the pseudo-tree open forever, and you can move `currentTime` wherever you like, including to the very end, without the transition committing.

**VERIFIED (experiment)**: paused at `currentTime = 2500` out of 5000, the transition stayed open through 1.9 seconds of idling. Setting `currentTime = 5000`, the exact end, while still paused also did not finish it.

```
B paused. playStates: ["paused"]
B at currentTime 2500: finished? false | anims 10 | progress 0.5
B +1.5s idle: finished? false | anims 10
B at currentTime 5000 (still paused): finished? false | anims 10
```

The other consequence of the spec text is the timeline restriction, which brings us to the interesting part.

## Is `Animation.timeline` assignable, and does it work on view-transition pseudo-elements?

Yes, in Chromium only, and yes it works on those animations specifically.

**VERIFIED (source)**, MDN browser-compat-data `api/Animation.json`: `Animation.timeline` is Chrome 84, Firefox 75 with the note "Only the getter is supported", Safari 13.1 with the same note. So the setter is Chrome and Edge only. Firefox and Safari expose a read-only property.

**VERIFIED (experiment)**, Chrome 152 headless. Ten animations were found on the pseudo-tree for a two-element transition, all `CSSAnimation`, all targeting `document.documentElement`:

```
T1 pseudoElements: ["::view-transition-group(root)","::view-transition-group(box)","::view-transition-new(root)","::view-transition-new(root)","::view-transition-old(root)","::view-transition-old(root)","::view-transition-new(box)","::view-transition-new(box)","::view-transition-old(box)","::view-transition-old(box)"]
T1 animationName: ["-ua-view-transition-group-anim-root","-ua-view-transition-group-anim-box","-ua-view-transition-fade-in","-ua-mix-blend-mode-plus-lighter","-ua-view-transition-fade-out","-ua-mix-blend-mode-plus-lighter","-ua-view-transition-fade-in","-ua-mix-blend-mode-plus-lighter","-ua-view-transition-fade-out","-ua-mix-blend-mode-plus-lighter"]
T1 ctor: ["CSSAnimation","CSSAnimation", ...]
T1 timeline ctor before: ["DocumentTimeline", ...]
T1 assignment error: none
T1 timeline ctor after: ["ScrollTimeline", ...]
T1 playState after: ["running", ...]
```

Note there are two animations per `-old`/`-new` pseudo, because Chrome runs `-ua-mix-blend-mode-plus-lighter` alongside the fade. Any code that assumes one animation per pseudo-element is wrong.

Note also `animationName`. Since these are `CSSAnimation` objects the UA keyframe names are readable, but they are unstable implementation details prefixed `-ua-`. Filter on `effect.pseudoElement`, not on the name.

After reassignment, `currentTime` stops being a number. **VERIFIED (experiment)**: `a.currentTime.constructor.name` is `CSSUnitValue` and its string form is `0%`. Anything that reads `currentTime` as milliseconds breaks the moment you switch timelines.

The catch is what happens at the end of the range. **VERIFIED (experiment)**, reassigning the timeline with nothing holding the transition open:

```
A at scroll 0: progress 0 | finished? false | anims 10
  A finished RESOLVED
A at scroll 100%: progress  | finished? true | anims 0
A scrolled back to 0: progress  | finished? true | anims 0
```

Scroll to the end of the range and the transition commits and the pseudo-tree is destroyed. Scrolling back does nothing, because there is nothing left to scrub. That is exactly the failure Bramus described to the CSSWG and exactly why the pen pauses instead.

**INFERRED**: Chrome's behaviour here does not match the spec text. Per the algorithm quoted above, once every pseudo-element animation is on a `ScrollTimeline` no animation qualifies for the `hasActiveAnimations` check, so the transition should tear down on the very next frame regardless of scroll position. Chrome instead kept it alive at progress 0 and only tore it down at progress 1. Chrome appears to count non-document timelines in the liveness check. This is undocumented, I found no bug or intent thread describing it, and I would not build on it. Use `waitUntil()`.

## The 2026 technique: waitUntil + ScrollTimeline

**VERIFIED (source)**, <https://github.com/w3c/csswg-drafts/issues/9901>, filed 2024-02-02 by David Bokan, closed completed 2025-10-17. The CSSWG resolved on 2024-06-13:

> RESOLVED: Add .waitUntil() promise to the VT object, prevents VT from finishing until the promises settle

The minutes are worth reading because the scroll case is the motivating use case, in Bramus's own words:

> bramus: When the animations contained in a VT all reach the finished state, the VT itself also reaches finished, and goes away
> bramus: When implementing draggable VTs, or scroll-driven, there's a need to prevent that from happening.
> bramus: If you touch the screen and drag the animation, you hit the bottom it reaches 100%, but if you drag back up you still want it to reverse.

**VERIFIED (source)**, Chrome Platform Status feature 4812903832223744, "ViewTransitions waitUntil() method": shipped Chrome desktop 144, Android 144, WebView 144. Owner vmpstr@chromium.org, tracking bug <https://issues.chromium.org/346976175>. WebKit standards position "Support" (<https://github.com/WebKit/standards-positions/issues/564>), Mozilla "No signal" (<https://github.com/mozilla/standards-positions/issues/1309>). The summary names the case outright:

> One example is tying view transitions with Scroll Driven Animations. When the animation is controlled by a scroll timeline, we don't want the subtree to be destroyed when the animations finish since scrolling back should still be able to animate the pseudo elements.

**VERIFIED (source)**, <https://drafts.csswg.org/css-view-transitions-2/#delay-finish-for-promise>: `waitUntil(p)` increments a "wait until promise count", decrements it when `p` settles, and the Level 2 teardown check now reads "If hasActiveAnimations is false **and this's wait until promise count is 0**". The document-timeline restriction is unchanged in Level 2.

**VERIFIED (experiment)**. Combining the two gives a genuinely reversible scroll-scrubbed transition:

```
D scroll 0   -> progress 0 | finished? false | anims 10
D scroll 50% -> progress 0.5000000000000001 | finished? false | anims 10
D scroll 100%-> progress 1 | finished? false | anims 10
D +1s at 100%: finished? false | anims 10
D scroll BACK to 25% -> progress 0.2503075030750308 | finished? false | anims 10
D scroll BACK to 0 -> progress 0 | finished? false | anims 10
D REVERSIBLE: true
```

Working code, which is the thing to copy if you are targeting Chrome 144 or later:

```js
let releaseHold;
const hold = new Promise((r) => { releaseHold = r; });

const t = document.startViewTransition(() => {
  card.classList.toggle('small');
});

await t.ready;

// Hold the pseudo-tree open no matter what the animations do.
t.waitUntil(hold);

const timeline = new ScrollTimeline({
  source: document.documentElement,
  axis: 'y',
});

for (const anim of document.getAnimations()) {
  if (anim.effect?.target !== document.documentElement) continue;
  if (!anim.effect.pseudoElement?.startsWith('::view-transition')) continue;
  anim.timeline = timeline;
}

// ... user scrolls; the browser scrubs the transition with no JS per frame ...

// Commit: jump to the end state and tear down.
t.skipTransition();
releaseHold();

// Or revert: put the DOM back yourself first, then commit.
// card.classList.toggle('small');
// t.skipTransition();
// releaseHold();
```

Two details from the experiments that the code above depends on.

Releasing the hold alone is not enough to end the transition. **VERIFIED (experiment)**: with the timelines still pointed at the `ScrollTimeline` and the scroll at 100%, calling `releaseHold()` did finish it within 2 seconds, but with the scroll at 0% the transition was still open 600ms after release, because the animations are not finished at progress 0. So `releaseHold()` commits only when the scroll position happens to be at the end. `skipTransition()` is the reliable way out.

`skipTransition()` mid-scrub commits cleanly. **VERIFIED (experiment)**:

```
E mid-scrub: anims 10 | progress 0.4
E after skipTransition: finished? true | rejected? null | anims 0
E box class: big
```

The `finished` promise fulfils, it does not reject, and the DOM stays in the new state.

## What happens to `transition.finished`

**VERIFIED (source)**, <https://drafts.csswg.org/css-view-transitions-2/#dom-viewtransition-finished>:

> A promise that fulfills once the end state is fully visible and interactive to the user. It only rejects if updateCallback returns a rejected promise, as this indicates the end state wasn't created. Otherwise, if a transition fails to begin, or is skipped (by skipTransition()), the end state is still reached, so finished fulfills.

So `finished` is not a signal that the animation played. It is a signal that the pseudo-tree is gone and the new DOM is live. During a scrub it simply does not resolve. This is why the pen does `await activeViewTransition.finished` and then reconciles the card's class by reading `scrollTop`: it cannot know from the promise whether the user committed or backed out.

**VERIFIED (source)**, Chrome Platform Status 5143135809961984, "View Transition finished promise timing change", Chrome 140: cleanup now runs asynchronously after the rendering lifecycle so that the frame produced when `finished` resolves still has the view transition structure. Before 140 you could get a flicker if you adjusted styles in the `finished` handler. If you support Chrome 137 to 139, expect that flicker.

## Interrupts

**VERIFIED (source)**, <https://developer.chrome.com/docs/web-platform/view-transitions/same-document>:

> Only one view transition is allowed to run at a time. If a new view transition starts while one is already running, the old transition skips to the end.

**VERIFIED (experiment)**: starting a second transition while the first was paused mid-scrub resolved the first transition's `finished` promise (it did not reject), its `ready` promise did not reject, and a fresh ten-animation pseudo-tree appeared.

```
C first VT paused, anims: 10
C after 2nd VT started: first finished? true | first rejected? null | ready rejected? null
C anims now: 10
```

The user scrolling back mid-transition is not an interrupt in this design, it is the normal case, and it is the whole reason the transition is held open. The pen handles it by reconciling state after `finished`:

```js
// This can happen when the user started scrolling in one direction but then
// scrolled back, thereby making the VT a no-op, as it returned to its original
// state.
if (document.documentElement.scrollTop >= scrollTimelineEnd.value) {
	document.querySelector('.card:not(.small)')?.classList.add('small');
} else {
	document.querySelector('.card.small')?.classList.remove('small');
}
```

There is no `revert()`. The DOM change already happened inside the update callback, and undoing it is your problem. **VERIFIED (source)**, issue 9901, David Bokan: "The hard part is undoing the DOM update - I don't think it's feasible to undo the update automatically; the author would have to pass in an 'undo' callback."

Resize is a hard interrupt. **VERIFIED (source)**, the same "handle transition frame" algorithm: "If transition's initial snapshot containing block size is not equal to the snapshot containing block size, then skip the view transition for transition with an 'InvalidStateError' DOMException". The pen v1 comments confirm the practical effect: "On resize View Transitions get cancelled, so we need to make sure we're at the correct state again". Any scroll-driven transition needs a resize handler that reconciles state.

## Known bugs and fragility

`https://crbug.com/1478624`, now <https://issues.chromium.org/issues/40929569>. **VERIFIED (source)**: title "[scroll-driven-animations] Computed rangeStart / rangeEnd on an animation does not take devicePixelRatio into account", component Blink>Animation. The pen carries a live workaround:

```js
const fixCrBug1478624 = (offset) => {
	const chromium = window.navigator.userAgentData?.brands?.find(b => b.brand === 'Chromium');

	if (chromium) {
		// Need to multiply by the devicePixelRatio because of https://crbug.com/1478624
		// The bug is fixed in Chromium < 148
		if (parseInt(chromium.version) < 148) {
			return offset.mul(window.devicePixelRatio);
		}
	}

	return offset;
}
```

The comment is a typo. The code applies the workaround below 148, so the fix landed in 148. **VERIFIED (source)**: the issue's last-modified timestamp is 2026-03-26, and it references two `chromium/src` changelists, consistent with a 148 fix.

`https://crbug.com/387030974`. **VERIFIED (source)**: title "The computed `to` keyframe for `::view-transition-group(*)` pseudos is wrong", component Blink>ViewTransitions, merged into milestones 137 and 138. The view-transitions-toolkit still guards against it:

```ts
/**
 * Detects if the current browser environment is affected by
 * https://crbug.com/387030974 (Chrome < 137)
 */
const isBuggyChromium = (keyframe: ComputedKeyframe): boolean => {
  if (keyframe.transform === "none") return true;
  return false;
};
```

Things I would flag as fragile in the pen beyond the bugs:

The 1000ms `baseDuration` constant is duplicated in JavaScript and in CSS as `--vt-base-duration`. Change one and the scrub desynchronises silently.

`cardHeightSmall` is `CSS.px(120)` with a `// @TODO: Make this dynamic` next to it.

The unpinned esm.sh import, discussed above.

The `playbackRate === -1` branch in `updateAnimations` exists because `reverse()` flips the rate and `currentTime` then has to be mirrored manually. The 2026 toolkit demo drops `reverse()`-plus-mirroring in favour of passing `1 - progress` to `scrub()`, which is less clever and easier to reason about.

## view-transitions-toolkit

The library in the brief exists, but it is not Bramus's personal package and it is not the one the CodePen uses.

**VERIFIED (source)**, <https://registry.npmjs.org/view-transitions-toolkit> and <https://github.com/GoogleChromeLabs/view-transitions-toolkit>:

- Package name `view-transitions-toolkit`, not scoped. `@bramus/view-transitions-toolkit` returns 404 on npm.
- Repo GoogleChromeLabs/view-transitions-toolkit. Licence Apache-2.0, not MIT.
- 1.0.0 published 2026-04-02. Betas from 2026-03-16. Announced at <https://www.bram.us/2026/04/02/view-transitions-toolkit/>.
- 58,020 bytes unpacked, 22 files, zero runtime dependencies. ESM only, six subpath exports, TypeScript types included.
- Demos at <https://chrome.dev/view-transitions-toolkit/>.

On production readiness, the README says plainly: "This is not an officially supported Google product. This project is not eligible for the Google Open Source Software Vulnerability Rewards Program." **INFERRED**: version 1.0.0, Apache-2.0, Playwright tests in the repo, and a Husky pre-commit hook put this well above demo-grade, but the disclaimer means no support commitment. The docs still contain `// @TODO: Include Output here` placeholders in `animations.md`.

The modules are `feature-detection`, `track-active-view-transition` (a shim for `document.activeViewTransition`), `animations`, `playback-control`, `navigation`, and `misc`.

`playback-control` is the productised version of the pen's hack, and it is 70 lines:

```ts
export function scrub(vt: ViewTransition, progress: number): void {
  const safeProgress = Math.max(0, Math.min(1, progress));
  const animations = getAnimations(vt);

  animations.forEach((anim: CSSAnimation) => {
    anim.pause();

    const effect = anim.effect;
    if (!(effect instanceof KeyframeEffect)) return;

    const timing = effect.getComputedTiming();
    if (typeof timing.duration !== "number") return;

    const delay = typeof timing.delay === "number" ? timing.delay : 0;

    anim.currentTime = (timing.duration + delay) * safeProgress;
  });
}
```

Still `currentTime`. Still pause. No timeline reassignment. There is a `// @TODO: Add new method pauseUntil(vt: ViewTranistion, p: Promise)` at the bottom of the file, which is where `waitUntil` integration will presumably land.

`animations.getAnimations()` is the filter from the pen, generalised and with a `WeakMap` cache keyed on the `ViewTransition`. It handles element-scoped transitions:

```ts
if (vtModern.transitionRoot) {
  allAnimations = vtModern.transitionRoot.getAnimations({ subtree: true });
} else {
  allAnimations = document.getAnimations();
}

animations = allAnimations.filter((anim): anim is CSSAnimation => {
  if (!(anim instanceof CSSAnimation)) return false;
  const effect = anim.effect;
  if (!(effect instanceof KeyframeEffect)) return false;
  const transitionRoot = vtModern.transitionRoot ?? document.documentElement;
  if (effect.target !== transitionRoot) return false;
  const pseudo = effect.pseudoElement;
  return !!(pseudo && pseudo.startsWith("::view-transition"));
});
```

The `instanceof CSSAnimation` check is a useful hardening the pen lacks. It excludes any WAAPI animation you added yourself to a pseudo-element.

The repo ships a `demo/scroll-driven-view-transition/` directory. **VERIFIED (source)**, `demo/scroll-driven-view-transition/scripts.js`: it is a rewrite of the pen using `trackActiveViewTransition()`, `document.activeViewTransition`, `pause()` and `scrub()`, driven by a plain `window.addEventListener("scroll", ...)`. No `ScrollTimeline`, no `waitUntil`. As of the version I read, the first-party demo has not been updated to use the API that was built for it.

## Platform status as of August 2026

Short version: no declarative API exists, and none is proposed.

- **No `view-transition-trigger`.** **VERIFIED (source)**: `https://chromestatus.com/api/v0/features?q=view-transition-trigger` returns `total_count: 0`. Searching Chrome Platform Status for "view transition" returns 26 features, none of them a trigger.
- **No scroll-triggered view transitions in any spec.** **VERIFIED (source)**: I searched css-view-transitions-1 and css-view-transitions-2 for scroll-driven or scroll-triggered prose and found none. Level 2 mentions changing `view-transition-name` from a scroll-driven animation as a use case, which is the reverse direction.
- **`animation-timeline` does not reach the pseudo-elements usefully.** **INFERRED**: nothing in the UA stylesheet or the spec wires a scroll timeline into the generated `::view-transition-*` animations, and there is no way to name a timeline that the UA-generated keyframes would pick up. This is why every demo goes through JavaScript.
- **Scroll-triggered animations are a different feature.** **VERIFIED (source)**, Chrome Platform Status 5181996801982464 "Scroll Triggered Animations", Chrome desktop 146, spec <https://drafts.csswg.org/css-animations-2/#timeline-triggers>. It adds `animation-trigger`, `timeline-trigger-name`, `timeline-trigger-source` and `trigger-scope` (Chrome 146, feature 5152759609425920). **VERIFIED (source)**, <https://developer.chrome.com/blog/scroll-triggered-animations>: the post never mentions view transitions. It starts and stops normal time-based CSS animations at scroll offsets. It cannot start a view transition, because starting one requires calling `startViewTransition()`.

Relevant shipping versions, all **VERIFIED (source)** from MDN browser-compat-data and Chrome Platform Status:

| Feature | Chrome | Firefox | Safari |
| --- | --- | --- | --- |
| `Document.startViewTransition()` | 111 | 144 | 18 |
| `ViewTransition.waitUntil()` | 144 | no | no |
| `document.activeViewTransition` | 142 | 147 | 26.2 |
| `ViewTransition.transitionRoot` | 147 | no | no |
| `Animation.timeline` setter | 84 | getter only | getter only |
| `Animation.overallProgress` | 133 | 142 | 26.2 |
| `ScrollTimeline` constructor | 115 | preview only | 26 |
| `animation-timeline` | 115 | preview only | 26 |
| Scroll-triggered animations | 146 | no | no |

Firefox's `ScrollTimeline` is behind a preview flag, tracked at <https://bugzil.la/1676779>.

**INFERRED**: the practical browser support story for a scroll-driven view transition today is Chromium only, in both the pause-and-scrub form and the `waitUntil` form. Firefox 144 and Safari 18 have view transitions, but neither can retarget an animation's timeline, and the pause-and-scrub form needs `Animation.pause()` plus `currentTime` writes, which both support. So the pause-and-scrub technique should degrade to working in Firefox and Safari and the `waitUntil` technique should not. I did not test either engine.

## Accessibility

**VERIFIED (source)**, <https://drafts.csswg.org/css-view-transitions-1/>:

> The view transition tree is not exposed to the accessibility tree.

and, on the elements being captured:

> When a Document's active view transition's phase is "animating", the boxes generated by any element in that Document with captured in a view transition and its element contents, except transition root pseudo-element's inclusive descendants, are not painted (as if they had opacity: 0) and do not respond to hit-testing (as if they had pointer-events: none). [...] However, there is no change in how these elements are accessed by assistive technologies or the accessibility tree.

**INFERRED**, and this is the important part for a scrubbed transition. A normal view transition is inert for 300ms and nobody notices. A scroll-scrubbed one is inert for as long as the user's finger is on the trackpad, and can be left inert indefinitely if your commit logic has a hole. During that window, captured elements are invisible to the mouse while remaining in the accessibility tree and the tab order. A screen reader user or a keyboard user can focus a control that is not painted where it appears to be, and a sighted mouse user cannot click the thing they can see. Bramus's `::view-transition { pointer-events: none; }` does not fix this. It only lets clicks through to non-captured content, since the captured elements are hit-test-skipped by the UA regardless.

The CSSWG has an open issue on exactly this gap: <https://github.com/w3c/csswg-drafts/issues/11596>, "[css-view-transitions-1] The ability for authors to re-enable pointer events", filed 2025-01-29, still open.

On reduced motion, **VERIFIED (source)**, <https://developer.chrome.com/docs/web-platform/view-transitions/same-document>:

> A preference for "reduced motion" doesn't mean the user wants no motion.

with this as the blunt instrument:

```css
@media (prefers-reduced-motion) {
  ::view-transition-group(*),
  ::view-transition-old(*),
  ::view-transition-new(*) {
    animation: none !important;
  }
}
```

The pen does not use it. **VERIFIED (source)**: it detects the preference and shows a warning banner instead, via `.warning[data-reason="prefers-reduced-motion"] { display: block; }`.

**INFERRED**: `animation: none` is actively wrong for a scrubbed transition. With no animations on the pseudo-elements there is nothing to scrub, and `hasActiveAnimations` is false from the first frame, so the transition commits immediately and the scroll gesture does nothing. Under reduced motion the right move is not to start a view transition at all. Apply the end state directly on the scroll threshold and let the browser do a plain instant swap. That also sidesteps the inertness problem above, which matters more for users who are likely to be on assistive technology.

## Performance

What the browser is doing, and where the cost lands.

**VERIFIED (source)**, css-view-transitions-1: at `ready` the browser has already rasterised the old state ("capture the image") and built the pseudo-tree, which paints in a new stacking layer, the view transition layer, that "paints after all other content of the document (including any content rendered in the top layer)". The snapshot cost is a one-off at transition start, not per frame.

**VERIFIED (source)**, <https://www.bram.us/2025/02/07/view-transitions-applied-more-performant-view-transition-group-animations/>: the UA-generated `::view-transition-group()` keyframes animate `transform`, `width`, `height` and `backdrop-filter`, and `width` and `height` are always in the keyframes even when the size does not change. Because those properties are present, the animation runs on the main thread.

**VERIFIED (source)**, the toolkit's `docs/animations.md`, describing `optimizeGroupAnimations`: "Instead of animating `width` and `height`, this utility function will animate the element's `transform` instead to achieve the same visual effect. This is a more performant way to handle size+position changes in View Transitions." It requires this CSS:

```css
::view-transition-new(*),
::view-transition-old(*) {
  width: 100%;
  height: 100%;
  object-fit: fill;
}
```

So: does a scroll-scrubbed view transition run off the main thread?

**INFERRED**, no, not in either form as normally written, for two independent reasons.

The pause-and-scrub form cannot possibly run off the main thread. Every frame is a scroll event handler that writes `currentTime` on ten animations. That is main-thread work by construction, and it is the reason CSSWG issue 10197 (<https://github.com/w3c/csswg-drafts/issues/10197>, open) reports that scrolling during a transition "feels heavy".

The `waitUntil` plus `ScrollTimeline` form removes the per-frame JavaScript, which is a real win, but the default group keyframes still animate `width` and `height` and so still force main-thread ticking. To get an actually compositor-driven scroll-scrubbed transition you would need to combine the timeline reassignment with `optimizeGroupAnimations()` so the group animations are transform-only. I did not test whether Chrome then composites them. That combination is the interesting experiment nobody in the sources I found has published.

**VERIFIED (source)**, the same-document docs on the width/height case: "For View Transitions, the Chrome team plans to optimize it so it can run off the main thread in most cases", followed by "This optimization hasn't been implemented yet."

## Recommendation

If this is for WordWell and it needs to work in Firefox and Safari, do not do it. Use a scroll-driven animation on real elements. The whole reason to reach for a view transition is that you are changing the DOM structure, and if you are not, `animation-timeline: scroll()` on the elements themselves is declarative, compositor-friendly, and works in every engine.

If it is Chromium-only and the DOM genuinely restructures, use the `waitUntil` plus `ScrollTimeline` form. It is less code than the pen, it has no per-frame JavaScript, and the reversibility is handled by the platform rather than by a `playbackRate === -1` branch. Budget real time for the commit and revert logic, the resize handler, and the reduced-motion path, because that is where all three demos I read spend their complexity.

## Appendix: how the experiments were run

Google Chrome 152.0.7977.64, `--headless=new`, driven over the DevTools Protocol from a Node 22 script using the built-in `WebSocket`. The test page had a 100px box with `view-transition-name: box` growing to 300px, `::view-transition-group(*) { animation-duration: 5s; animation-timing-function: linear; }` to make scrubbing legible, and a 300vh body to scroll. Each assertion polled `document.getAnimations()` filtered on `effect.target === document.documentElement && effect.pseudoElement.startsWith('::view-transition')`.

Caveat: headless Chrome is not a perfect stand-in for headed Chrome on compositing behaviour. The promise resolution, teardown and progress results above are DOM-level and I would expect them to hold, but I did not verify any of the performance claims by measurement.

## Sources

Primary, read directly:

- CodePen source, v3: <https://cdpn.io/pen/debug/BabRVLg> (canonical <https://codepen.io/bramus/pen/BabRVLg>)
- CodePen source, v1: <https://cdpn.io/pen/debug/bGZWwxJ> (canonical <https://codepen.io/bramus/pen/bGZWwxJ>)
- CodePen source, scroll-listener fallback: <https://cdpn.io/pen/debug/mdowgYX> (canonical <https://codepen.io/bramus/pen/mdowgYX>)
- <https://github.com/bramus/sda-utilities> and <https://registry.npmjs.org/@bramus/sda-utilities>
- <https://github.com/GoogleChromeLabs/view-transitions-toolkit> (README, `docs/`, `src/`, `demo/scroll-driven-view-transition/`)
- <https://registry.npmjs.org/view-transitions-toolkit>
- <https://drafts.csswg.org/css-view-transitions-1/>
- <https://drafts.csswg.org/css-view-transitions-2/>
- <https://github.com/w3c/csswg-drafts/issues/9901> including the 2024-06-13 minutes
- <https://github.com/w3c/csswg-drafts/issues/10197>
- <https://github.com/w3c/csswg-drafts/issues/11596>
- <https://issues.chromium.org/issues/40929569> (formerly crbug.com/1478624)
- <https://issues.chromium.org/issues/387030974>
- Chrome Platform Status features 4812903832223744, 5143135809961984, 5181996801982464, 5152759609425920
- MDN browser-compat-data `api/Animation.json`, `api/ViewTransition.json`, `api/Document.json`
- <https://developer.chrome.com/release-notes/144>
- <https://developer.chrome.com/blog/scroll-triggered-animations>
- <https://developer.chrome.com/docs/web-platform/view-transitions/same-document>
- <https://www.bram.us/2024/04/29/if-view-transitions-and-scroll-driven-animations-had-a-baby-css-cafe/>
- <https://www.bram.us/2025/02/07/view-transitions-applied-more-performant-view-transition-group-animations/>
- <https://www.bram.us/2026/04/02/view-transitions-toolkit/>

Could not retrieve:

- codepen.io directly. HTTP 403 to curl and WebFetch on `/pen/`, `.html`, `.css`, `.js` and `/embed/`. Worked around via cdpn.io, which serves the same pen with a canonical link back to codepen.io.
- The transcript of <https://www.youtube.com/watch?v=QA5f2loqtM4>. The auto-generated caption track URL is listed in the page payload but returns zero bytes. I have the title, description, duration and publish date from oEmbed and the page payload. Nothing in this document depends on the video.
