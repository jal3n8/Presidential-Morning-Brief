import "@testing-library/jest-dom/vitest";

// jsdom has no canvas: make getContext return null quietly (the globe then shows its static fallback).
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { value: () => null, configurable: true });
class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver ??= RO;
class IO { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
(globalThis as unknown as { IntersectionObserver: typeof IO }).IntersectionObserver ??= IO;
Element.prototype.scrollIntoView ??= function () {};
window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, onchange: null, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
