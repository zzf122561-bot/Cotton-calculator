import test from "node:test";
import assert from "node:assert/strict";
import { TenTapTrigger } from "../js/access-control.js";

test("9 击不触发，5 秒内第 10 击触发", () => {
  let now = 0;
  const trigger = new TenTapTrigger(() => now);
  for (let index = 0; index < 9; index += 1) {
    assert.equal(trigger.registerTap(), false);
    now += 400;
  }
  assert.equal(trigger.registerTap(), true);
});

test("超过 5 秒后十击窗口清零", () => {
  let now = 0;
  const trigger = new TenTapTrigger(() => now);
  for (let index = 0; index < 9; index += 1) {
    trigger.registerTap();
    now += 400;
  }
  now = 5_001;
  assert.equal(trigger.registerTap(), false);
  for (let index = 0; index < 8; index += 1) {
    now += 400;
    assert.equal(trigger.registerTap(), false);
  }
  now += 400;
  assert.equal(trigger.registerTap(), true);
});
