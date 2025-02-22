import { AxiosMock } from "../../mocks/axios.mock";
import { AwilixContainer } from "awilix";
import { PluginRepositoryCache } from "@/services/octoprint/plugin-repository.cache";
import { asClass } from "awilix";
import { connect, closeDatabase, clearDatabase } from "../../db-handler";
import { configureContainer } from "@/container";
import { DITokens } from "@/container.tokens";
import pluginJson from "../test-data/plugins.json";

let httpClient: AxiosMock;
let container: AwilixContainer;
let cache: PluginRepositoryCache;

beforeAll(async () => {
  await connect();
  container = configureContainer();
  container.register(DITokens.httpClient, asClass(AxiosMock).singleton());
  await container.resolve(DITokens.settingsStore).loadSettings();

  cache = container.resolve(DITokens.pluginRepositoryCache);
  httpClient = container.resolve(DITokens.httpClient);
});

afterEach(async () => {
  await clearDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

describe("PluginRepositoryCache", () => {
  const testPlugin = "firmwareupdater";

  it("should return undefined when cache not loaded", () => {
    expect(cache.getCache()).toHaveLength(0);
    expect(cache.getPlugin("SomeName")).toBeUndefined();
  });

  it("should load cache and firmware plugin from Mocked Axios", async () => {
    httpClient.saveMockResponse(pluginJson, 200, false);
    const result = await cache.queryCache();

    expect(result).toHaveLength(356);
    expect(cache.getCache()).toHaveLength(356);

    expect(cache.getPlugin(testPlugin)).toBeDefined();
  });
});
