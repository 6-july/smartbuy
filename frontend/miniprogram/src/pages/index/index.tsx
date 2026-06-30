import { useEffect, useState } from "react";
import { Image, Input, Text, View } from "@tarojs/components";
import Taro, { useDidShow, useLoad } from "@tarojs/taro";
import CustomNav from "@/components/custom-nav";
import scanIcon from "@/assets/scan-icon.svg";
import { listConversations, scanMerchant } from "@/services/api";
import type { Conversation } from "@/types";
import { getToken } from "@/utils/auth";
import "./index.scss";

function formatTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  if (date.toDateString() === now.toDateString()) return time;
  if (diff < 172800000) return `昨天 ${time}`;
  if (diff < 259200000) return `前天 ${time}`;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function extractScene(result: Taro.scanCode.SuccessCallbackResult) {
  const path = result.path || result.result || "";
  const sceneMatch = path.match(/[?&]scene=([^&]+)/);
  return decodeURIComponent(sceneMatch?.[1] || path.trim());
}

export default function HomePage() {
  const [keyword, setKeyword] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loggedIn, setLoggedIn] = useState(Boolean(getToken()));

  const loadConversations = async (search = keyword) => {
    const hasToken = Boolean(getToken());
    setLoggedIn(hasToken);
    setError("");
    if (!hasToken) {
      setConversations([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await listConversations(search);
      setConversations(result.list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "最近咨询加载失败");
    } finally {
      setLoading(false);
    }
  };

  useDidShow(() => void loadConversations());

  useEffect(() => {
    const timer = setTimeout(() => void loadConversations(keyword), 280);
    return () => clearTimeout(timer);
  }, [keyword]);

  const openConversation = (item: Conversation) => {
    Taro.navigateTo({
      url: `/pages/chat/index?merchantId=${encodeURIComponent(item.merchantId)}&conversationId=${encodeURIComponent(item.conversationId)}`,
    });
  };

  const openMerchantScene = async (scene: string) => {
    const normalizedScene = decodeURIComponent(scene.trim());
    if (!normalizedScene) throw new Error("未识别到有效的商家码");
    const result = await scanMerchant(normalizedScene);
    if (result.needLogin || !getToken()) {
      await Taro.navigateTo({ url: `/pages/auth/index?merchantId=${encodeURIComponent(result.merchantId)}` });
      return;
    }
    await Taro.navigateTo({
      url: `/pages/chat/index?merchantId=${encodeURIComponent(result.merchantId)}${result.conversationId ? `&conversationId=${encodeURIComponent(result.conversationId)}` : ""}`,
    });
  };

  useLoad((options) => {
    const scene = typeof options.scene === "string" ? options.scene : "";
    if (!scene) return;
    setTimeout(() => {
      void openMerchantScene(scene).catch((err) => {
        Taro.showToast({
          title: err instanceof Error ? err.message : "未能识别商家码",
          icon: "none",
        });
      });
    }, 80);
  });

  const handleScan = async () => {
    try {
      if (Taro.getEnv() !== Taro.ENV_TYPE.WEAPP) {
        await Taro.showToast({ title: "请在微信小程序中使用扫码功能", icon: "none" });
        return;
      }
      const scanResult = await Taro.scanCode({ scanType: ["qrCode"] });
      const scene = extractScene(scanResult);
      await openMerchantScene(scene);
    } catch (err) {
      const message = err instanceof Error ? err.message : "未能识别商家码";
      if (!/cancel/i.test(message)) Taro.showToast({ title: message, icon: "none" });
    }
  };

  return (
    <View className="page-shell home-page">
      <View className="home-hero">
        <CustomNav transparent />
        <View className="home-hero__content">
          <View className="home-hero__copy">
            <Text className="home-hero__title">智能导购</Text>
            <Text className="home-hero__subtitle">随时咨询，轻松选购</Text>
          </View>
          <View className="home-hero__visual">
            <View className="home-hero__bubble home-hero__bubble--large">
              <View />
              <View />
            </View>
            <View className="home-hero__bag">
              <View className="home-hero__bag-handle" />
              <View className="home-hero__bag-mark" />
            </View>
            <View className="home-hero__bubble home-hero__bubble--small">
              <Text>AI</Text>
            </View>
          </View>
        </View>
        <View className="home-search">
          <View className="home-search__icon">
            <View />
            <View />
          </View>
          <Input
            className="home-search__input"
            value={keyword}
            onInput={(event) => setKeyword(event.detail.value)}
            placeholder="搜索咨询过的店铺"
            placeholderClass="home-search__placeholder"
            confirmType="search"
          />
          {keyword && <Text className="home-search__clear" onClick={() => setKeyword("")}>×</Text>}
        </View>
      </View>

      <View className="home-content">
        <View className="home-section-title">
          <Text>最近咨询</Text>
        </View>

        {loading && <View className="home-state"><View className="home-state__spinner" /><Text>正在加载最近咨询...</Text></View>}

        {!loading && error && (
          <View className="home-state">
            <Text className="home-state__symbol">!</Text>
            <Text className="home-state__title">加载失败</Text>
            <Text className="home-state__detail">{error}</Text>
            <Text className="home-state__link" onClick={() => loadConversations()}>重新加载</Text>
          </View>
        )}

        {!loading && !error && !loggedIn && (
          <View className="home-state">
            <Text className="home-state__symbol">AI</Text>
            <Text className="home-state__title">登录后可查看最近咨询的店铺</Text>
            <Text className="home-state__detail">也可以先扫描商家的导购码，授权后开始咨询</Text>
            <Text className="home-state__link" onClick={() => Taro.navigateTo({ url: "/pages/auth/index" })}>去登录</Text>
          </View>
        )}

        {!loading && !error && loggedIn && conversations.length === 0 && (
          <View className="home-state">
            <Text className="home-state__symbol">AI</Text>
            <Text className="home-state__title">暂无咨询过的店铺</Text>
            <Text className="home-state__detail">扫描商家的导购码，开始智能选购</Text>
          </View>
        )}

        {!loading && !error && conversations.length > 0 && (
          <View className="conversation-list">
            {conversations.map((item) => (
              <View className="conversation-item" key={item.conversationId} onClick={() => openConversation(item)}>
                <View className="conversation-item__logo-wrap">
                  {item.merchantLogo ? (
                    <Image className="conversation-item__logo" src={item.merchantLogo} mode="aspectFill" lazyLoad />
                  ) : (
                    <Text className="conversation-item__logo-text">{item.merchantName.slice(0, 1) || "店"}</Text>
                  )}
                </View>
                <View className="conversation-item__body">
                  <View className="conversation-item__top">
                    <Text className="conversation-item__name">{item.merchantName}</Text>
                    <Text className="conversation-item__time">{formatTime(item.lastMessageTime)}</Text>
                  </View>
                </View>
                <View className="conversation-item__arrow" />
              </View>
            ))}
          </View>
        )}
      </View>

      <View className="home-scan safe-bottom">
        <View className="home-scan__button" onClick={handleScan}>
          <Image className="home-scan__icon" src={scanIcon} mode="aspectFit" />
          <Text>扫一扫商家码</Text>
        </View>
      </View>
    </View>
  );
}
