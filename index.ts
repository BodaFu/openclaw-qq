import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { qqPlugin } from "./src/channel.js";
import { setQQRuntime } from "./src/runtime.js";
import { registerQQAdminRoutes } from "./src/admin/routes.js";

export { monitorQQProvider } from "./src/monitor/index.js";
export { qqPlugin } from "./src/channel.js";

const plugin = {
  id: "qq",
  name: "QQ",
  description: "QQ channel plugin (via NapCat OneBot v11)",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setQQRuntime(api.runtime);
    api.registerChannel({ plugin: qqPlugin });
    registerQQAdminRoutes(api);
  },
};

export default plugin;
