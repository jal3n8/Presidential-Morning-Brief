import "@testing-library/jest-dom/vitest";

// jsdom lacks ResizeObserver (used by chart containers)
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver ??= RO;
