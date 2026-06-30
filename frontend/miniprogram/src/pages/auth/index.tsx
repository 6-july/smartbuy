import { useState } from "react";
import { Image, Text, View } from "@tarojs/components";
import Taro, { useRouter } from "@tarojs/taro";
import CustomNav from "@/components/custom-nav";
import robotImage from "@/assets/guide-robot.svg";
import wechatIcon from "@/assets/wechat-icon.svg";
import { wechatLogin } from "@/services/api";
import { continueAsGuest, saveSession } from "@/utils/auth";
import "./index.scss";

export default function AuthPage() {
  const router = useRouter();
  const [loggingIn, setLoggingIn] = useState(false);
  const merchantId = router.params.merchantId || "";

  const goNext = async () => {
    if (merchantId) {
      await Taro.redirectTo({ url: `/pages/chat/index?merchantId=${encodeURIComponent(merchantId)}` });
      return;
    }
    await Taro.reLaunch({ url: "/pages/index/index" });
  };

  const login = async () => {
    if (loggingIn) return;
    setLoggingIn(true);
    try {
      if (Taro.getEnv() !== Taro.ENV_TYPE.WEAPP) {
        throw new Error("请在微信小程序中完成授权登录");
      }
      const loginResult = await Taro.login();
      const session = await wechatLogin(loginResult.code);
      saveSession(session.token, session.user);
      await goNext();
    } catch (err) {
      Taro.showToast({
        title: err instanceof Error ? err.message : "登录失败，请稍后再试",
        icon: "none",
      });
    } finally {
      setLoggingIn(false);
    }
  };

  const skip = async () => {
    continueAsGuest();
    await Taro.reLaunch({ url: "/pages/index/index" });
  };

  const showPolicy = (title: string) => {
    Taro.showModal({
      title,
      content: `${title}正文将在正式发布前由运营方配置。`,
      showCancel: false,
      confirmText: "我知道了",
    });
  };

  return (
    <View className="page-shell auth-page">
      <CustomNav title="智能导购" showBack />
      <View className="auth-main">
        <View className="auth-visual">
          <View className="auth-visual__halo" />
          <Image className="auth-visual__robot" src={robotImage} mode="aspectFit" />
        </View>

        <View className="auth-heading">
          <Text className="auth-heading__title">欢迎使用智能导购</Text>
          <Text className="auth-heading__subtitle">授权后可保存历史会话，快速进入商家导购对话</Text>
        </View>

        <View className="auth-action">
          <View className="auth-policy">
            <Text>登录即代表你已同意</Text>
            <Text className="auth-policy__link" onClick={() => showPolicy("用户协议")}>《用户协议》</Text>
            <Text>与</Text>
            <Text className="auth-policy__link" onClick={() => showPolicy("隐私政策")}>《隐私政策》</Text>
          </View>
          <View className={`auth-login ${loggingIn ? "auth-login--disabled" : ""}`} onClick={login}>
            <Image className="auth-login__wechat" src={wechatIcon} mode="aspectFit" />
            <Text>{loggingIn ? "登录中..." : "微信授权登录"}</Text>
          </View>
        </View>
        <Text className="auth-skip" onClick={skip}>暂不登录，先看看</Text>
      </View>
    </View>
  );
}
