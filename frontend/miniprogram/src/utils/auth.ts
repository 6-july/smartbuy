import Taro from "@tarojs/taro";
import type { UserProfile } from "@/types";

const TOKEN_KEY = "smartbuy_auth_token";
const USER_KEY = "smartbuy_auth_user";

export function getToken() {
  return Taro.getStorageSync<string>(TOKEN_KEY) || "";
}

export function getStoredUser() {
  return Taro.getStorageSync<UserProfile>(USER_KEY) || null;
}

export function saveSession(token: string, user: UserProfile) {
  Taro.setStorageSync(TOKEN_KEY, token);
  Taro.setStorageSync(USER_KEY, user);
}

export function continueAsGuest() {
  Taro.removeStorageSync(TOKEN_KEY);
  Taro.removeStorageSync(USER_KEY);
}
