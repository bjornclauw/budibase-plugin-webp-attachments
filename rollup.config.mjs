import commonjs from "@rollup/plugin-commonjs"
import resolve from "@rollup/plugin-node-resolve"
import svelte from "rollup-plugin-svelte"
import { terser } from "rollup-plugin-terser"
import postcss from "rollup-plugin-postcss"
import svg from "rollup-plugin-svg"
import json from "rollup-plugin-json"
import nodePolyfills from "rollup-plugin-polyfill-node"
import copy2 from "rollup-plugin-copy2"
import tar from "tar"
import fs from "fs"
import crypto from "crypto"
import { validate } from "@budibase/backend-core/plugins"

const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

const ignoredWarnings = [
  "unused-export-let",
  "css-unused-selector",
  "module-script-reactive-declaration",
  "a11y-no-onchange",
  "a11y-click-events-have-key-events"
]

const clean = () => ({
  buildStart() {
    const dist = "./dist/"
    if (fs.existsSync(dist)) {
      fs.readdirSync(dist).forEach(path => {
        if (path.endsWith(".tar.gz")) {
          fs.unlinkSync(dist + path)
        }
      })
    }
  },
})

const hash = () => ({
  writeBundle() {
    const fileBuffer = fs.readFileSync("dist/plugin.min.js")
    const hashSum = crypto.createHash("sha1")
    hashSum.update(fileBuffer)
    const hex = hashSum.digest("hex")
    const schema = JSON.parse(fs.readFileSync("./dist/schema.json", "utf8"))
    const newSchema = {
       ...schema,
       hash: hex,
       version: pkg.version,
    }
    fs.writeFileSync("./dist/schema.json", JSON.stringify(newSchema, null, 2))
  },
})

const bundle = () => ({
  async writeBundle() {
    const bundleName = `${pkg.name}-${pkg.version}.tar.gz`
    return tar
        .c({ gzip: true, cwd: "dist" }, [
          "plugin.min.js",
          "schema.json",
          "package.json",
        ])
        .pipe(fs.createWriteStream(`dist/${bundleName}`))
  },
})

const validateSchema = () => ({
  buildStart() {
    const schema = fs.readFileSync("schema.json", "utf8")
    validate(JSON.parse(schema))
  }
})

export default {
  input: "index.js",
  external: ["svelte", "svelte/internal"],
  output: {
    sourcemap: process.env.ROLLUP_WATCH ? "inline" : false,
    format: "iife",
    file: "dist/plugin.min.js",
    name: "plugin",
    globals: {
      svelte: "svelte",
      "svelte/internal": "svelte_internal",
    },
  },
  plugins: [
    validateSchema(),
    clean(),
    svelte({
      emitCss: true,
      onwarn: (warning, handler) => {
        if (!ignoredWarnings.includes(warning.code)) {
          handler(warning)
        }
      },
    }),
    postcss(),
    commonjs(),
    nodePolyfills(),
    resolve({
      preferBuiltins: true,
      browser: true,
    }),
    svg(),
    json(),
    terser(),
    copy2.default({
      assets: ["schema.json", "package.json"],
    }),
    hash(),
    bundle(),
  ],
}
