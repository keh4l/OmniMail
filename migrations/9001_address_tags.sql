-- Fork 专用迁移使用 9xxx 前缀，与上游 00xx 序列分开，避免同步时编号冲突。
-- 标签按"用户 + 地址字符串"保存，不引用 mailboxes，以便同时覆盖外部邮箱地址。
CREATE TABLE IF NOT EXISTS address_tags (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  address TEXT NOT NULL COLLATE NOCASE,
  tag TEXT NOT NULL COLLATE NOCASE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, address, tag)
);

CREATE INDEX IF NOT EXISTS idx_address_tags_user_tag
  ON address_tags(user_id, tag);
