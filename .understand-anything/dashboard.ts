import path from "node:path"
import { existsSync, readFileSync } from "node:fs"
import { createRequire, stripTypeScriptTypes } from "node:module"
import { pathToFileURL } from "node:url"

const project = path.resolve(import.meta.dirname, "..")
const dashboard = "C:/Users/shuwe/.understand-anything/repo/understand-anything-plugin/packages/dashboard"
process.env.GRAPH_DIR = project
const { createServer } = await import(pathToFileURL(`${dashboard}/node_modules/vite/dist/node/index.js`).href)
const require = createRequire(`${dashboard}/package.json`)
const source = stripTypeScriptTypes(readFileSync(`${dashboard}/vite.config.ts`, "utf8"))
  .replaceAll("__dirname", JSON.stringify(dashboard))
  .replaceAll('findGraphFile("knowledge-graph.json")', '(findGraphFile("knowledge-graph.json") ?? findGraphFile("domain-graph.json"))')
  .replace(/from "(vite|@vitejs\/plugin-react|@tailwindcss\/vite)"/g, (_, name) =>
    `from ${JSON.stringify(pathToFileURL(name === "vite" ? `${dashboard}/node_modules/vite/dist/node/index.js` : require.resolve(name)).href)}`)
const { default: config } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)

// This installed dashboard expects a structural graph even for a domain-only analysis.
// Adapt its requests and initial view in memory, preserving the plugin and project sources.
const server = await createServer({
  ...config,
  configFile: false,
  root: dashboard,
  cacheDir: path.join(import.meta.dirname, ".vite-domain"),
  server: { ...config.server, open: false },
  plugins: [
    {
      name: "standalone-domain-view",
      enforce: "pre",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.startsWith("/knowledge-graph.json") && !existsSync(path.join(project, ".understand-anything/knowledge-graph.json"))) {
            req.url = req.url.replace("/knowledge-graph.json", "/domain-graph.json")
          }
          next()
        })
      },
      transform(code, id) {
        if (!id.replaceAll("\\", "/").endsWith("/src/store.ts")) return
        return code.replace("set({ domainGraph: graph });", 'set({ domainGraph: graph, viewMode: "domain" });')
      },
    },
    ...config.plugins,
  ],
})
await server.listen()
