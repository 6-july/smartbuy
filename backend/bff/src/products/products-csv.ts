import { HttpStatus } from "@nestjs/common";
import { AppException } from "../common/app-exception";
import { ProductImportItemDto } from "./dto/import-products.dto";

const DEFAULT_SOURCE = "youzan";

type CsvRow = {
  values: string[];
  rowNumber: number;
};

export function parseProductImportCsv(input: Buffer | string): ProductImportItemDto[] {
  const text = Buffer.isBuffer(input) ? input.toString("utf8") : input;
  const records = parseCsvRecords(text);
  if (records.length < 2) {
    throw invalidCsv("CSV 至少需要包含表头和一行商品数据");
  }

  const headers = records[0].map(normalizeHeader);
  const headerIndex = new Map(headers.map((header, index) => [header, index]));
  const rows = records
    .slice(1)
    .map((values, index) => ({ values, rowNumber: index + 2 }))
    .filter((row) => row.values.some((value) => value.trim() !== ""));

  if (rows.length === 0) {
    throw invalidCsv("CSV 没有可导入的商品行");
  }

  return rows.map((row) => toImportItem(headerIndex, row));
}

function toImportItem(headerIndex: Map<string, number>, row: CsvRow): ProductImportItemDto {
  const options = parseJsonArray(getColumn(headerIndex, row, ["规格信息", "options"], false), row.rowNumber, "规格信息");
  const tags = splitMultiValue(getColumn(headerIndex, row, ["标签", "tags"], false));
  if (parseBoolean(getColumn(headerIndex, row, ["热门"], false)) && !tags.includes("热门")) {
    tags.push("热门");
  }

  const title = getColumn(headerIndex, row, ["商品名称", "title"], true);
  const optionsText =
    getColumn(headerIndex, row, ["规格摘要", "optionsText", "options_text"], false).trim() ||
    summarizeOptions(options) ||
    title;

  return {
    source: getColumn(headerIndex, row, ["来源", "source"], false).trim() || DEFAULT_SOURCE,
    sourceShopId: emptyToUndefined(getColumn(headerIndex, row, ["商家id", "sourceShopId", "source_shop_id"], false)),
    sourceProductId: getColumn(headerIndex, row, ["商品id", "sourceProductId", "source_product_id"], true),
    alias: emptyToUndefined(getColumn(headerIndex, row, ["别名alias", "alias"], false)),
    category: emptyToUndefined(getColumn(headerIndex, row, ["分类", "category"], false)),
    title,
    description: emptyToUndefined(getColumn(headerIndex, row, ["描述", "description"], false)),
    displayPrice: parseNumber(getColumn(headerIndex, row, ["展示价格", "displayPrice", "display_price"], true), row.rowNumber, "展示价格"),
    minPrice: parseNumber(getColumn(headerIndex, row, ["最低价", "minPrice", "min_price"], true), row.rowNumber, "最低价"),
    maxPrice: parseNumber(getColumn(headerIndex, row, ["最高价", "maxPrice", "max_price"], true), row.rowNumber, "最高价"),
    images: parseJsonArray(getColumn(headerIndex, row, ["商品图", "images"], false), row.rowNumber, "商品图"),
    sales: parseInteger(getColumn(headerIndex, row, ["销量", "sales"], false), row.rowNumber, "销量"),
    isRecommended: parseBoolean(getColumn(headerIndex, row, ["推荐", "isRecommended", "is_recommended"], false)),
    options,
    tags,
    optionsText,
  };
}

function parseCsvRecords(text: string): string[][] {
  const normalized = text.replace(/^\uFEFF/, "");
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (inQuotes) {
      if (char === '"') {
        if (normalized[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && normalized[index + 1] === "\n") index += 1;
      row.push(field);
      records.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (inQuotes) throw invalidCsv("CSV 引号未闭合");
  if (field !== "" || row.length > 0) {
    row.push(field);
    records.push(row);
  }
  return records;
}

function getColumn(
  headerIndex: Map<string, number>,
  row: CsvRow,
  names: string[],
  required: boolean,
): string {
  for (const name of names.map(normalizeHeader)) {
    const index = headerIndex.get(name);
    if (index !== undefined) {
      const value = row.values[index]?.trim() || "";
      if (required && value === "") {
        throw invalidCsv(`第 ${row.rowNumber} 行缺少必填字段：${names[0]}`);
      }
      return value;
    }
  }
  if (required) throw invalidCsv(`CSV 缺少必填表头：${names[0]}`);
  return "";
}

function parseJsonArray(value: string, rowNumber: number, label: string): unknown[] {
  if (!value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error("not array");
    }
    return parsed;
  } catch {
    throw invalidCsv(`第 ${rowNumber} 行 ${label} 不是合法 JSON 数组`);
  }
}

function parseNumber(value: string, rowNumber: number, label: string): number {
  const normalized = value.replace(/[￥¥,\s]/g, "");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw invalidCsv(`第 ${rowNumber} 行 ${label} 必须是非负数字`);
  }
  return parsed;
}

function parseInteger(value: string, rowNumber: number, label: string): number {
  if (!value.trim()) return 0;
  const parsed = Number.parseInt(value.replace(/[,\s]/g, ""), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw invalidCsv(`第 ${rowNumber} 行 ${label} 必须是非负整数`);
  }
  return parsed;
}

function parseBoolean(value: string): boolean {
  return ["1", "true", "yes", "y", "是", "推荐", "热门"].includes(value.trim().toLowerCase());
}

function splitMultiValue(value: string): string[] {
  return value
    .split(/[;；]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function summarizeOptions(options: unknown[]): string {
  return options
    .flatMap((option) => {
      if (!isRecord(option)) return [];
      const name = typeof option.name === "string" ? option.name : "";
      const optionValues = Array.isArray(option.options) ? option.options : [];
      if (!name || optionValues.length === 0) return [];
      const type = typeof option.type === "string" ? option.type : "";
      const typeLabel = optionTypeLabel(type);
      const values = optionValues
        .flatMap((value) => {
          if (!isRecord(value) || typeof value.name !== "string") return [];
          const price = typeof value.price === "number" ? `${formatPrice(value.price)}元` : "";
          return [`${value.name}${price}`];
        })
        .join("、");
      return values ? [`${name}（${typeLabel}）：${values}`] : [];
    })
    .join("；");
}

function optionTypeLabel(type: string): string {
  if (type === "price") return "必须";
  if (type === "preference") return "喜好";
  if (type === "addon") return "附属";
  return "规格";
}

function formatPrice(price: number): string {
  return Number.isInteger(price) ? String(price) : price.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function normalizeHeader(header: string): string {
  return header.replace(/^\uFEFF/, "").trim();
}

function emptyToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function invalidCsv(message: string): AppException {
  return new AppException("PRODUCT_IMPORT_CSV_INVALID", message, HttpStatus.UNPROCESSABLE_ENTITY);
}
