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
