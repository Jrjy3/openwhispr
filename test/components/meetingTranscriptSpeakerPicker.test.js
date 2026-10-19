const test = require("node:test");
const assert = require("node:assert/strict");
const { createRendererServer } = require("../lib/rendererTestHarness");

// Opens the real speaker popovers in happy-dom. Without an i18next instance,
// t() returns the key, so "You" reads as notes.speaker.you.

const DOM_GLOBALS = [
  "document",
  "navigator",
  "Node",
  "Element",
  "HTMLElement",
  "MutationObserver",
  "getComputedStyle",
  "Event",
  "CustomEvent",
  "MouseEvent",
  "PointerEvent",
  "FocusEvent",
  "KeyboardEvent",
  "HTMLInputElement",
  "ResizeObserver",
  "DOMRect",
];
const YOU = "notes.speaker.you";
const THIS_IS_ME = "notes.speaker.thisIsMe";

let happyWindow;

test.before(async () => {
  const { Window } = await import("happy-dom");
  happyWindow = new Window();
  const define = (name, value) =>
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  define("window", happyWindow);
  for (const name of DOM_GLOBALS) define(name, happyWindow[name]);
  for (const name of ["requestAnimationFrame", "cancelAnimationFrame"]) {
    define(name, happyWindow[name].bind(happyWindow));
  }
  // happy-dom has no layout; the virtualized list renders nothing in a 0×0 box.
  for (const [name, value] of [
    ["offsetWidth", 400],
    ["offsetHeight", 600],
  ]) {
    Object.defineProperty(happyWindow.HTMLElement.prototype, name, {
      configurable: true,
      get: () => value,
    });
  }
});

test.after(async () => {
  await happyWindow.happyDOM.close();
});

async function mount(t, element) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const React = require("react");
  const { createRoot } = require("react-dom/client");
  const vite = await createRendererServer(t);
  const mod = await vite.ssrLoadModule("/components/notes/MeetingTranscriptChat.tsx");
  const host = happyWindow.document.createElement("div");
  happyWindow.document.body.appendChild(host);
  const root = createRoot(host);
  t.after(async () => {
    await React.act(async () => root.unmount());
    host.remove();
  });
  const act = (callback) =>
    React.act(async () => {
      await callback();
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
  await act(() => root.render(element(React, mod)));
  return { act };
}

const buttonWithText = (text) =>
  [...happyWindow.document.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
// Booleans, never the element: printing a happy-dom element in a failed assert
// runs the test process out of memory.
const hasButton = (text) => !!buttonWithText(text);
const pickerOpen = () =>
  !!happyWindow.document.querySelector('input[placeholder="notes.speaker.nameOrEmailPlaceholder"]');

const chat = (segments, extra) => (React, mod) =>
  React.createElement(mod.MeetingTranscriptChat, { segments, speakerMappings: {}, ...extra });

test("This is me names an in-person cluster You", async (t) => {
  const calls = [];
  const { act } = await mount(
    t,
    chat([{ id: "a", text: "hello", source: "mic", timestamp: 1, speaker: "speaker_1" }], {
      onMapSpeaker: (...args) => calls.push(args),
    })
  );
  await act(() => buttonWithText("notes.speaker.label").click());
  assert.ok(hasButton(THIS_IS_ME), "the picker offers This is me");
  await act(() => buttonWithText(THIS_IS_ME).click());
  assert.deepEqual(calls, [["speaker_1", YOU, null, undefined]]);
});

test("a call's remote speaker doesn't offer This is me", async (t) => {
  const { act } = await mount(
    t,
    chat([{ id: "a", text: "remote", source: "system", timestamp: 1, speaker: "speaker_0" }])
  );
  await act(() => buttonWithText("notes.speaker.label").click());
  assert.ok(pickerOpen());
  assert.ok(!hasButton(THIS_IS_ME));
});

test("a row already on the user's side doesn't offer This is me", async (t) => {
  const { act } = await mount(
    t,
    chat([{ id: "a", text: "me", source: "mic", timestamp: 1, speaker: "you" }])
  );
  await act(() => buttonWithText(YOU).click());
  assert.ok(pickerOpen());
  assert.ok(!hasButton(THIS_IS_ME));
});

test("the voice profile saved as You is folded into This is me", async (t) => {
  const { act } = await mount(
    t,
    chat([{ id: "a", text: "hello", source: "mic", timestamp: 1, speaker: "speaker_0" }], {
      onMapSpeaker: () => {},
      speakerProfiles: [
        { id: 1, display_name: YOU, email: null },
        { id: 2, display_name: "Alice", email: null },
      ],
    })
  );
  await act(() => buttonWithText("notes.speaker.label").click());
  assert.ok(hasButton(THIS_IS_ME));
  assert.ok(hasButton("Alice"));
  assert.ok(!hasButton(YOU), "the You profile isn't listed twice");
});

test("Assign to offers This is me for a selection", async (t) => {
  const calls = [];
  const { act } = await mount(t, (React, mod) =>
    React.createElement(mod.SelectionBar, {
      count: 2,
      onClear: () => {},
      onAssignName: (...args) => calls.push(args),
      t: (key) => key,
    })
  );
  await act(() => buttonWithText("notes.speaker.assignTo").click());
  await act(() => buttonWithText(THIS_IS_ME).click());
  assert.deepEqual(calls, [[YOU, null, undefined]]);
});
