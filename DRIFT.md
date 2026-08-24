# DRIFT.md — duality-ui Client vs Backend

**Date:** 2026-07-23
**Compared:** `src/services/SimulatedBackendService.ts` + `src/types.ts` ↔ no dedicated backend service found
**Status:** Mock-only application — no real backend to compare against

---

## Critical

### C1 — No Backend Service Found

Duality-ui exclusively uses `SimulatedBackendService` with in-memory RxJS `BehaviorSubject` streams. No HTTP API calls are made. No dedicated backend service exists in `nexus/typescript/`.

| Client Data Source | Backend Equivalent | Found? |
|---|---|---|
| `SimulatedBackendService.workspaces$` | REST API for workspaces | ❌ |
| `SimulatedBackendService.fileTree$` | REST API for file tree | ❌ |
| `SimulatedBackendService.architectChat$` | REST API for chat messages | ❌ |
| `SimulatedBackendService.builderLogs$` | REST API for agent logs | ❌ |

---

## Data Structure Reference

The mock data defines these core interfaces for when a real backend is added:

| Type | Fields |
|---|---|
| `Workspace` | `id`, `name`, `type` ('local' \| 'git' \| 's3'), `path`, `lastOpened` |
| `FileNode` | `id`, `name`, `type` ('folder' \| 'file'), `children?` |
| `ProviderConfig` | `id`, `name`, `models: string[]` |
| `ActiveAgent` | `id`, `name`, `role`, `status` ('idle' \| 'working' \| 'waiting') |
| `ChatMessage` | `id`, `role` ('user' \| 'architect' \| 'builder' \| 'system'), `content`, `timestamp`, `isStreaming?` |
| `PlanIR`, `CritiqueIR`, `SpecIR`, `ExecutionIR`, `ValidationIR` | Various intermediate representation fields |

---

## Summary

| Priority | Area | Notes |
|---|---|---|
| **None** | No drift possible | No backend to compare against — mock-only client |
| **Documentation** | Reference types | The mock data types serve as the intended contract for future backend development |
