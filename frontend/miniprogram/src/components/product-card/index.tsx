import { useState } from "react";
import { Button, Image, ScrollView, Swiper, SwiperItem, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import type { ProductCardData } from "@/types";
import "./index.scss";

interface ProductCardProps {
  product: ProductCardData;
}

function formatPrice(amount: number | null) {
  if (amount == null) return null;
  return `¥${Number(amount) % 1 ? Number(amount).toFixed(2) : amount}`;
}

function getPriceRange(product: ProductCardData) {
  const min = product.minPrice;
  const max = product.maxPrice;
  if (min == null) return "到店咨询";
  if (max != null && max > min) return `¥${min} - ¥${max}`;
  return `¥${min}`;
}

function getTargetPath(product: ProductCardData) {
  if (!product.miniProgramPath) return "";
  const params = Object.entries(product.miniProgramParams || {})
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  return params ? `${product.miniProgramPath}?${params}` : product.miniProgramPath;
}

export default function ProductCard({ product }: ProductCardProps) {
  const [swiperIndex, setSwiperIndex] = useState(0);
  const images = product.images?.length ? product.images : product.imageUrl ? [product.imageUrl] : [];

  const openProduct = async () => {
    if (Taro.getEnv() === Taro.ENV_TYPE.WEB) {
      await Taro.showToast({ title: "微信小程序中可打开商品详情", icon: "none" });
      return;
    }
    if (!product.miniProgramAppId || !product.miniProgramPath) {
      await Taro.showToast({ title: "暂时无法打开商品详情", icon: "none" });
      return;
    }
    try {
      await Taro.navigateToMiniProgram({
        appId: product.miniProgramAppId,
        path: getTargetPath(product),
      });
    } catch {
      await Taro.showToast({ title: "暂时无法打开商品详情，请稍后再试", icon: "none" });
    }
  };

  const previewImage = (index: number) => {
    if (images.length === 0) return;
    void Taro.previewImage({ urls: images, current: images[index] || images[0] });
  };

  return (
    <View className="product-card">
      {images.length > 1 ? (
        <View className="product-card__gallery">
          <Swiper
            className="product-card__swiper"
            circular
            onChange={(e) => setSwiperIndex(e.detail.current)}
          >
            {images.map((url, i) => (
              <SwiperItem key={url}>
                <Image
                  className="product-card__swiper-img"
                  src={url}
                  mode="aspectFill"
                  lazyLoad
                  onClick={(e) => { e.stopPropagation(); previewImage(i); }}
                />
              </SwiperItem>
            ))}
          </Swiper>
          <View className="product-card__indicator">
            <Text>{swiperIndex + 1}/{images.length}</Text>
          </View>
        </View>
      ) : images.length === 1 ? (
        <Image
          className="product-card__image"
          src={images[0]}
          mode="aspectFill"
          lazyLoad
          onClick={(e) => { e.stopPropagation(); previewImage(0); }}
        />
      ) : null}

      <View className="product-card__content" onClick={openProduct}>
        <Text className="product-card__name">{product.name}</Text>

        {product.tags.length > 0 && (
          <View className="product-card__tags">
            {product.tags.slice(0, 3).map((tag) => (
              <Text className="product-card__tag" key={tag}>{tag}</Text>
            ))}
          </View>
        )}

        {product.specs?.length > 0 && (
          <View className="product-card__specs">
            {product.specs.map((spec) => (
              <View className="product-card__spec" key={spec.name}>
                <Text className="product-card__spec-label">{spec.name}</Text>
                <ScrollView className="product-card__spec-values" scrollX showScrollbar={false}>
                  <View className="product-card__spec-list">
                    {spec.values.map((v) => (
                      <View className="product-card__spec-item" key={v.label}>
                        <Text className="product-card__spec-name">{v.label}</Text>
                        {v.price != null && (
                          <Text className="product-card__spec-price">{formatPrice(v.price)}</Text>
                        )}
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </View>
            ))}
          </View>
        )}

        <View className="product-card__footer">
          <Text className="product-card__price">{getPriceRange(product)}</Text>
          <Button
            className="product-card__button"
            size="mini"
            onClick={(event) => { event.stopPropagation(); void openProduct(); }}
          >查看商品</Button>
        </View>
      </View>
    </View>
  );
}
