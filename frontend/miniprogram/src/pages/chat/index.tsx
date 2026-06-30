import { useEffect, useState } from "react";
import { Input, ScrollView, Text, View } from "@tarojs/components";
import Taro, { useRouter } from "@tarojs/taro";
import CustomNav from "@/components/custom-nav";
import ProductCard from "@/components/product-card";
import { getGuideInfo, getMessages, scanMerchant, sendMessage } from "@/services/api";
import type { ChatMessage, GuideInfo } from "@/types";
import { getToken } from "@/utils/auth";
import "./index.scss";

export default function ChatPage() {
  const router = useRouter();
  const merchantId = router.params.merchantId || "";
  const scene = router.params.scene || "";
  const routeConversationId = router.params.conversationId || "";
  const [guide, setGuide] = useState<GuideInfo | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState(routeConversationId);
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [scrollAnchor, setScrollAnchor] = useState("chat-end");
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const loadPage = async () => {
    if (!getToken()) {
      if (merchantId) {
        await Taro.redirectTo({ url: `/pages/auth/index?merchantId=${encodeURIComponent(merchantId)}` });
        return;
      }
      if (scene) {
        const result = await scanMerchant(scene);
        await Taro.redirectTo({ url: `/pages/auth/index?merchantId=${encodeURIComponent(result.merchantId)}` });
        return;
      }
      await Taro.redirectTo({ url: "/pages/auth/index" });
      return;
    }
    if (!merchantId && scene) {
      try {
        const result = await scanMerchant(scene);
        await Taro.redirectTo({
          url: `/pages/chat/index?merchantId=${encodeURIComponent(result.merchantId)}${result.conversationId ? `&conversationId=${encodeURIComponent(result.conversationId)}` : ""}`,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "未能识别商家码");
        setLoading(false);
      }
      return;
    }
    if (!merchantId) {
      setError("未找到对应商家");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const info = await getGuideInfo(merchantId);
      const targetConversationId = routeConversationId || info.conversationId;
      const history = await getMessages(targetConversationId);
      setGuide(info);
      setConversationId(targetConversationId);
      setMessages(history.list);
      setTimeout(() => setScrollAnchor("chat-end"), 80);
    } catch (err) {
      setError(err instanceof Error ? err.message : "导购服务加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPage();
  }, [merchantId]);

  const submit = async (preset?: string) => {
    const content = (preset ?? inputValue).trim();
    if (!content || sending || !conversationId) return;
    const clientMessageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const userMessage: ChatMessage = {
      id: clientMessageId,
      role: "user",
      content,
      messageType: "text",
      products: [],
      createdAt: new Date().toISOString(),
      pending: true,
    };
    setInputValue("");
    setMessages((current) => [...current, userMessage]);
    setSending(true);
    setScrollAnchor(`message-${clientMessageId}`);
    try {
      const response = await sendMessage(conversationId, content, clientMessageId);
      setMessages((current) => [
        ...current.map((item) => item.id === clientMessageId ? { ...item, pending: false } : item),
        {
          id: response.messageId,
          role: "assistant",
          content: response.reply,
          messageType: response.products.length ? "product_card" : "text",
          products: response.products,
          createdAt: new Date().toISOString(),
        },
      ]);
      setScrollAnchor("chat-end");
    } catch (err) {
      setMessages((current) => current.map((item) => item.id === clientMessageId ? { ...item, pending: false } : item));
      Taro.showToast({
        title: err instanceof Error ? err.message : "导购助手暂时开小差了，请稍后再试",
        icon: "none",
      });
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return <View className="page-shell chat-center"><View className="chat-loader" /><Text>正在进入商家导购...</Text></View>;
  }

  if (error || !guide) {
    return (
      <View className="page-shell chat-error">
        <CustomNav title="智能导购" showBack />
        <View className="chat-error__body">
          <Text className="chat-error__icon">!</Text>
          <Text className="chat-error__title">{error || "未找到对应商家"}</Text>
          <Text className="chat-error__retry" onClick={loadPage}>重新加载</Text>
        </View>
      </View>
    );
  }

  const { merchant } = guide;

  return (
    <View className="page-shell chat-page">
      <View className="chat-header">
        <CustomNav title={merchant.name} transparent showBack />
      </View>

      <ScrollView
        className="chat-scroll"
        scrollY
        scrollWithAnimation
        scrollIntoView={scrollAnchor}
        enhanced
        showScrollbar={false}
      >
        {guide.recommendQuestions.length > 0 && (
          <View className="question-strip">
            <Text className="question-strip__label">可以问我</Text>
            <ScrollView className="question-strip__scroll" scrollX showScrollbar={false}>
              <View className="question-strip__items">
                {guide.recommendQuestions.map((question) => (
                  <Text className="question-strip__item" key={question} onClick={() => submit(question)}>{question}</Text>
                ))}
              </View>
            </ScrollView>
          </View>
        )}

        <View className="message-list">
          {messages.map((message, index) => {
            const showDivider =
              message.isCurrentSession &&
              index > 0 &&
              !messages[index - 1].isCurrentSession;
            return (
              <View key={message.id}>
                {showDivider && (
                  <View className="session-divider">
                    <View className="session-divider__line" />
                    <Text className="session-divider__text">以上为历史消息</Text>
                    <View className="session-divider__line" />
                  </View>
                )}
                <View
                  id={`message-${message.id}`}
                  className={`message-row message-row--${message.role}`}
                >
                  <View className="message-row__body">
                    <View className={`message-bubble message-bubble--${message.role} ${message.pending ? "message-bubble--pending" : ""}`}>
                      <Text>{message.content}</Text>
                    </View>
                    {message.products.length > 0 && (
                      <View className="message-products">
                        {message.products.map((product) => <ProductCard product={product} key={product.productId} />)}
                      </View>
                    )}
                  </View>
                </View>
              </View>
            );
          })}
          {sending && (
            <View className="message-row message-row--assistant">
              <View className="message-thinking"><Text /><Text /><Text /></View>
            </View>
          )}
          <View
            id="chat-end"
            className="chat-end"
            style={{ height: keyboardHeight ? `${keyboardHeight + 24}px` : "2px" }}
          />
        </View>
      </ScrollView>

      <View className="chat-composer safe-bottom" style={{ transform: keyboardHeight ? `translateY(-${keyboardHeight}px)` : "none" }}>
        <View className="chat-composer__inner">
          <Input
            className="chat-composer__input"
            value={inputValue}
            onInput={(event) => setInputValue(event.detail.value)}
            onConfirm={() => submit()}
            onKeyboardHeightChange={(event) => {
              const height = event.detail.height || 0;
              setKeyboardHeight(height);
              if (height > 0) setTimeout(() => setScrollAnchor("chat-end"), 80);
            }}
            onBlur={() => setKeyboardHeight(0)}
            placeholder="继续问问商品..."
            placeholderClass="chat-composer__placeholder"
            confirmType="send"
            adjustPosition={false}
            maxlength={200}
          />
          <View className={`chat-composer__send ${!inputValue.trim() || sending ? "chat-composer__send--disabled" : ""}`} onClick={() => submit()}>
            <Text>发送</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
