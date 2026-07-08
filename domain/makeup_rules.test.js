// 職責：makeup_rules.js 的單元測試（Node 原生 assert，不需額外套件）
// 執行：node domain/makeup_rules.test.js

'use strict';

const assert = require('assert');
const { computeEarliest, computeDeadline, isOverdue } = require('./makeup_rules');

const DEFAULT = { makeup_earliest_days: 7, makeup_deadline_days: 40 };

// ── computeDeadline ──────────────────────────────────────────
// 規則：缺課日 + makeup_deadline_days（預設 40 天）
assert.strictEqual(computeDeadline('2023-04-24', DEFAULT), '2023-06-03',
  '2023-04-24 + 40 天 → 2023-06-03');
assert.strictEqual(computeDeadline('2023-04-27', DEFAULT), '2023-06-06',
  '2023-04-27 + 40 天 → 2023-06-06');
assert.strictEqual(computeDeadline('2023-04-30', DEFAULT), '2023-06-09',
  '2023-04-30 + 40 天 → 2023-06-09');

assert.strictEqual(computeDeadline('2026-06-24', DEFAULT), '2026-08-03',
  '2026-06-24 + 40 天 → 2026-08-03');

// 自訂天數（30 天）
assert.strictEqual(computeDeadline('2023-04-24', { makeup_deadline_days: 30 }), '2023-05-24',
  '30 天期限 → 截止 2023-05-24');

// ── computeEarliest ──────────────────────────────────────────
assert.strictEqual(computeEarliest('2026-06-24', DEFAULT), '2026-07-01',
  '課後 7 天 → 7/1');
assert.strictEqual(computeEarliest('2026-06-24', { makeup_earliest_days: 3 }), '2026-06-27',
  '課後 3 天 → 6/27');

// ── isOverdue ────────────────────────────────────────────────
assert.strictEqual(isOverdue('2023-05-28', '2023-05-29'), true,  '截止日翌日 → 逾期');
assert.strictEqual(isOverdue('2023-05-28', '2023-05-28'), false, '截止日當天 → 未逾期');
assert.strictEqual(isOverdue('2023-05-28', '2023-05-01'), false, '截止前 → 未逾期');

console.log('✅ 所有測試通過（makeup_rules.test.js）');
