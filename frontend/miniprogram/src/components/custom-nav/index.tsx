import { View, Text } from "@tarojs/components";
import Taro from "@tarojs/taro";
import "./index.scss";

interface CustomNavProps {
  title?: string;
  transparent?: boolean;
  showBack?: boolean;
  onBack?: () => void;
  children?: React.ReactNode;
}

function getStatusBarHeight() {
  if (Taro.getEnv() === Taro.ENV_TYPE.WEB) return 12;
  try {
    return Taro.getWindowInfo().statusBarHeight || 20;
  } catch {
    return 20;
  }
}

export default function CustomNav({
  title,
  transparent = false,
  showBack = false,
  onBack,
  children,
}: CustomNavProps) {
  const statusBarHeight = getStatusBarHeight();

  const handleBack = () => {
    if (onBack) return onBack();
    if (Taro.getCurrentPages().length > 1) {
      Taro.navigateBack();
      return;
    }
    Taro.reLaunch({ url: "/pages/home/index" });
  };

  return (
    <View
      className={`custom-nav ${transparent ? "custom-nav--transparent" : ""}`}
      style={{ paddingTop: `${statusBarHeight}px` }}
    >
      <View className="custom-nav__bar">
        <View className="custom-nav__side">
          {showBack && (
            <View className="custom-nav__back" onClick={handleBack} aria-label="返回">
              <Text className="custom-nav__back-icon">‹</Text>
            </View>
          )}
        </View>
        <Text className="custom-nav__title">{title}</Text>
        <View className="custom-nav__side custom-nav__side--right">{children}</View>
      </View>
    </View>
  );
}
