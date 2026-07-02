export function normalizeProductText(value: string): string {
  return value.replace(/\s+/g, "").replace(/[，。！？、,.!?*#\-—~～"'“”‘’：:]/g, "");
}

export function productTitleAliases(title: string): string[] {
  const normalized = normalizeProductText(title);
  const withoutBadges = normalizeProductText(
    title
      .replace(/【[^】]*】/g, "")
      .replace(/\[[^\]]*]/g, "")
      .replace(/（[^）]*）/g, "")
      .replace(/\([^)]*\)/g, ""),
  );
  return [...new Set([normalized, withoutBadges])].filter(Boolean);
}

export function productTitleMatchIndex(normalizedText: string, title: string): number {
  return productTitleAliases(title).reduce((best, alias) => {
    if (alias.length < 2) return best;
    const index = normalizedText.indexOf(alias);
    return index >= 0 && index < best ? index : best;
  }, Number.POSITIVE_INFINITY);
}
