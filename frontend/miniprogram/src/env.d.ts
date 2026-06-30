/// <reference types="@tarojs/taro" />

declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV: "development" | "production";
    TARO_ENV: "weapp" | "h5";
    TARO_APP_API_BASE?: string;
    TARO_APP_BASE_URL?: string;
    TARO_APP_API_HOST?: string;
    TARO_APP_API_PORT?: string;
  }
}

declare module "*.svg" {
  const source: string;
  export default source;
}

declare const __API_BASE__: string;
// 同声传译权限暂未开通，先保留插件声明但不启用。
// declare function requirePlugin(name: string): unknown;
