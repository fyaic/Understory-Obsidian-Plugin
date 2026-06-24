# 运行环境

- 默认 vault：`~/Documents/AIC-000`（自动解析为当前用户目录）
- 优先使用运行环境已有的 Obsidian skills；如果环境里没有，再使用本 skill 自带脚本
- 默认命令入口：`scripts/vault_ops.py`

# 推荐工作流

## 首次部署

1. 复制环境模板：
   `cp .env.example .env`
2. 编辑 `.env`，填入智谱 AI API Key（可选，不填则自动降级为纯关键词检索）
3. 安装可选依赖：
   `pip install -r requirements.txt`
4. 一键初始化并建立 Embedding 索引：
   `python3 scripts/vault_ops.py init`

## 知识问答

1. 先检索：
   `python3 scripts/vault_ops.py search "关键词" --limit 8 --retries 2`
2. 再阅读命中的 2-4 篇笔记：
   `python3 scripts/vault_ops.py read "相对路径或笔记名"`
3. 如果要给上层 agent 一个更适合直接消费的问答素材包，优先使用：
   `python3 scripts/vault_ops.py answer-pack "用户问题" --retries 2`
4. 如果要直接拿一版“可复述草案”，使用：
   `python3 scripts/vault_ops.py draft-answer "用户问题" --retries 2`
5. 结合读取内容回答问题，并给出来源引用：
   - 至少引用笔记标题
   - 最好给出相对路径
6. 如果命中不足，换同义词继续检索，不要直接编造答案

### 召回偏好

- 默认降低以下内容的优先级：
  - `Linear Issues/`
  - 日报、晨会、daily、untitled 等噪声笔记
- 如果用户明确问“今天发生了什么”“最近日报怎么写的”，再重新提高这类笔记的优先级

## 创建或补充笔记

- 创建：
  `python3 scripts/vault_ops.py create "笔记名" --content "# 标题"`
- 追加：
  `python3 scripts/vault_ops.py append "笔记名" --content "新增内容"`

# 注意事项

- 回答时优先基于本地知识库，不要把模型常识和知识库内容混在一起
- 如果用户要求“基于知识库回答”，就必须先检索再回答
- `answer-pack` 会返回 `guidance + sources`，更适合直接喂给 OpenClaw 上层推理
- `search` 和 `answer-pack` 会返回 `attempts`，用于说明做过哪些检索重试
- **v2.0 新增**：`search` / `answer-pack` / `draft-answer` 已支持 Hybrid 混合检索（关键词 + Embedding 语义），返回结果中的 `channel` 字段可标注召回来源（`keyword` / `embedding` / `hybrid`）
- 当 `.env` 未配置 API Key 或网络异常时，系统会自动降级为纯关键词检索，无需手动切换
