import { useEffect, useRef, useState } from "react";
import { Input, ScrollView, Swiper, SwiperItem, Text, View } from "@tarojs/components";
import Taro, { useRouter } from "@tarojs/taro";
import CustomNav from "@/components/custom-nav";
import ProductCard from "@/components/product-card";
import { getGuideInfo, getMessages, scanMerchant, sendMessage } from "@/services/api";
import type { ChatMessage, GuideInfo, ProductCardData } from "@/types";
import { getToken } from "@/utils/auth";
import "./index.scss";

function formatPrice(amount: number | null) {
  if (amount == null) return null;
  return `¥${Number(amount) % 1 ? Number(amount).toFixed(2) : amount}`;
}

function getAvailableSpecs(product: ProductCardData | null) {
  return (product?.specs || []).filter((spec) => (spec.values || []).length > 0);
}

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
  const [scrollAnchor, setScrollAnchor] = useState("");
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [productScrollIndex, setProductScrollIndex] = useState<Record<string, number>>({});
  const [specsProduct, setSpecsProduct] = useState<ProductCardData | null>(null);
  const [specsModalClosing, setSpecsModalClosing] = useState(false);
  const scrollDelayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const specsCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearScrollAnchor = () => {
    if (scrollDelayTimer.current) clearTimeout(scrollDelayTimer.current);
    if (scrollClearTimer.current) clearTimeout(scrollClearTimer.current);
    scrollDelayTimer.current = null;
    scrollClearTimer.current = null;
    setScrollAnchor("");
  };

  const triggerScroll = (anchor: string, delay = 0) => {
    if (scrollDelayTimer.current) clearTimeout(scrollDelayTimer.current);
    if (scrollClearTimer.current) clearTimeout(scrollClearTimer.current);
    const run = () => {
      if (scrollClearTimer.current) clearTimeout(scrollClearTimer.current);
      setScrollAnchor(anchor);
      scrollClearTimer.current = setTimeout(() => setScrollAnchor(""), 360);
    };
    if (delay > 0) {
      scrollDelayTimer.current = setTimeout(run, delay);
      return;
    }
    run();
  };

  const openSpecsModal = (product: ProductCardData) => {
    clearScrollAnchor();
    if (specsCloseTimer.current) clearTimeout(specsCloseTimer.current);
    specsCloseTimer.current = null;
    setSpecsModalClosing(false);
    setSpecsProduct(product);
  };

  const closeSpecsModal = () => {
    clearScrollAnchor();
    if (!specsProduct || specsModalClosing) return;
    setSpecsModalClosing(true);
    specsCloseTimer.current = setTimeout(() => {
      setSpecsProduct(null);
      setSpecsModalClosing(false);
      specsCloseTimer.current = null;
    }, 180);
  };

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
      triggerScroll("chat-end", 80);
    } catch (err) {
      setError(err instanceof Error ? err.message : "导购服务加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPage();
  }, [merchantId]);

  useEffect(() => () => {
    if (scrollDelayTimer.current) clearTimeout(scrollDelayTimer.current);
    if (scrollClearTimer.current) clearTimeout(scrollClearTimer.current);
    if (specsCloseTimer.current) clearTimeout(specsCloseTimer.current);
  }, []);

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
    triggerScroll(`message-${clientMessageId}`);
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
      triggerScroll("chat-end");
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
  const availableSpecs = getAvailableSpecs(specsProduct);

  return (
    <View className="page-shell chat-page">
      <View className="chat-header">
        <CustomNav title={merchant.name} transparent showBack />
      </View>

      <ScrollView
        className="chat-scroll"
        scrollY
        scrollWithAnimation
        enhanced
        showScrollbar={false}
        {...(scrollAnchor ? { scrollIntoView: scrollAnchor } : {})}
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
            const products = message.products || [];
            const activeProductIndex = productScrollIndex[message.id] || 0;
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
                    {products.length > 0 && (
                      <View className="message-products-wrap">
                        <Swiper
                          className="message-products"
                          current={activeProductIndex}
                          circular={products.length > 1}
                          onChange={(event) => {
                            const nextIndex = event.detail.current;
                            setProductScrollIndex((current) => current[message.id] === nextIndex ? current : {
                              ...current,
                              [message.id]: nextIndex,
                            });
                          }}
                        >
                          {products.map((product) => (
                            <SwiperItem key={product.productId}>
                              <View className="message-products__item">
                                <ProductCard product={product} variant="compact" onShowSpecs={openSpecsModal} />
                              </View>
                            </SwiperItem>
                          ))}
                        </Swiper>
                        {products.length > 1 && (
                          <View className="message-products__pager">
                            {products.map((product, productIndex) => (
                              <View
                                className={`message-products__pager-dot ${productIndex === activeProductIndex ? "message-products__pager-dot--active" : ""}`}
                                key={product.productId}
                              />
                            ))}
                          </View>
                        )}
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
              if (height > 0) triggerScroll("chat-end", 80);
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

      {specsProduct && (
        <View className={`product-spec-modal ${specsModalClosing ? "product-spec-modal--closing" : ""}`} onClick={closeSpecsModal}>
          <View className="product-spec-modal__panel" onClick={(event) => event.stopPropagation()}>
            <View className="product-spec-modal__header">
              <View className="product-spec-modal__title-wrap">
                <Text className="product-spec-modal__title">全部规格</Text>
                <Text className="product-spec-modal__subtitle">{specsProduct.name}</Text>
              </View>
              <Text
                className="product-spec-modal__close"
                onClick={(event) => { event.stopPropagation(); closeSpecsModal(); }}
              >×</Text>
            </View>
            <ScrollView className="product-spec-modal__content" scrollY showScrollbar={false}>
              {availableSpecs.length > 0 ? (
                availableSpecs.map((spec) => (
                  <View className="product-spec-modal__group" key={spec.name}>
                    <Text className="product-spec-modal__group-title">{spec.name}</Text>
                    <View className="product-spec-modal__items">
                      {(spec.values || []).map((value) => (
                        <View className="product-spec-modal__item" key={value.label}>
                          <Text className="product-spec-modal__item-name">{value.label}</Text>
                          {value.price != null && (
                            <Text className="product-spec-modal__item-price">{formatPrice(value.price)}</Text>
                          )}
                        </View>
                      ))}
                    </View>
                  </View>
                ))
              ) : (
                <Text className="product-spec-modal__empty">暂无更多规格</Text>
              )}
            </ScrollView>
          </View>
        </View>
      )}
    </View>
  );
}
