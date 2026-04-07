/**
 * Unit tests for src/providers/mock.ts — mock LLM provider
 */

import { describe, test, expect } from "bun:test";
import { MockProvider, createMockProvider, createMockEntity, createMockEntities } from "../../src/providers/mock.js";

// ---------------------------------------------------------------------------
// MockProvider class
// ---------------------------------------------------------------------------

describe("MockProvider class", () => {
  test("has name 'mock'", () => {
    const provider = new MockProvider();
    expect(provider.name).toBe("mock");
  });

  test("extractEntities returns configured entities", async () => {
    const entities = [createMockEntity({ title: "Class Entity" })];
    const provider = new MockProvider({ entities });
    const result = await provider.extractEntities("some text");
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Class Entity");
  });

  test("extract is an alias for extractEntities", async () => {
    const entities = [createMockEntity({ title: "Alias Entity" })];
    const provider = new MockProvider({ entities });
    const result = await provider.extract("some text");
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Alias Entity");
  });

  test("throws when shouldError is true", async () => {
    const provider = new MockProvider({ shouldError: true, errorMessage: "Class error" });
    await expect(provider.extractEntities("text")).rejects.toThrow("Class error");
  });
});

// ---------------------------------------------------------------------------
// createMockProvider
// ---------------------------------------------------------------------------

describe("createMockProvider", () => {
  test("creates a provider with name 'mock'", () => {
    const provider = createMockProvider();
    expect(provider.name).toBe("mock");
  });

  test("returns empty entities by default", async () => {
    const provider = createMockProvider();
    const result = await provider.extract("some text");
    expect(result).toEqual([]);
  });

  test("returns configured entities", async () => {
    const entities = [createMockEntity({ title: "Custom Entity" })];
    const provider = createMockProvider({ entities });

    const result = await provider.extract("some text");
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Custom Entity");
  });

  test("throws when shouldError is true", async () => {
    const provider = createMockProvider({
      shouldError: true,
      errorMessage: "Network error",
    });

    await expect(provider.extract("some text")).rejects.toThrow("Network error");
  });

  test("default error message when shouldError is true", async () => {
    const provider = createMockProvider({ shouldError: true });
    await expect(provider.extract("some text")).rejects.toThrow("Mock provider error");
  });

  test("respects delay option", async () => {
    const provider = createMockProvider({ delay: 50, entities: [createMockEntity()] });

    const start = Date.now();
    await provider.extract("text");
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(40); // Allow small timing variance
  });

  test("extractEntities works on factory-created provider", async () => {
    const entities = [createMockEntity({ title: "Factory Entity" })];
    const provider = createMockProvider({ entities });
    const result = await provider.extractEntities("text");
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Factory Entity");
  });
});

// ---------------------------------------------------------------------------
// createMockEntity
// ---------------------------------------------------------------------------

describe("createMockEntity", () => {
  test("creates entity with defaults", () => {
    const entity = createMockEntity();
    expect(entity.title).toBe("Test Entity");
    expect(entity.type).toBe("concept");
    expect(entity.updated).toBe("2025-01-15");
    expect(entity.tags).toEqual(["test"]);
    expect(entity.content).toBeTruthy();
  });

  test("accepts overrides", () => {
    const entity = createMockEntity({
      title: "Custom",
      type: "tool",
      tags: ["custom", "testing"],
    });

    expect(entity.title).toBe("Custom");
    expect(entity.type).toBe("tool");
    expect(entity.tags).toEqual(["custom", "testing"]);
  });
});

// ---------------------------------------------------------------------------
// createMockEntities
// ---------------------------------------------------------------------------

describe("createMockEntities", () => {
  test("creates the requested number of entities", () => {
    const entities = createMockEntities(5);
    expect(entities).toHaveLength(5);
  });

  test("assigns different titles", () => {
    const entities = createMockEntities(3);
    const titles = entities.map(e => e.title);
    expect(new Set(titles).size).toBe(3);
  });

  test("cycles through entity types", () => {
    const entities = createMockEntities(7);
    const types = entities.map(e => e.type);
    expect(types).toContain("platform");
    expect(types).toContain("system");
    expect(types).toContain("repo");
    expect(types).toContain("tool");
    expect(types).toContain("concept");
    expect(types).toContain("person");
    expect(types).toContain("team");
  });

  test("creates zero entities", () => {
    const entities = createMockEntities(0);
    expect(entities).toEqual([]);
  });
});
