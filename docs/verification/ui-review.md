# UI 优化验证记录

日期：2026-09-21。实际项目目录：`D:\MyAgent\Empower\game_mock`。

- `npm run check`：类型检查、前后端构建、28 项测试全部通过。新增 4 项覆盖跨组选择与减筹码、未加载及待结算禁用、昵称错误保留输入、结算成功后的历史读取失败。
- `scripts/visual-review.mjs`：12 个实际控制器状态 × 320/390px，共 24 个布局检查；没有横向溢出或浏览器脚本错误。每个状态保存视口及全页截图，生成物位于 `dist/visual-review/`。
- 人工复核：骰桌、已选投入、钱包、管理好友、昵称校验弹窗、最长昵称；修正代理预览中页面选择器和组件样式的作用范围，统一独立主按钮宽度。
- Premium strict 静态审计：0 errors、0 warnings、0 unresolved；完整报告为本目录 `premium-audit.json`。
- `npx --yes --package @google/design.md designmd lint DESIGN.md`：退出 0，0 errors；14 项 orphaned-tokens 警告。原因是 frontmatter 的组件属性保留空映射，颜色使用关系与运行时映射记录在正文和 WXSS；没有为消除警告删掉真实 token。

边界：静态审计工具不解析 WXML/WXSS。截图通过 Chromium 将实际模板和样式作离线转换，按钮行为由编译产物的模拟微信测试覆盖；截图不是微信官方渲染器输出。微信开发者工具与真机软键盘、滚动、读屏、云数据库和真实激励视频均未在此环境完成验证。

本轮仅修改本地代码、文档与构建产物，没有部署云函数或推送新的 Git 提交。
