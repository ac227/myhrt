-- 用药事件与检查结果分开存放，字段对齐 Oyama's HRT Tracker 的 DoseEvent / LabResult：
-- 剂量一律是化合物本身的毫克（dose_mg），不是体积；途径相关参数放在 extras。
-- 检查用数值 + 单位，单位决定是雌二醇还是睾酮。

CREATE TABLE IF NOT EXISTS records (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('dose', 'lab')),
  time_h      REAL NOT NULL,                 -- 自 1970 起的小时数，与 DoseEvent.timeH 相同
  day         TEXT NOT NULL,                 -- 本地日历日 YYYY-MM-DD，用于筛选和按天分组
  route       TEXT,
  ester       TEXT,
  dose_mg     REAL,
  extras      TEXT NOT NULL DEFAULT '{}',    -- 浓度、凝胶面积、贴片释放速率等
  conc_value  REAL,
  unit        TEXT,
  assay       TEXT,
  notes       TEXT,
  updated_at  INTEGER NOT NULL,              -- epoch ms
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_records_day ON records(day DESC);
CREATE INDEX IF NOT EXISTS idx_records_kind_time ON records(kind, time_h DESC);
