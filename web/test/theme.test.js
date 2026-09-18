import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_THEME, THEME_STORAGE_KEY, deserializeTheme, saveTheme } from "../js/theme.js";

test("主题存储键固定，默认使用黑白银", () => {
  assert.equal(THEME_STORAGE_KEY, "cottoncal.theme.v1");
  assert.equal(DEFAULT_THEME.palette, "silver");
});

test("主题损坏时安全回退，自选颜色必须是六位十六进制", () => {
  assert.deepEqual(deserializeTheme("broken"), DEFAULT_THEME);
  assert.deepEqual(deserializeTheme(JSON.stringify({ palette: "custom", customColor: "red" })), {
    palette: "custom",
    customColor: DEFAULT_THEME.customColor,
  });
  assert.deepEqual(deserializeTheme(JSON.stringify({ palette: "custom", customColor: "#AA55CC" })), {
    palette: "custom",
    customColor: "#aa55cc",
  });
});

test("主题存储失败不会影响页面", () => {
  const storage = { setItem() { throw new Error("denied"); } };
  assert.equal(saveTheme(DEFAULT_THEME, storage), false);
});
