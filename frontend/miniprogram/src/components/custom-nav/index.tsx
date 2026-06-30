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

function getNavMetrics() {
  if (Taro.getEnv() === Taro.ENV_TYPE.WEB) {
    return { statusBarHeight: 12, navBarHeight: 44 };
  }

  try {
    const statusBarHeight = Taro.getWindowInfo().statusBarHeight || 20;
    const menuButton = Taro.getMenuButtonBoundingClientRect();
    const menuButtonTop = menuButton.top || statusBarHeight + 4;
    const menuButtonHeight = menuButton.height || 32;
    const menuButtonBottom = menuButton.bottom || menuButtonTop + menuButtonHeight;
    const navBottomGap = 8;

    return {
      statusBarHeight,
      navBarHeight: Math.max(44, Math.ceil(menuButtonBottom - statusBarHeight + navBottomGap)),
    };
  } catch {
    return { statusBarHeight: 20, navBarHeight: 44 };
  }
}

export default function CustomNav({
  title,
  transparent = false,
  showBack = false,
  onBack,
  children,
}: CustomNavProps) {
  const { statusBarHeight, navBarHeight } = getNavMetrics();

  const handleBack = () => {
    if (onBack) return onBack();
    if (Taro.getCurrentPages().length > 1) {
      Taro.navigateBack();
      return;
    }
    Taro.reLaunch({ url: "/pages/index/index" });
  };

  return (
    <View
      className={`custom-nav ${transparent ? "custom-nav--transparent" : ""}`}
      style={{ paddingTop: `${statusBarHeight}px` }}
    >
      <View className="custom-nav__bar" style={{ height: `${navBarHeight}px` }}>
        <View className="custom-nav__side">
          {showBack && (
            <View className="custom-nav__back" onClick={handleBack} aria-label="返回">
              <View className="custom-nav__back-icon" />
            </View>
          )}
        </View>
        <Text className="custom-nav__title">{title}</Text>
        <View className="custom-nav__side custom-nav__side--right">{children}</View>
      </View>
    </View>
  );
}
