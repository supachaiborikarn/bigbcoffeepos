import assert from "node:assert/strict";
import { filterPosMenuProducts, findExactProductCodeMatches, isExactProductCodeMatch } from "../src/utils/productSearch.ts";

const product = (id, sku, name, category, extra = {}) => ({
  id, sku, barcode: null, name, category, basePrice: 100, active: true,
  branchType: "oil_service", createdAt: "2026-10-26T00:00:00Z", ...extra,
});

const items = [
  product(1, "C1", "น้ำมันเครื่อง 5W-30", "น้ำมันเครื่อง"),
  product(2, "D2", "ไส้กรองน้ำมันเครื่อง", "อะไหล่"),
  product(3, "C12", "น้ำมันเครื่อง 10W-40", "น้ำมันเครื่อง"),
  product(4, null, "น้ำมันเบรก", "อะไหล่", { barcode: "BR-24" }),
  product(5, "C1", "กาแฟ", "กาแฟ", { branchType: "coffee" }),
  product(6, "H9", "กาแฟแก้วมาเอง", "กาแฟ"),
  product(7, "D2", "สินค้าหยุดขาย", "อะไหล่", { active: false }),
];

const hidden = (item) => item.id === 6;
const search = (query, category = "ทั้งหมด") =>
  filterPosMenuProducts(items, { search: query, category, branchType: "oil_service", isHiddenByDefault: hidden });
const ids = (rows) => rows.map((item) => item.id);

assert.deepEqual(ids(search("c1")), [1], "exact short code takes priority over C12 and other branches");
assert.deepEqual(ids(search(" C1 ")), [1], "trim spaces and match codes regardless of case");
assert.deepEqual(ids(search("d2", "น้ำมันเครื่อง")), [2], "code lookup must ignore selected category");
assert.deepEqual(ids(search("br-24")), [4], "barcode still works");
assert.deepEqual(ids(search("C12")), [3], "longer exact code works");
assert.deepEqual(ids(search("น้ำมันเครื่อง")), [1, 2, 3], "name search searches all categories");
assert.deepEqual(ids(search("C1", "อะไหล่")), [1], "exact code can be found outside current category");
assert.deepEqual(ids(search("H9")), [6], "hidden cup variants are available by exact code");
assert.deepEqual(ids(search("h")), [6], "hidden cup variants are available by partial code");
assert.deepEqual(ids(search("")), [1, 2, 3, 4], "empty search keeps normal hidden-item filtering");
assert.deepEqual(ids(search("", "อะไหล่")), [2, 4], "category still works when search is empty");
assert.deepEqual(ids(search("not found")), [], "unknown search does not show unrelated products");
assert.deepEqual(ids(findExactProductCodeMatches(items, "d2", "oil_service")), [2], "inactive products cannot be added");
assert.deepEqual(ids(findExactProductCodeMatches(items, "c1", "oil_service")), [1], "branch-specific lookup");
assert.equal(isExactProductCodeMatch(items[0], "c1"), true);
assert.equal(isExactProductCodeMatch(items[0], "c"), false);
assert.deepEqual(
  ids(findExactProductCodeMatches([...items, product(8, "C1", "another match", "อะไหล่")], "C1", "oil_service")),
  [1, 8],
  "duplicate codes must be returned so the POS can ask the user to choose"
);
console.log("Product short-code search regression: 17 checks passed");
