const test = require("node:test");
const assert = require("node:assert/strict");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

test("cloud model reconciliation respects each scope's active mode", async (t) => {
  const { storage, window } = installBrowserGlobals(t);
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-self-hosted-model-persistence-test-",
  });
  const { INFERENCE_SCOPES } = await vite.ssrLoadModule("/config/inferenceScopes.ts");
  // The optional vision override only supports cloud modes.
  const scopes = Object.values(INFERENCE_SCOPES).filter((scope) => !scope.optional);
  const modes = ["self-hosted", "local", "enterprise", "providers", "openwhispr"];

  for (const mode of modes) {
    for (const path of ["startup migration", "startup reconciliation", "live Tinfoil catalog"]) {
      await t.test(`${path} in ${mode} mode`, async () => {
        storage.clear();
        storage.setItem("_llmScopeKeysMigrated", "1");
        const provider = path === "startup reconciliation" ? "groq" : "tinfoil";
        const original = path === "startup reconciliation" ? "my-hosted-model" : "glm-5-2";
        const replacement = provider === "groq" ? "openai/gpt-oss-120b" : "glm-5-3";
        if (path !== "startup migration") {
          storage.setItem("_retiredGroqModelsMigrated", "1");
          storage.setItem("_retiredTinfoilModelsMigrated2", "1");
        }
        for (const { storeKeys } of scopes) {
          storage.setItem(storeKeys.mode, mode);
          storage.setItem(storeKeys.provider, provider);
          storage.setItem(storeKeys.model, original);
        }

        // Reload persisted settings, as a new renderer does on app restart.
        vite.moduleGraph.invalidateAll();
        const { useSettingsStore, reconcileRetiredCloudModelSelections } = await vite.ssrLoadModule(
          "/stores/settingsStore.ts"
        );
        if (path === "startup reconciliation") reconcileRetiredCloudModelSelections();
        if (path === "live Tinfoil catalog") {
          window.electronAPI.getTinfoilChatModels = async () => [
            { id: "glm-5-3", name: "GLM-5.3", description: "", supportsThinking: true },
          ];
          const { refreshTinfoilModels } = await vite.ssrLoadModule("/models/tinfoilModels.ts");
          await refreshTinfoilModels();
        }

        const expected = mode === "providers" || mode === "openwhispr" ? replacement : original;
        for (const { storeKeys } of scopes) {
          assert.equal(useSettingsStore.getState()[storeKeys.model], expected, storeKeys.model);
          assert.equal(storage.getItem(storeKeys.model), expected, `${storeKeys.model} in storage`);
        }
        const { consumeTinfoilModelSwitches } = await vite.ssrLoadModule(
          "/stores/tinfoilModelSwitchStore.ts"
        );
        const notices = consumeTinfoilModelSwitches();
        assert.equal(notices.length, expected !== original && provider === "tinfoil" ? 1 : 0);
      });
    }
  }
});
