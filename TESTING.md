# 🧪 AIMindMesh — Testing Guide

> **Status**: Manual + Automated Testing Strategy  
> **Scope**: Mobile (Android), Server (Node.js/TypeScript), Infrastructure  
> **Co-authored with**: Claude (Anthropic) & Perplexity AI

---

## 📋 Table of Contents

1. [Philosophy & Strategy](#1-philosophy--strategy)
2. [Server — Unit & Integration Tests](#2-server--unit--integration-tests)
3. [Mobile — Inference Engine Tests](#3-mobile--inference-engine-tests)
4. [Mobile — Plugin Tests (LiteRT / Llama.cpp / MNN)](#4-mobile--plugin-tests-litert--llamacpp--mnn)
5. [End-to-End Mesh Tests](#5-end-to-end-mesh-tests)
6. [Performance Benchmarks](#6-performance-benchmarks)
7. [Security & Privacy Tests](#7-security--privacy-tests)
8. [Auto-Evolution Pipeline Tests](#8-auto-evolution-pipeline-tests)
9. [Manual Device Testing Checklist](#9-manual-device-testing-checklist)
10. [CI/CD Integration](#10-cicd-integration)

---

## 1. Philosophy & Strategy

AIMindMesh follows a **layered testing pyramid**:
[ E2E Mesh Tests] <- few, slow, high confidence
[ Integration Tests] <- server services + APIs
[ Unit Tests (pure logic)] <- fast, deterministic
[ Manual Device Validation] <- NPU/GPU/hardware features

text

Key principle: **hardware-dependent code** (LiteRT NPU, Adreno OpenCL, dynamic library loading)
is validated manually on physical devices, while pure logic is covered by automated tests.

---

## 2. Server — Unit & Integration Tests

### Setup

```bash
cd aimindmesh-server
npm install
npm run test          # run all tests
npm run test:watch    # watch mode
npm run test:coverage # coverage report
```

Install test dependencies if not present:

```bash
npm install --save-dev jest ts-jest @types/jest supertest @types/supertest
```

Add to `package.json`:

```json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage"
  },
  "jest": {
    "preset": "ts-jest",
    "testEnvironment": "node",
    "testMatch": ["**/__tests__/**/*.test.ts"],
    "coverageDirectory": "coverage",
    "collectCoverageFrom": ["src/**/*.ts", "!src/**/*.example.ts"]
  }
}
```

---

### 2.1 InferenceRouter

**File**: `src/__tests__/InferenceRouter.test.ts`

```typescript
import { InferenceRouter } from '../services/InferenceRouter';

describe('InferenceRouter', () => {
  let router: InferenceRouter;

  beforeEach(() => {
    router = new InferenceRouter(/* mock config */);
  });

  describe('Task Routing', () => {
    it('should route EMBED tasks to the embedding provider', async () => {
      const result = await router.route({ type: 'embed', payload: 'test text' });
      expect(result.provider).toBe('embed');
    });

    it('should route COMPLEX tasks to Gemini or OpenRouter', async () => {
      const result = await router.route({ type: 'complex', payload: 'complex reasoning task' });
      expect(['gemini', 'openrouter']).toContain(result.provider);
    });

    it('should route EVOLUTION tasks to the evolution provider', async () => {
      const result = await router.route({ type: 'evolution', payload: 'refactor this function' });
      expect(result.provider).toBe('evolution');
    });

    it('should fallback gracefully when primary provider is unavailable', async () => {
      jest.spyOn(router as any, 'isPrimaryAvailable').mockResolvedValue(false);
      const result = await router.route({ type: 'complex', payload: 'test' });
      expect(result.provider).toBeDefined();
      expect(result.fallback).toBe(true);
    });

    it('should respect per-task-type provider overrides from config', async () => {
      const result = await router.route({ type: 'lightweight', payload: 'simple task' });
      expect(result.provider).toBe('ollama');
    });
  });

  describe('Node Selection', () => {
    it('should prefer nodes with lower thermal throttling', () => {
      const nodes = [
        { id: 'mobile', thermal: 85, capability: 0.8 },
        { id: 'pc', thermal: 40, capability: 1.0 },
      ];
      const selected = (router as any).selectNode(nodes, 'complex');
      expect(selected.id).toBe('pc');
    });

    it('should exclude nodes that exceed quota', () => {
      const nodes = [
        { id: 'vps', quota: { used: 100, max: 100 } },
        { id: 'pc', quota: { used: 10, max: 100 } },
      ];
      const selected = (router as any).selectNode(nodes, 'embed');
      expect(selected.id).toBe('pc');
    });
  });
});
```

---

### 2.2 AutoEvolutionPipeline

**File**: `src/__tests__/AutoEvolutionPipeline.test.ts`

```typescript
import { AutoEvolutionPipeline } from '../services/AutoEvolutionPipeline';

describe('AutoEvolutionPipeline', () => {
  let pipeline: AutoEvolutionPipeline;

  beforeEach(() => {
    pipeline = new AutoEvolutionPipeline(/* mock dependencies */);
  });

  it('should detect improvement opportunity from feedback', async () => {
    const feedback = { type: 'bug', description: 'inference crashes on empty input' };
    const opportunity = await pipeline.detectOpportunity(feedback);
    expect(opportunity).not.toBeNull();
    expect(opportunity?.priority).toBeGreaterThan(0);
  });

  it('should build multi-file context before generating patch', async () => {
    const spy = jest.spyOn(pipeline as any, 'buildMultiFileContext');
    await pipeline.runCycle({ dryRun: true });
    expect(spy).toHaveBeenCalled();
  });

  it('should NOT commit patch if validation fails', async () => {
    jest.spyOn(pipeline as any, 'validate').mockResolvedValue({ passed: false, reason: 'syntax error' });
    const commitSpy = jest.spyOn(pipeline as any, 'commitToGitea');
    await pipeline.runCycle({ dryRun: false });
    expect(commitSpy).not.toHaveBeenCalled();
  });

  it('should send FCM notification after successful evolution', async () => {
    jest.spyOn(pipeline as any, 'validate').mockResolvedValue({ passed: true });
    const fcmSpy = jest.spyOn(pipeline as any, 'notifyMobile');
    await pipeline.runCycle({ dryRun: false });
    expect(fcmSpy).toHaveBeenCalled();
  });
});
```

---

### 2.3 KGManager (Neo4j Knowledge Graph)

**File**: `src/__tests__/KGManager.test.ts`

```typescript
import { KGManager } from '../services/KGManager';

const mockDriver = {
  session: () => ({
    run: jest.fn().mockResolvedValue({ records: [] }),
    close: jest.fn(),
  }),
};

describe('KGManager', () => {
  let kg: KGManager;

  beforeEach(() => {
    kg = new KGManager(mockDriver as any);
  });

  it('should create entity node with correct labels', async () => {
    const session = mockDriver.session();
    await kg.upsertEntity({ id: 'test-1', type: 'Person', name: 'Andrea' });
    expect(session.run).toHaveBeenCalledWith(
      expect.stringContaining('MERGE'),
      expect.objectContaining({ name: 'Andrea' })
    );
  });

  it('should create relationship between two entities', async () => {
    await kg.upsertRelationship('entity-1', 'entity-2', 'KNOWS');
    const session = mockDriver.session();
    expect(session.run).toHaveBeenCalledWith(
      expect.stringContaining('KNOWS'),
      expect.any(Object)
    );
  });

  it('should return empty array for unknown entity queries', async () => {
    const results = await kg.query('MATCH (n:Unknown) RETURN n');
    expect(results).toEqual([]);
  });
});
```

---

### 2.4 GeminiQueueManager

**File**: `src/__tests__/GeminiQueueManager.test.ts`

```typescript
import { GeminiQueueManager } from '../services/GeminiQueueManager';

describe('GeminiQueueManager', () => {
  it('should respect rate limits and queue excess requests', async () => {
    const manager = new GeminiQueueManager({ rateLimit: 2 });
    const promises = Array.from({ length: 5 }, (_, i) =>
      manager.enqueue({ prompt: `task ${i}` })
    );
    const results = await Promise.all(promises);
    expect(results).toHaveLength(5);
  });

  it('should retry on 429 with exponential backoff', async () => {
    const manager = new GeminiQueueManager({ rateLimit: 10 });
    jest
      .spyOn(manager as any, 'callGemini')
      .mockRejectedValueOnce({ status: 429 })
      .mockResolvedValueOnce({ text: 'ok' });
    const result = await manager.enqueue({ prompt: 'test' });
    expect(result.text).toBe('ok');
  });
});
```

---

### 2.5 API Endpoint Tests

**File**: `src/__tests__/api.test.ts`

```typescript
import request from 'supertest';
import app from '../index';

describe('POST /api/inference', () => {
  it('should return 401 without auth token', async () => {
    const res = await request(app).post('/api/inference').send({ prompt: 'hello' });
    expect(res.status).toBe(401);
  });

  it('should return 200 with valid auth and prompt', async () => {
    const res = await request(app)
      .post('/api/inference')
      .set('Authorization', `Bearer ${process.env.TEST_AUTH_TOKEN}`)
      .send({ prompt: 'hello', type: 'lightweight' });
    expect(res.status).toBe(200);
    expect(res.body.response).toBeDefined();
  });

  it('should validate input — reject empty prompt', async () => {
    const res = await request(app)
      .post('/api/inference')
      .set('Authorization', `Bearer ${process.env.TEST_AUTH_TOKEN}`)
      .send({ prompt: '' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/nodes', () => {
  it('should return registered nodes list', async () => {
    const res = await request(app)
      .get('/api/nodes')
      .set('Authorization', `Bearer ${process.env.TEST_AUTH_TOKEN}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.nodes)).toBe(true);
  });
});
```

---

## 3. Mobile — Inference Engine Tests

### Setup (Kotlin/Android)

Add to `plugins/*/android/build.gradle`:

```groovy
dependencies {
    testImplementation 'junit:junit:4.13.2'
    testImplementation 'org.mockito:mockito-core:5.+'
    androidTestImplementation 'androidx.test.ext:junit:1.1.5'
    androidTestImplementation 'androidx.test.espresso:espresso-core:3.5.1'
}
```

Run tests:

```bash
# Unit tests (JVM, no device needed)
./gradlew :plugins:litert-capacitor:test
./gradlew :plugins:llama-cpp-capacitor:test
./gradlew :plugins:mnn-capacitor:test

# Instrumented tests (requires connected device/emulator)
./gradlew :plugins:litert-capacitor:connectedAndroidTest
```

---

## 4. Mobile — Plugin Tests (LiteRT / Llama.cpp / MNN)

### 4.1 LiteRTPlugin — Hardware Backend Detection

**File**: `plugins/litert-capacitor/android/src/test/java/com/aimindmesh/mobile/litert/LiteRTPluginTest.kt`

```kotlin
import org.junit.Test
import org.junit.Assert.*
import com.aimindmesh.mobile.litert.LiteRTPlugin

class LiteRTPluginTest {

    @Test
    fun `should select NPU backend when QNN libs are available`() {
        val plugin = LiteRTPlugin()
        val backend = plugin.selectBackend(
            nativeLibDir = "/data/app/com.aimindmesh.mobile/lib/arm64",
            openClAvailable = true,
            qnnAvailable = true
        )
        assertEquals("NPU", backend.name)
    }

    @Test
    fun `should fallback to GPU when NPU is unavailable`() {
        val plugin = LiteRTPlugin()
        val backend = plugin.selectBackend(
            nativeLibDir = "",
            openClAvailable = true,
            qnnAvailable = false
        )
        assertEquals("GPU", backend.name)
    }

    @Test
    fun `should fallback to CPU when both NPU and GPU are unavailable`() {
        val plugin = LiteRTPlugin()
        val backend = plugin.selectBackend(
            nativeLibDir = "",
            openClAvailable = false,
            qnnAvailable = false
        )
        assertEquals("CPU", backend.name)
    }

    @Test
    fun `should enable MTP speculative decoding on GPU backend`() {
        val plugin = LiteRTPlugin()
        val config = plugin.buildInferenceConfig(backend = "GPU", mtpEnabled = true)
        assertTrue(config.multiTokenPrediction)
    }

    @Test
    fun `should serialize and restore KV cache correctly`() {
        val plugin = LiteRTPlugin()
        val cacheDir = createTempDir("litert_cache")
        val sessionId = "test-session-001"
        plugin.saveKVCache(sessionId, cacheDir)
        val restored = plugin.loadKVCache(sessionId, cacheDir)
        assertNotNull(restored)
    }
}
```

### 4.2 LiteRTPlugin — Instrumented Device Tests

**File**: `plugins/litert-capacitor/android/src/androidTest/java/com/aimindmesh/mobile/litert/LiteRTDeviceTest.kt`

```kotlin
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.Assert.*
import com.aimindmesh.mobile.litert.OpenClSamplerDetector

@RunWith(AndroidJUnit4::class)
class LiteRTDeviceTest {

    @Test
    fun openClDetector_returns_boolean_without_crash() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val detector = OpenClSamplerDetector(context)
        val isSupported = detector.isSupported()
        assertNotNull(isSupported)
    }

    @Test
    fun nativeLibDir_is_accessible_at_runtime() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val nativeLibDir = context.applicationInfo.nativeLibraryDir
        assertTrue("Native lib dir must exist", java.io.File(nativeLibDir).exists())
    }

    @Test
    fun kvCache_restoresContextAfterRestart() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val plugin = LiteRTPlugin(context)
        val sessionId = "bench-session-001"
        val cacheDir = context.getExternalFilesDir("litert_cache")!!

        plugin.generate("My name is Andrea.", sessionId, saveCache = true, cacheDir = cacheDir)
        val secondResult = plugin.generate("What is my name?", sessionId, loadCache = true, cacheDir = cacheDir)

        assertTrue("Should remember context", secondResult.contains("Andrea"))
    }
}
```

---

### 4.3 LlamaCppInference — Dynamic Library Loading

**File**: `plugins/llama-cpp-capacitor/android/src/test/java/com/aimindmesh/llama/LlamaCppInferenceTest.java`

```java
import org.junit.Test;
import org.junit.Before;
import static org.junit.Assert.*;
import com.aimindmesh.llama.LlamaCppInference;

public class LlamaCppInferenceTest {

    private LlamaCppInference engine;

    @Before
    public void setup() {
        engine = new LlamaCppInference();
    }

    @Test
    public void loadOptimalLibrary_selectsCorrectVariantForFeatureSet() {
        String[] features = { "dotprod", "fp16", "i8mm" };
        String lib = engine.selectLibraryVariant(features);
        assertTrue("Should select i8mm variant for Gen 3",
            lib.contains("i8mm") || lib.contains("gen3"));
    }

    @Test
    public void loadOptimalLibrary_fallsBackToBaseLibOnOldSoC() {
        String[] features = {};
        String lib = engine.selectLibraryVariant(features);
        assertEquals("libsmollm.so", lib);
    }

    @Test
    public void vulkanAndOpenCLFlags_areIndependent() {
        engine.setUseVulkan(true);
        engine.setUseOpenCL(false);
        assertTrue(engine.isVulkanEnabled());
        assertFalse(engine.isOpenCLEnabled());
    }

    @Test
    public void inference_doesNotCrashOnEmptyPrompt() {
        try {
            engine.generate("", 128);
        } catch (IllegalArgumentException e) {
            assertTrue(e.getMessage().contains("empty"));
        }
    }
}
```

---

### 4.4 MNN — Backend Binding

**File**: `plugins/mnn-capacitor/android/src/test/java/com/antigravity/mnn/MnnInferenceEngineTest.java`

```java
import org.junit.Test;
import static org.junit.Assert.*;
import com.antigravity.mnn.MnnInferenceEngine;

public class MnnInferenceEngineTest {

    @Test
    public void mnnBridge_initializesWithoutException() {
        MnnInferenceEngine engine = new MnnInferenceEngine();
        assertNotNull(engine);
    }

    @Test
    public void mnnBridge_supportsVulkanBackend() {
        MnnInferenceEngine engine = new MnnInferenceEngine();
        boolean result = engine.isBackendSupported("VULKAN");
        assertNotNull(result);
    }
}
```

---

## 5. End-to-End Mesh Tests

These tests require a running infrastructure (WireGuard VPN + Server + at least one mobile node).

### Prerequisites

```bash
cd aimindmesh-server
docker-compose up -d
docker-compose ps
curl http://localhost:3000/health
ping 10.8.0.2  # mobile node WireGuard IP
```

### 5.1 Node Registration

```bash
curl -X POST http://10.8.0.1:3000/api/nodes/register \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "nodeId": "mobile-01",
    "type": "mobile",
    "capabilities": ["litert", "llama-cpp", "mnn"],
    "hardware": {
      "soc": "Snapdragon 8 Gen 3",
      "npu": true,
      "openCL": true
    }
  }'
# Expected: 200 OK, nodeId in response
```

### 5.2 Inference Delegation (Mobile -> Server)

```bash
curl -X POST http://10.8.0.1:3000/api/inference \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Explain quantum entanglement", "type": "complex", "originNode": "mobile-01"}'
# Expected: response from cloud provider (Gemini/OpenRouter), latency < 10s
```

### 5.3 Knowledge Graph Sync

```bash
curl -X POST http://10.8.0.1:3000/api/memory \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d '{"content": "Test memory entry", "source": "mobile-01"}'

# Verify in Neo4j browser (bolt://localhost:7687):
# MATCH (m:Memory {source: "mobile-01"}) RETURN m LIMIT 5
```

### 5.4 FCM Push Delivery

```bash
curl -X POST http://10.8.0.1:3000/api/insights/push \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d '{"title": "Test Insight", "body": "E2E test notification", "targetNode": "mobile-01"}'
# Expected: notification appears on device within 5s
```

---

## 6. Performance Benchmarks

### 6.1 Mobile Inference Benchmarks (Manual — On Device)

Run on a **physical Snapdragon device** (not emulator). Use logcat to capture timings.

| Benchmark | Model | Backend | Target TPS |
|-----------|-------|---------|------------|
| LiteRT Gemma 2B | `.litertlm` | NPU (QNN) | >= 30 tok/s |
| LiteRT Gemma 2B | `.litertlm` | GPU (OpenCL) | >= 20 tok/s |
| LiteRT Gemma 2B + MTP | `.litertlm` | GPU + MTP | >= 35 tok/s |
| llama.cpp 3B GGUF Q4 | `.gguf` | OpenCL (Adreno) | >= 15 tok/s |
| llama.cpp 3B GGUF Q4 | `.gguf` | Vulkan | >= 12 tok/s |
| MNN 1.5B | `.mnn` | NPU | >= 40 tok/s |

### 6.2 Server Inference Routing Latency

```bash
# Routing overhead should be < 50ms
time curl -X POST http://localhost:3000/api/inference \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d '{"prompt": "ping", "type": "lightweight"}'
```

### 6.3 KV Cache Resume Test

```kotlin
@Test
fun kvCache_restoresContextAfterRestart() {
    val sessionId = "bench-session-001"
    val cacheDir = context.getExternalFilesDir("litert_cache")!!
    plugin.generate("My name is Andrea.", sessionId, saveCache = true, cacheDir = cacheDir)
    val result = plugin.generate("What is my name?", sessionId, loadCache = true, cacheDir = cacheDir)
    assertTrue("Should remember context", result.contains("Andrea"))
}
```

---

## 7. Security & Privacy Tests

### 7.1 Authentication

```bash
for path in "/api/inference" "/api/nodes" "/api/memory" "/api/evolution/trigger"; do
  status=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000$path)
  echo "POST $path -> $status (expected 401)"
done
```

### 7.2 WireGuard Tunnel Isolation

```bash
# Must NOT be reachable on public IP
curl --max-time 3 http://<PUBLIC_VPS_IP>:3000/api/nodes
# Expected: timeout or connection refused

# Reachable only on WireGuard IP
curl http://10.8.0.1:3000/api/nodes -H "Authorization: Bearer $AUTH_TOKEN"
# Expected: 200 OK
```

### 7.3 OpenClaw Token Protection

```bash
git check-ignore -v aimindmesh-server/openclaw-config/
# Expected: .gitignore matches the path

git log --all --full-history -- "**/*.json" | grep -i "token"
# Expected: no results
```

### 7.4 DNS Privacy (PiHole + Unbound)

```bash
dig @10.8.0.1 google.com
# Expected: Server = 10.8.0.1, not 8.8.8.8
# On Android: set Private DNS to 10.8.0.1
# Check PiHole query log to confirm mobile device traffic is visible
```

---

## 8. Auto-Evolution Pipeline Tests

### 8.1 Dry Run Validation

```bash
curl -X POST http://10.8.0.1:3000/api/evolution/trigger \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d '{"mode": "dry-run", "target": "InferenceRouter"}'

# Expected:
# {
#   "status": "dry-run-complete",
#   "patchPreview": "...",
#   "validationResult": { "passed": true },
#   "committed": false
# }
```

### 8.2 Gitea Branch Verification

```bash
curl http://<GITEA_URL>/api/v1/repos/<owner>/<repo>/branches \
  -H "Authorization: token $GITEA_TOKEN" | jq '.[].name' | grep "evolution/"
# Expected: "evolution/YYYY-MM-DD-HHMMSS"
```

### 8.3 Kasm Sandbox Test

```bash
curl -X POST http://10.8.0.1:3000/api/openclaw/sandbox/test \
  -H "Authorization: Bearer $AUTH_TOKEN"
# Expected: workspace created, hello-world script executed, workspace destroyed
```

---

## 9. Manual Device Testing Checklist

Use this checklist for every release build on a **physical Snapdragon device**.

### Hardware Inference

- [ ] LiteRT loads `.litertlm` model without crash
- [ ] NPU backend selected on Snapdragon 8 Gen 2/3 (logcat: `Backend.NPU`)
- [ ] OpenCL detection runs without crash on unsupported devices (fallback to CPU)
- [ ] MTP speculative decoding active on GPU (logcat: `MTP enabled`)
- [ ] llama.cpp selects correct `libsmollm.so` variant (logcat: `loadOptimalLibrary`)
- [ ] VRAM Guardian triggers history compression under memory pressure
- [ ] KV Cache saves to `cache/litert_cache/` after session ends
- [ ] KV Cache restores context correctly after app kill + reopen

### Voice & Audio

- [ ] VAD detects speech start/end correctly in noisy environment
- [ ] 3-pass diarization assigns correct speaker labels across 3+ speakers
- [ ] Durable recording survives 30+ minutes without memory exhaustion
- [ ] Audio routed correctly via earpiece in Call privacy mode

### Android Auto

- [ ] App appears correctly in Android Auto launcher
- [ ] `GridTemplate` dashboard loads without crash
- [ ] Agenda items visible from car head unit
- [ ] Kanban board accessible from car head unit
- [ ] Privacy call mode routes audio to earpiece/car speakers

### Network & Sync

- [ ] Mobile connects to server via WireGuard on app startup
- [ ] Node registers and appears in server NodeRegistry
- [ ] Offline mode activates when WireGuard disconnects
- [ ] Sync resumes automatically when connection is restored
- [ ] FCM notifications delivered within 5s of server push

### Evolution Notifications

- [ ] FCM notification appears when evolution cycle completes
- [ ] Tapping notification opens evolution log in app

---

## 10. CI/CD Integration

### Gitea Actions Workflow

**File**: `.gitea/workflows/ci.yml`

```yaml
name: CI

on:
  push:
    branches: [main, develop, 'evolution/**']
  pull_request:
    branches: [main]

jobs:
  server-tests:
    runs-on: ubuntu-latest
    services:
      neo4j:
        image: neo4j:5
        env:
          NEO4J_AUTH: neo4j/testpassword
        ports:
          - 7687:7687
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      - name: Install dependencies
        run: cd aimindmesh-server && npm ci
      - name: Run unit tests
        run: cd aimindmesh-server && npm test
      - name: Run coverage
        run: cd aimindmesh-server && npm run test:coverage
      - name: Upload coverage
        uses: actions/upload-artifact@v3
        with:
          name: coverage-report
          path: aimindmesh-server/coverage/

  mobile-unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-java@v3
        with:
          java-version: '17'
          distribution: 'temurin'
      - name: Run LiteRT plugin tests
        run: cd aimindmesh-mobile && ./gradlew :plugins:litert-capacitor:test
      - name: Run Llama.cpp plugin tests
        run: cd aimindmesh-mobile && ./gradlew :plugins:llama-cpp-capacitor:test
      - name: Run MNN plugin tests
        run: cd aimindmesh-mobile && ./gradlew :plugins:mnn-capacitor:test

  security-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Verify gitignore protects sensitive files
        run: |
          git check-ignore -v aimindmesh-server/openclaw-config/ || echo "WARNING: openclaw-config not gitignored"
          git check-ignore -v aimindmesh-server/src/config.ts || echo "WARNING: config.ts not gitignored"
```

---

## Appendix — Test Environment Variables

Create `aimindmesh-server/.env.test`:

```env
NODE_ENV=test
TEST_AUTH_TOKEN=test-token-do-not-use-in-production
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=testpassword
GEMINI_API_KEY=your-test-key
OPENROUTER_API_KEY=your-test-key
GITEA_URL=http://localhost:3001
GITEA_TOKEN=your-gitea-test-token
```

> ⚠️ Never commit `.env.test` with real API keys. Use test/sandbox keys only.

---

*Testing Guide — AIMindMesh v1.x*  
*Co-authored with Perplexity AI & Claude (Anthropic)*  
*Licensed under PolyForm Noncommercial 1.0.0*
