import { defineConfig, type UserConfigExport } from "@tarojs/cli";
import path from "node:path";
import devConfig from "./dev";
import prodConfig from "./prod";

export default defineConfig<"webpack5">((merge) => {
  const apiBase =
    process.env.TARO_APP_API_BASE ||
    (process.env.NODE_ENV === "development" ? "http://127.0.0.1:3000" : "");
  const baseConfig: UserConfigExport<"webpack5"> = {
    projectName: "smartbuy-miniprogram",
    date: "2026-06-29",
    designWidth: 750,
    deviceRatio: {
      640: 2.34 / 2,
      750: 1,
      828: 1.81 / 2,
    },
    sourceRoot: "src",
    outputRoot: "dist",
    framework: "react",
    compiler: {
      type: "webpack5",
      prebundle: { enable: false },
    },
    alias: {
      "@": path.resolve(__dirname, "..", "src"),
    },
    cache: { enable: true },
    defineConstants: {
      __API_BASE__: JSON.stringify(apiBase),
    },
    plugins: ["@tarojs/plugin-platform-weapp", "@tarojs/plugin-platform-h5"],
    mini: {
      postcss: {
        pxtransform: { enable: true },
        cssModules: { enable: false },
      },
    },
    h5: {
      publicPath: "/",
      staticDirectory: "static",
      router: { mode: "hash" },
      devServer: {
        port: 10086,
        host: "0.0.0.0",
        proxy: [
          {
            context: ["/api"],
            target: "http://127.0.0.1:3000",
            changeOrigin: true,
          },
        ],
      },
      postcss: {
        autoprefixer: { enable: true },
        cssModules: { enable: false },
      },
    },
  };

  return process.env.NODE_ENV === "development"
    ? merge({}, baseConfig, devConfig)
    : merge({}, baseConfig, prodConfig);
});
