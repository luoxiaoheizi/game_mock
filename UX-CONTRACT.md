# 界面与交互契约

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
| --- | --- | --- | --- | --- |
| Table Selection | 游戏页面 renderBets | pages/game/index.ts 与 domain | 整桌多玩法独立选择；结果命中高亮 | tests/ui.test.ts |
| Select/Listbox | 原生 button 下注格与筹码 | app.wxss 与 game/index.wxml | 无下拉框，选中态含文字与边框 | game-selected 与 game-shaking 布局快照 |
| Date | services/api.ts 的 dateText | 服务端 createdAt 与北京时间业务日 | 日期只读，无日期输入 | tests/domain.test.ts、service.test.ts |
| Form | 领域校验与页面 inline error | domain validNickname；profile/ranking 控制器 | 昵称弹层、邀请码；均保留错误输入 | tests/ui.test.ts |
| Scrollbar | 微信宿主和 app.wxss | 全局 scrollbar-color/width 与 WebKit fallback | 自然页面滚动、弹层内部滚动 | 320/390px 布局快照，真机待验 |
| Toast | services/api.ts toast 与微信宿主 | wx.showToast | 短成功反馈；字段错误必须内联 | tests/ui.test.ts |
| CRUD | API 与页面控制器 | service.ts、共享 session | 投注恢复、签到防重、广告领奖、昵称编辑、好友增删 | tests/service.test.ts、ui.test.ts |

表中页面路径均相对于 `apps/miniprogram/`；领域文件相对于 `packages/`。没有独立 Web 表格、浏览器日期选择器或 textarea。无需为这些不存在的需求增加组件。

## 状态与恢复

- 骰桌：未就绪禁止投入；结算期间禁止改投入和筹码。确认请求有持久化标识，重试使用原请求。已选项在全桌各玩法之间保留，可逐项减筹码或全部清空。透明骰盅的摇动与盅内翻滚仅用于表现，前端按后端返回点数落定。开奖结果直接展示于桌面，明细原地展开；下一局首次下注清除旧高亮。历史加载失败只影响历史区域。
- 钱包：签到/广告操作互斥，按真实 signed、次数和 enabled 禁用按钮。提前关闭模拟广告或离页不发积分。待确认广告使用原会话恢复，成功后刷新明细。
- 好友：列表突出本人；“管理好友”显示移除按钮；取消移除无副作用。邀请失败保持令牌和字段错误。模拟好友及本机邀请限制始终明确说明。
- 我的：编辑前就绪校验；保存时禁用重复提交和取消；错误保持弹层与输入，允许修正；版本冲突刷新资料而不抹掉用户输入。
- 刷新失败保留先前数据显示错误，不把旧数据标成新数据。新页面未加载的核心数值以破折号表示。

## 平台控件所有权

微信 `wx.showModal` 用于玩法说明与移除好友确认，`wx.showToast` 用于短结果反馈。这是既有微信宿主行为，并非浏览器 window.alert/confirm/prompt。移除确认明确写出对象与双向榜单变化，保留独立取消动作。应用自绘昵称、广告弹层统一复用 app.wxss；骰桌开奖结果不用弹层，采用桌面横条与可展开明细。

## 可访问性与检查边界

实际操作使用 button、input、switch，不以 text 作为唯一点击区域。控件具备文字或 aria-label；字段有常驻标签和内联错误；页面在自绘弹层打开时标记 aria-hidden。背景遮罩拦截手势，弹层内部可滚动。减少动态偏好关闭摇动动画；焦点轮廓、标准与 WebKit 滚动条样式均存在。

Premium 静态审计只覆盖它识别的 TypeScript 等后缀，不解析 WXML/WXSS；报告通过不等价于完整微信验收。补充页面事件绑定检查、编译后控制器测试与源模板布局快照。微信开发者工具、iOS/Android 真机软键盘、读屏及真实云端广告仍需具备平台配置后联调。
